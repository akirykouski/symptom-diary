"""Structured medical-document extraction.

Pipeline:
  1. Vision Gemma is asked to return a strict JSON object describing the
     document (visit note / lab result / prescription / imaging / discharge).
  2. We persist the raw JSON in `document_record.raw_extracted_json` for
     audit, then unpack the typed pieces into `document_record`,
     `lab_value`, and `medication_record` rows.
  3. Drug names are also pushed back through the entity extraction pipeline
     so they appear in the graph as `med` entities.
"""
from __future__ import annotations

import json
import logging
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from dateutil import parser as dateparser

from .config import VISION_MODEL
from .llm import OllamaClient, OllamaError

logger = logging.getLogger("diary.documents")


DOC_TYPES = {
    "visit_note", "lab_result", "prescription", "imaging", "discharge", "referral", "other",
}


DOCUMENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["doc_type"],
    "properties": {
        "doc_type": {"type": "string", "enum": sorted(DOC_TYPES)},
        "doc_date": {"type": ["string", "null"]},
        "clinician_name": {"type": ["string", "null"]},
        "clinician_specialty": {"type": ["string", "null"]},
        "facility": {"type": ["string", "null"]},
        "language_detected": {"type": ["string", "null"]},
        "findings_md": {"type": ["string", "null"]},
        "recommendations_md": {"type": ["string", "null"]},
        "lab_values": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "test_name_raw": {"type": "string"},
                    "value_numeric": {"type": ["number", "null"]},
                    "value_text": {"type": ["string", "null"]},
                    "unit": {"type": ["string", "null"]},
                    "reference_low": {"type": ["number", "null"]},
                    "reference_high": {"type": ["number", "null"]},
                    "measured_at": {"type": ["string", "null"]},
                },
                "required": ["test_name_raw"],
            },
        },
        "medications": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "drug_name_raw": {"type": "string"},
                    "dose": {"type": ["string", "null"]},
                    "frequency": {"type": ["string", "null"]},
                    "duration": {"type": ["string", "null"]},
                },
                "required": ["drug_name_raw"],
            },
        },
        "icd_codes": {"type": "array", "items": {"type": "string"}},
        "extraction_confidence": {"type": ["string", "null"]},
        "fields_that_were_unclear": {"type": "array", "items": {"type": "string"}},
    },
}


SYSTEM_PROMPT = (
    "You extract structured data from a medical document image. The user "
    "photographed a doctor visit note, lab result, prescription, imaging "
    "report, or discharge summary. Output STRICT JSON only — no prose, no "
    "markdown, no code fences. Do NOT invent values: if a field is not "
    "clearly visible in the document, use null. Preserve the original "
    "language of narrative fields (findings_md, recommendations_md)."
)


def build_prompt() -> str:
    return (
        "Schema:\n"
        '{ "doc_type": "visit_note|lab_result|prescription|imaging|discharge|referral|other",'
        ' "doc_date": "ISO8601 date if visible, else null",'
        ' "clinician_name": str|null, "clinician_specialty": str|null, "facility": str|null,'
        ' "language_detected": "ISO 639-1 code or null",'
        ' "findings_md": "doctor narrative, verbatim if possible, in original language",'
        ' "recommendations_md": "what was recommended, verbatim",'
        ' "lab_values": [{"test_name_raw": str, "value_numeric": number|null,'
        ' "value_text": str|null, "unit": str|null, "reference_low": number|null,'
        ' "reference_high": number|null, "measured_at": "ISO8601 or null"}],'
        ' "medications": [{"drug_name_raw": str, "dose": str|null, "frequency": str|null, "duration": str|null}],'
        ' "icd_codes": [str], "extraction_confidence": "low|medium|high",'
        ' "fields_that_were_unclear": [str] }\n'
        "Rules:\n"
        "- If text is partially illegible, use null for that field, do not guess.\n"
        "- Lab unit examples: mg/dL, mmol/L, IU/mL, %, ng/mL.\n"
        "- Output JSON only, nothing else.\n"
    )


# ---------- canonicalization helpers -----------------------------------------


_LAB_CANON = [
    (r"\b(haemoglobin|hemoglobin|hgb|hb)\b", "hemoglobin"),
    (r"\bwbc\b|leuko(cytes?|cyte count)?", "wbc"),
    (r"\brbc\b|red blood cells?", "rbc"),
    (r"\bplt\b|platelets?", "platelets"),
    (r"\btsh\b", "tsh"),
    (r"\bft4\b|free t4", "ft4"),
    (r"\bft3\b|free t3", "ft3"),
    (r"\bcrp\b|c-reactive", "crp"),
    (r"\besr\b|sed rate", "esr"),
    (r"\bglucose|sugar\b", "glucose"),
    (r"\bhba1c|a1c\b", "hba1c"),
    (r"\bcholesterol\b", "cholesterol"),
    (r"\bldl\b", "ldl"),
    (r"\bhdl\b", "hdl"),
    (r"\btriglyceride", "triglycerides"),
    (r"\bcreatinine\b", "creatinine"),
    (r"\burea\b|bun\b", "urea"),
    (r"\bvitamin d|25-oh", "vitamin_d"),
    (r"\bvitamin b12|b-12|cobalamin", "vitamin_b12"),
    (r"\bferritin\b", "ferritin"),
    (r"\biron\b", "iron"),
    (r"\bsodium\b|na\+", "sodium"),
    (r"\bpotassium\b|k\+", "potassium"),
]


def canon_lab_name(raw: str) -> str:
    if not raw:
        return ""
    lower = raw.lower().strip()
    for pat, name in _LAB_CANON:
        if re.search(pat, lower):
            return name
    # Fallback: alphanumerics + underscores, max 64 chars.
    cleaned = re.sub(r"[^a-z0-9]+", "_", lower).strip("_")
    return cleaned[:64] or "unknown"


def canon_drug_name(raw: str) -> str:
    if not raw:
        return ""
    lower = raw.lower().strip()
    cleaned = re.sub(r"\s+\d.*$", "", lower)  # trim "ibuprofen 200 mg" → "ibuprofen"
    cleaned = re.sub(r"[^a-z0-9 \-]+", "", cleaned).strip()
    return cleaned[:120]


def parse_iso_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        # dateutil handles many formats incl. dd/mm/yyyy and yyyy-mm-dd.
        dt = dateparser.parse(value, dayfirst=False, fuzzy=True)
        return dt.isoformat()
    except (ValueError, TypeError, OverflowError):
        return None


def classify_lab(value_numeric: float | None,
                 ref_low: float | None,
                 ref_high: float | None) -> int | None:
    """-1 low, 0 normal, 1 high, None unknown."""
    if value_numeric is None:
        return None
    if ref_low is not None and value_numeric < ref_low:
        return -1
    if ref_high is not None and value_numeric > ref_high:
        return 1
    if ref_low is None and ref_high is None:
        return None
    return 0


# ---------- DB persistence ---------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def persist_document(
    conn: sqlite3.Connection,
    *,
    media_id: str,
    payload: dict[str, Any],
) -> tuple[str, list[str], list[str]]:
    """Insert document_record + lab_values + medications. Returns (doc_id, drug_names, lab_names)."""
    doc_type = payload.get("doc_type") or "other"
    if doc_type not in DOC_TYPES:
        doc_type = "other"

    doc_id = str(uuid.uuid4())
    now = _now()
    conn.execute(
        """
        INSERT INTO document_record
          (id, media_id, doc_type, doc_date, clinician_name, clinician_specialty,
           facility, language_detected, findings_md, recommendations_md,
           raw_extracted_json, user_verified, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        """,
        (
            doc_id,
            media_id,
            doc_type,
            parse_iso_date(payload.get("doc_date")),
            payload.get("clinician_name"),
            payload.get("clinician_specialty"),
            payload.get("facility"),
            payload.get("language_detected"),
            payload.get("findings_md"),
            payload.get("recommendations_md"),
            json.dumps(payload, ensure_ascii=False),
            now,
            now,
        ),
    )

    drug_names: list[str] = []
    lab_names: list[str] = []

    for raw_lab in payload.get("lab_values") or []:
        if not isinstance(raw_lab, dict):
            continue
        name_raw = (raw_lab.get("test_name_raw") or "").strip()
        if not name_raw:
            continue
        name_canon = canon_lab_name(name_raw)
        value_numeric = _maybe_float(raw_lab.get("value_numeric"))
        ref_lo = _maybe_float(raw_lab.get("reference_low"))
        ref_hi = _maybe_float(raw_lab.get("reference_high"))
        conn.execute(
            """
            INSERT INTO lab_value
              (id, document_record_id, test_name, test_name_raw, value_numeric,
               value_text, unit, reference_low, reference_high, is_abnormal,
               measured_at, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            """,
            (
                str(uuid.uuid4()),
                doc_id,
                name_canon,
                name_raw,
                value_numeric,
                raw_lab.get("value_text"),
                raw_lab.get("unit"),
                ref_lo,
                ref_hi,
                classify_lab(value_numeric, ref_lo, ref_hi),
                parse_iso_date(raw_lab.get("measured_at")),
            ),
        )
        lab_names.append(name_canon)

    for raw_med in payload.get("medications") or []:
        if not isinstance(raw_med, dict):
            continue
        drug_raw = (raw_med.get("drug_name_raw") or "").strip()
        if not drug_raw:
            continue
        drug_canon = canon_drug_name(drug_raw)
        conn.execute(
            """
            INSERT INTO medication_record
              (id, document_record_id, drug_name, drug_name_raw, dose,
               frequency, duration, prescribed_at, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
            """,
            (
                str(uuid.uuid4()),
                doc_id,
                drug_canon,
                drug_raw,
                raw_med.get("dose"),
                raw_med.get("frequency"),
                raw_med.get("duration"),
                parse_iso_date(payload.get("doc_date")),
            ),
        )
        drug_names.append(drug_canon)

    return doc_id, drug_names, lab_names


def _maybe_float(v: Any) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.replace(",", "."))
        except ValueError:
            return None
    return None


# ---------- vision call ------------------------------------------------------


async def extract_document(
    llm: OllamaClient,
    *,
    image_bytes: bytes,
    timeout: float = 240.0,
) -> dict[str, Any]:
    """Run vision Gemma against a single image and return the parsed payload."""
    try:
        return await llm.generate_json(
            build_prompt(),
            model=VISION_MODEL,
            format_schema=DOCUMENT_SCHEMA,
            system=SYSTEM_PROMPT,
            images=[image_bytes],
            timeout=timeout,
        )
    except OllamaError:
        raise
