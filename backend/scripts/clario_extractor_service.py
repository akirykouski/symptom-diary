"""
Clario extractor sidecar.

Self-contained FastAPI service that wraps the fine-tuned Gemma 4 E4B + Clario
LoRA adapter + few-shot prompting + (optional) HPO synonym lookup. Exposes a
single POST /extract endpoint matching `backend/diary/extraction.py`'s
sidecar contract.

Run alongside Ollama on :11435. The Clario backend's extraction worker calls
this when CLARIO_EXTRACTOR_URL is set; embeddings stay on real Ollama.

Adapter source:
    Defaults to the HuggingFace Hub repo `m0rtyddd/clario-gemma4-e4b-lora-v2`.
    Override with CLARIO_ADAPTER=<repo_id_or_local_path>.

HPO knowledge:
    Optional. If CLARIO_KNOWLEDGE_PATH points to a `disease_knowledge.json`
    built from HPO + Orphanet (see scripts/build_knowledge.py), the sidecar
    resolves each extracted canonical name to an HPO ID. If absent, the
    sidecar still returns entities — just without `hpo_id` in attrs.

Usage:
    pip install -e .[extractor]
    PYTHONUTF8=1 python -m scripts.clario_extractor_service
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
from contextlib import asynccontextmanager
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
from peft import PeftModel

logger = logging.getLogger("clario.extractor")

DEFAULT_ADAPTER = "m0rtyddd/clario-gemma4-e4b-lora-v2"
BASE_MODEL_ID = "unsloth/gemma-4-e4b-it"
PORT = int(os.environ.get("CLARIO_EXTRACTOR_PORT", "11435"))
ADAPTER = os.environ.get("CLARIO_ADAPTER", DEFAULT_ADAPTER)
KNOWLEDGE_PATH = os.environ.get("CLARIO_KNOWLEDGE_PATH", "")

# Matches the system prompt the v2 LoRA was trained against. Keep verbatim.
SYSTEM_PROMPT = (
    "You are a clinical entity extractor for a patient symptom diary. "
    "Extract symptoms, triggers, body parts, medications, and lab values "
    "from the diary entry. For each entity, return the colloquial form as written "
    "and the canonical medical term with its HPO ID where applicable. "
    "Output strictly valid JSON. Do not diagnose. Do not invent entities not in the text."
)

# Two few-shot demonstrations stacked on top of the LoRA. Both teach colloquial
# -> canonical mappings the LoRA alone misses (specifically the SLE
# photosensitivity / malar rash axis). Surface forms here are deliberately
# different from any test diary so we measure generalisation, not memorisation.
FEW_SHOT = [
    {
        "user": (
            "Diary entry:\nWent for a long walk at noon. By the evening my "
            "forearms and the bridge of my nose were itchy and burning where "
            "the sun hit them. Lately this happens whenever I'm outside for "
            "more than an hour."
        ),
        "assistant": json.dumps({
            "entities": [
                {
                    "name_colloquial": "itchy and burning where the sun hit them",
                    "name_canonical": "Photosensitivity",
                    "hpo_id": "HP:0000992",
                    "type": "symptom",
                },
                {
                    "name_colloquial": "noon walk in the sun",
                    "name_canonical": "Sun exposure",
                    "hpo_id": None,
                    "type": "trigger",
                },
            ]
        }, ensure_ascii=False),
    },
    {
        "user": (
            "Diary entry:\nNoticed a reddened band stretching across her "
            "cheekbones and the bridge of her nose this morning. She also "
            "said her finger joints felt stiff when she woke up."
        ),
        "assistant": json.dumps({
            "entities": [
                {
                    "name_colloquial": "reddened band across cheekbones and bridge of nose",
                    "name_canonical": "Malar rash",
                    "hpo_id": "HP:0025474",
                    "type": "symptom",
                },
                {
                    "name_colloquial": "finger joints felt stiff when she woke up",
                    "name_canonical": "Morning joint stiffness",
                    "hpo_id": "HP:0001387",
                    "type": "symptom",
                },
            ]
        }, ensure_ascii=False),
    },
]

# Canonical names the model frequently emits but the synonym index lacks a
# verbatim entry for. Maps name -> HPO ID. Add more as gaps surface.
CANONICAL_ALIASES = {
    "oral ulceration": "HP:0000155",
    "cold hands": "HP:0011045",
}

# Clario backend's entity_types vocabulary. Sidecar drops anything outside
# this set defensively before returning.
CLARIO_ENTITY_TYPES = {
    "symptom", "trigger", "bodypart", "med", "lab_marker",
    "food", "activity", "emotion", "other",
}

_TOKENIZER = None
_MODEL = None
_NAME_TO_HPOS: dict[str, set[str]] | None = None
_HPO_TO_CANONICAL: dict[str, str] | None = None


def _norm_name(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _extract_json(text: str) -> dict | None:
    """Pull the first balanced {...} blob from generated text."""
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    for i, ch in enumerate(text[start:], start=start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def _build_synonym_index(knowledge_path: Path) -> tuple[dict, dict]:
    """Invert hpo_lookup into name(normalised) -> set(HPO IDs)."""
    data = json.loads(knowledge_path.read_text(encoding="utf-8"))
    hpo_lookup = data["hpo_lookup"]
    name_to_hpos: dict[str, set[str]] = {}
    hpo_to_canonical: dict[str, str] = {}
    for hpo_id, info in hpo_lookup.items():
        canon = info.get("canonical_name") or ""
        if canon:
            hpo_to_canonical[hpo_id] = canon
        all_names = [canon] + (info.get("exact_synonyms") or []) + (info.get("related_synonyms") or [])
        for n in all_names:
            k = _norm_name(n)
            if not k:
                continue
            name_to_hpos.setdefault(k, set()).add(hpo_id)
    return name_to_hpos, hpo_to_canonical


def _resolve_hpo(canonical_name: str) -> tuple[str | None, str]:
    """Return (hpo_id, normalised_canonical). Falls through to CANONICAL_ALIASES
    and finally returns (None, original_canonical) if the index is missing or
    the name has no entry."""
    if _NAME_TO_HPOS is None:
        return None, canonical_name
    hits = _NAME_TO_HPOS.get(_norm_name(canonical_name), set())
    if hits:
        hpo_id = sorted(hits)[0]
        return hpo_id, _HPO_TO_CANONICAL.get(hpo_id, canonical_name)
    alias_hpo = CANONICAL_ALIASES.get(canonical_name.lower().strip())
    if alias_hpo:
        return alias_hpo, _HPO_TO_CANONICAL.get(alias_hpo, canonical_name) if _HPO_TO_CANONICAL else canonical_name
    return None, canonical_name


def _load_model_and_index():
    global _TOKENIZER, _MODEL, _NAME_TO_HPOS, _HPO_TO_CANONICAL

    if KNOWLEDGE_PATH:
        kpath = Path(KNOWLEDGE_PATH)
        if kpath.is_file():
            logger.info("Loading HPO synonym index from %s", kpath)
            _NAME_TO_HPOS, _HPO_TO_CANONICAL = _build_synonym_index(kpath)
            logger.info("  %d normalised names -> HPO IDs", len(_NAME_TO_HPOS))
        else:
            logger.warning(
                "CLARIO_KNOWLEDGE_PATH=%s not found — HPO IDs will be omitted from output",
                KNOWLEDGE_PATH,
            )
    else:
        logger.warning(
            "CLARIO_KNOWLEDGE_PATH not set — HPO IDs will be omitted from output. "
            "Build a disease_knowledge.json via scripts/build_knowledge.py to enable resolution."
        )

    logger.info("Loading tokenizer + base: %s", BASE_MODEL_ID)
    _TOKENIZER = AutoTokenizer.from_pretrained(BASE_MODEL_ID)
    if _TOKENIZER.pad_token is None:
        _TOKENIZER.pad_token = _TOKENIZER.eos_token

    bnb_cfg = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL_ID,
        quantization_config=bnb_cfg,
        dtype=torch.bfloat16,
        device_map={"": 0},
        attn_implementation="eager",
    )
    logger.info("Loading adapter: %s", ADAPTER)
    _MODEL = PeftModel.from_pretrained(base, ADAPTER)
    _MODEL.eval()
    logger.info("Sidecar ready on :%d", PORT)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_model_and_index()
    yield


app = FastAPI(lifespan=lifespan, title="Clario Extractor Sidecar")


class ExtractRequest(BaseModel):
    diary: str
    ts_recorded: str | None = None


class ClarioEntity(BaseModel):
    type: str
    name: str
    attrs: dict


class ExtractResponse(BaseModel):
    entities: list[ClarioEntity]
    ts_event_hint: str | None = None


def _generate(diary: str, max_new_tokens: int = 512) -> str:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for ex in FEW_SHOT:
        messages.append({"role": "user", "content": ex["user"]})
        messages.append({"role": "assistant", "content": ex["assistant"]})
    messages.append({"role": "user", "content": f"Diary entry:\n{diary}"})
    prompt = _TOKENIZER.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = _TOKENIZER(prompt, return_tensors="pt").to(_MODEL.device)
    with torch.inference_mode():
        out = _MODEL.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            temperature=1.0,
            pad_token_id=_TOKENIZER.pad_token_id,
        )
    gen_ids = out[0, inputs["input_ids"].shape[1]:]
    return _TOKENIZER.decode(gen_ids, skip_special_tokens=True)


@app.get("/health")
def health():
    return {
        "ready": _MODEL is not None,
        "adapter": ADAPTER,
        "hpo_index_loaded": _NAME_TO_HPOS is not None,
    }


@app.post("/extract", response_model=ExtractResponse)
def extract(req: ExtractRequest):
    if _MODEL is None:
        raise HTTPException(503, "model not ready")
    raw = _generate(req.diary)
    pred = _extract_json(raw)
    if pred is None:
        return ExtractResponse(entities=[], ts_event_hint=None)

    entities: list[ClarioEntity] = []
    for ent in pred.get("entities", []) or []:
        etype = (ent.get("type") or "").strip().lower()
        if etype not in CLARIO_ENTITY_TYPES:
            continue
        canon_raw = (ent.get("name_canonical") or "").strip()
        if not canon_raw:
            continue
        hpo_id, canon_resolved = _resolve_hpo(canon_raw)
        attrs: dict = {"name_colloquial": (ent.get("name_colloquial") or "").strip()}
        if hpo_id:
            attrs["hpo_id"] = hpo_id
        entities.append(ClarioEntity(
            type=etype,
            name=canon_resolved.lower(),
            attrs=attrs,
        ))
    return ExtractResponse(entities=entities, ts_event_hint=None)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
