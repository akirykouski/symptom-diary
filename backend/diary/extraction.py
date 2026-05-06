"""Background extraction pipeline.

For each entry:
  1. Ask the LLM to return structured `{entities, ts_event_hint}` JSON.
  2. Embed each entity name. Cosine-search `entity_vec` (top-3 within `type`).
     Above threshold → link & extend aliases. Otherwise → create new entity.
  3. Insert `entity_mention` rows.
  4. Upsert `co_occurs` edges between every pair of mentions in this entry.
  5. Upsert `precedes` edges to neighboring entries within ±N hours.

The worker runs as a single asyncio task started from the FastAPI lifespan and
polls `extraction_job` for `queued` rows. It uses the global session
connection (single-user app), so no thread-safety wrappers are needed.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import sqlite3
import struct
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable

from .config import ENTITY_LINK_THRESHOLD, LLM_MODEL, PRECEDES_WINDOW_HOURS
from .db import IntegrityError, transaction
from .llm import OllamaClient, OllamaError
from .session import store

logger = logging.getLogger("diary.extraction")

ENTITY_TYPES = {
    "symptom",
    "trigger",
    "bodypart",
    "med",
    "lab_marker",
    "food",
    "activity",
    "emotion",
    "other",
}

EXTRACTION_SYSTEM_PROMPT = (
    "You extract structured medical journal entities from a diary entry.\n"
    "Output STRICT JSON only — no prose, no markdown, no code fences.\n"
    "When the entity is a lab test or biomarker (e.g. ANA, C3, hemoglobin, "
    "ferritin, TSH, anti-dsDNA, CRP, ESR), use type='lab_marker' — NOT 'med'. "
    "Reserve 'med' for prescribed or over-the-counter pharmaceuticals.\n"
)


# Curated set of lab tests / biomarkers used to enforce `lab_marker` typing
# even if the LLM tags them as `med` or `symptom`. Keys are normalized via
# `_normalize_marker` (lowercase, separators collapsed to a single dash) so
# variants like "anti dsdna" / "anti-dsDNA" / "anti_dsdna" all match.
_KNOWN_LAB_MARKERS_RAW = (
    # Autoimmune / complement (the original feedback case)
    "ana", "ena", "anti-dsdna", "anti-sm", "anti-rnp", "anti-ro", "anti-la",
    "anti-ccp", "ccp", "rheumatoid factor", "rf", "complement", "c3", "c4",
    "immunoglobulin", "igg", "iga", "igm", "ige",
    # Inflammation
    "crp", "c-reactive protein", "esr", "sed rate",
    # Hematology
    "hemoglobin", "hgb", "hb", "hematocrit", "hct", "wbc", "white blood cell count",
    "rbc", "red blood cell count", "platelets", "plt", "mcv", "mch", "mchc",
    "rdw", "neutrophils", "lymphocytes", "monocytes", "eosinophils",
    # Iron
    "ferritin", "iron", "transferrin", "tibc",
    # Liver
    "alt", "ast", "alp", "ggt", "bilirubin", "albumin", "total protein",
    # Kidney
    "creatinine", "urea", "bun", "egfr", "gfr",
    # Electrolytes
    "sodium", "potassium", "chloride", "calcium", "magnesium", "phosphate",
    "bicarbonate",
    # Endocrine / metabolism
    "glucose", "hba1c", "a1c", "insulin", "tsh", "t3", "t4", "free t3", "free t4",
    "ft3", "ft4",
    # Lipids
    "cholesterol", "hdl", "ldl", "triglycerides",
    # Vitamins
    "b12", "folate", "vitamin d", "25-oh-d", "25 hydroxyvitamin d",
    # Coagulation
    "pt", "inr", "ptt", "aptt", "fibrinogen",
    # Cardiac
    "troponin", "bnp", "nt-probnp",
    # Other
    "ldh", "lipase", "amylase", "ck", "ck-mb",
    # Tumor markers
    "psa", "ca-125", "cea", "afp",
)


def _normalize_marker(s: str) -> str:
    return re.sub(r"[\s\-_/]+", "-", s.strip().lower())


KNOWN_LAB_MARKERS: frozenset[str] = frozenset(
    _normalize_marker(m) for m in _KNOWN_LAB_MARKERS_RAW
)

EXTRACTION_SCHEMA = {
    "type": "object",
    "required": ["entities"],
    "properties": {
        "entities": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["type", "name"],
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": list(ENTITY_TYPES),
                    },
                    "name": {"type": "string"},
                    "attrs": {"type": "object"},
                },
            },
        },
        "ts_event_hint": {"type": ["string", "null"]},
    },
}


def _build_prompt(text_md: str, ts_recorded: str) -> str:
    return (
        "Schema:\n"
        '{ "entities": [{"type":"symptom|trigger|bodypart|med|lab_marker|food|activity|emotion|other",'
        ' "name":"lowercase canonical","attrs":{"severity"?:0-10,"body_part"?:string,"modifier"?:string}}],'
        ' "ts_event_hint": "ISO8601 if user mentioned a relative time, else null" }\n'
        "Use `lab_marker` for lab tests / biomarkers (ANA, C3, hemoglobin, "
        "ferritin, TSH, anti-dsDNA, CRP, ESR …). Use `med` only for actual "
        "drugs / prescriptions / OTC medications.\n"
        f"Current time: {ts_recorded}.\n"
        "Diary entry follows.\n---\n"
        f"{text_md}\n"
    )


# ---------- vector helpers ----------------------------------------------------


def _pack_vec(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def _unpack_vec(buf: bytes) -> list[float]:
    n = len(buf) // 4
    return list(struct.unpack(f"{n}f", buf))


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / ((na**0.5) * (nb**0.5))


# ---------- core pipeline -----------------------------------------------------


@dataclass
class ExtractedEntity:
    type: str
    name: str
    attrs: dict


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_response(payload: dict) -> tuple[list[ExtractedEntity], str | None]:
    raw_entities = payload.get("entities") or []
    out: list[ExtractedEntity] = []
    for item in raw_entities:
        if not isinstance(item, dict):
            continue
        etype = (item.get("type") or "").strip().lower()
        name = (item.get("name") or "").strip().lower()
        if not name or etype not in ENTITY_TYPES:
            continue
        # Defense-in-depth: even if the LLM mistypes a known lab marker as
        # `med` or `symptom`, force it back to `lab_marker` so the brief's
        # symptom filter and the medication section stay clean.
        if _normalize_marker(name) in KNOWN_LAB_MARKERS:
            etype = "lab_marker"
        attrs = item.get("attrs") if isinstance(item.get("attrs"), dict) else {}
        out.append(ExtractedEntity(type=etype, name=name, attrs=attrs))

    hint = payload.get("ts_event_hint")
    if isinstance(hint, str) and not hint.strip():
        hint = None
    if hint is not None and not isinstance(hint, str):
        hint = None
    return out, hint


def _link_or_create_entity(
    conn: sqlite3.Connection,
    *,
    extracted: ExtractedEntity,
    embedding: list[float],
) -> str:
    """Returns the entity_id this extraction is linked to."""
    # Find candidates of the same type via vec0 KNN.
    candidates = conn.execute(
        """
        SELECT v.entity_id, v.distance
        FROM entity_vec v
        WHERE v.embedding MATCH ?
        ORDER BY v.distance
        LIMIT 5
        """,
        (_pack_vec(embedding),),
    ).fetchall()

    best_id: str | None = None
    best_score = 0.0
    for row in candidates:
        cand = conn.execute(
            "SELECT id, type, embedding FROM entity WHERE id = ?", (row["entity_id"],)
        ).fetchone()
        if cand is None or cand["type"] != extracted.type:
            continue
        score = _cosine(embedding, _unpack_vec(cand["embedding"]))
        if score > best_score:
            best_score = score
            best_id = cand["id"]

    if best_id is not None and best_score >= ENTITY_LINK_THRESHOLD:
        # Link: extend aliases, bump updated_at.
        row = conn.execute("SELECT aliases FROM entity WHERE id = ?", (best_id,)).fetchone()
        aliases = set(json.loads(row["aliases"]))
        aliases.add(extracted.name)
        conn.execute(
            "UPDATE entity SET aliases = ?, updated_at = ? WHERE id = ?",
            (json.dumps(sorted(aliases)), _now(), best_id),
        )
        return best_id

    # Create new
    new_id = str(uuid.uuid4())
    now = _now()
    conn.execute(
        """
        INSERT INTO entity
          (id, type, canonical_name, aliases, embedding, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id,
            extracted.type,
            extracted.name,
            json.dumps([extracted.name]),
            _pack_vec(embedding),
            now,
            now,
        ),
    )
    conn.execute(
        "INSERT INTO entity_vec (entity_id, embedding) VALUES (?, ?)",
        (new_id, _pack_vec(embedding)),
    )
    return new_id


def _upsert_edge(
    conn: sqlite3.Connection,
    *,
    src: str,
    dst: str,
    kind: str,
    observed_at: str,
) -> None:
    if src == dst:
        return
    # Normalize co_occurs to undirected (lex order); precedes stays directional.
    if kind == "co_occurs" and src > dst:
        src, dst = dst, src

    row = conn.execute(
        "SELECT id, weight, evidence_count FROM edge "
        "WHERE src_entity_id = ? AND dst_entity_id = ? AND kind = ?",
        (src, dst, kind),
    ).fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO edge "
            "(id, src_entity_id, dst_entity_id, kind, weight, evidence_count, last_observed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), src, dst, kind, 1.0, 1, observed_at),
        )
    else:
        conn.execute(
            "UPDATE edge SET weight = weight + 1.0, evidence_count = evidence_count + 1, "
            "last_observed_at = MAX(COALESCE(last_observed_at, ''), ?) WHERE id = ?",
            (observed_at, row["id"]),
        )


# ---------- worker entry point ------------------------------------------------


async def process_one(
    conn: sqlite3.Connection,
    *,
    entry_id: str,
    llm: OllamaClient,
) -> None:
    """Run the full extraction for a single entry. Caller manages the job row."""
    entry = conn.execute(
        "SELECT id, ts_recorded, ts_event, text_md FROM entry WHERE id = ?",
        (entry_id,),
    ).fetchone()
    if entry is None:
        return

    payload = await llm.generate_json(
        _build_prompt(entry["text_md"], entry["ts_recorded"]),
        model=LLM_MODEL,
        format_schema=EXTRACTION_SCHEMA,
        system=EXTRACTION_SYSTEM_PROMPT,
    )
    extracted, ts_hint = _parse_response(payload)

    # Embed names in parallel.
    embeddings: list[list[float]] = await asyncio.gather(
        *(llm.embed(item.name) for item in extracted)
    ) if extracted else []

    with transaction(conn):
        # Replace any prior mentions/edges for this entry (idempotent re-extract).
        old_mentions = conn.execute(
            "SELECT entity_id FROM entity_mention WHERE entry_id = ?", (entry_id,)
        ).fetchall()
        if old_mentions:
            old_ids = [r["entity_id"] for r in old_mentions]
            conn.execute("DELETE FROM entity_mention WHERE entry_id = ?", (entry_id,))
            # Decrement edge weights touching this entry's old set; if weight ≤ 0, delete.
            for src in old_ids:
                for dst in old_ids:
                    if src == dst:
                        continue
                    a, b = (src, dst) if src < dst else (dst, src)
                    conn.execute(
                        "UPDATE edge SET weight = weight - 1.0, "
                        "evidence_count = evidence_count - 1 "
                        "WHERE src_entity_id = ? AND dst_entity_id = ? AND kind = 'co_occurs'",
                        (a, b),
                    )
            conn.execute("DELETE FROM edge WHERE evidence_count <= 0")

        if ts_hint:
            try:
                # Validate by parsing.
                datetime.fromisoformat(ts_hint.replace("Z", "+00:00"))
                conn.execute(
                    "UPDATE entry SET ts_event = ?, updated_at = ? WHERE id = ?",
                    (ts_hint, _now(), entry_id),
                )
                # Re-fetch since we'll need ts_event for the precedes edges.
                entry = conn.execute(
                    "SELECT id, ts_recorded, ts_event, text_md FROM entry WHERE id = ?",
                    (entry_id,),
                ).fetchone()
            except ValueError:
                pass

        entity_ids: list[str] = []
        for item, emb in zip(extracted, embeddings):
            eid = _link_or_create_entity(conn, extracted=item, embedding=emb)
            conn.execute(
                """
                INSERT INTO entity_mention
                  (id, entry_id, entity_id, span_start, span_end, confidence, attrs)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    entry_id,
                    eid,
                    None,
                    None,
                    None,
                    json.dumps(item.attrs),
                ),
            )
            entity_ids.append(eid)

        # co_occurs edges among this entry's entities.
        unique_ids = list(dict.fromkeys(entity_ids))
        for i, src in enumerate(unique_ids):
            for dst in unique_ids[i + 1:]:
                _upsert_edge(
                    conn,
                    src=src,
                    dst=dst,
                    kind="co_occurs",
                    observed_at=entry["ts_event"],
                )

        # precedes edges from neighbors within ±window.
        if unique_ids:
            ts_event = entry["ts_event"]
            try:
                dt = datetime.fromisoformat(ts_event.replace("Z", "+00:00"))
            except ValueError:
                dt = None
            if dt is not None:
                window = timedelta(hours=PRECEDES_WINDOW_HOURS)
                lo = (dt - window).isoformat()
                hi = (dt + window).isoformat()
                neighbors = conn.execute(
                    """
                    SELECT em.entity_id, e.ts_event
                    FROM entity_mention em
                    JOIN entry e ON e.id = em.entry_id
                    WHERE e.id != ? AND e.ts_event BETWEEN ? AND ?
                    """,
                    (entry_id, lo, hi),
                ).fetchall()
                for n in neighbors:
                    n_id = n["entity_id"]
                    n_dt = datetime.fromisoformat(n["ts_event"].replace("Z", "+00:00"))
                    for own_id in unique_ids:
                        if n_id == own_id:
                            continue
                        src, dst = (n_id, own_id) if n_dt < dt else (own_id, n_id)
                        _upsert_edge(
                            conn, src=src, dst=dst, kind="precedes", observed_at=ts_event,
                        )


# ---------- supervisor loop ---------------------------------------------------


async def worker_loop(*, idle_seconds: float = 1.0) -> None:
    from . import media_jobs  # avoid circular import at module load

    llm = OllamaClient()
    logger.info("extraction worker started")
    while True:
        try:
            did_media = await _tick_media(llm, media_jobs)
            did_text = await _tick(llm)
            # If we did real work, keep looping fast; otherwise back off.
            if did_media or did_text:
                continue
        except asyncio.CancelledError:
            logger.info("extraction worker stopping")
            return
        except Exception:  # noqa: BLE001
            logger.exception("extraction worker unexpected error")
        await asyncio.sleep(idle_seconds)


async def _tick_media(llm: OllamaClient, media_jobs) -> bool:
    conn = store.peek_conn()
    if conn is None:
        return False
    try:
        return await media_jobs.process_one(conn, llm=llm)
    except Exception:  # noqa: BLE001
        logger.exception("media tick failed")
        return False


async def _tick(llm: OllamaClient) -> bool:
    conn = store.peek_conn()
    if conn is None:
        return False
    job = conn.execute(
        "SELECT entry_id, attempts FROM extraction_job "
        "WHERE status = 'queued' "
        "ORDER BY created_at ASC LIMIT 1"
    ).fetchone()
    if job is None:
        return False
    entry_id = job["entry_id"]
    attempts = job["attempts"]
    now = _now()
    conn.execute(
        "UPDATE extraction_job SET status = 'running', attempts = ?, updated_at = ? "
        "WHERE entry_id = ?",
        (attempts + 1, now, entry_id),
    )
    try:
        await process_one(conn, entry_id=entry_id, llm=llm)
    except OllamaError as e:
        conn.execute(
            "UPDATE extraction_job SET status = 'failed', last_error = ?, updated_at = ? "
            "WHERE entry_id = ?",
            (str(e), _now(), entry_id),
        )
        logger.warning("extraction failed for %s: %s", entry_id, e)
        return True
    except Exception as e:  # noqa: BLE001
        conn.execute(
            "UPDATE extraction_job SET status = 'failed', last_error = ?, updated_at = ? "
            "WHERE entry_id = ?",
            (f"{type(e).__name__}: {e}", _now(), entry_id),
        )
        logger.exception("extraction crashed for %s", entry_id)
        return True

    conn.execute(
        "UPDATE extraction_job SET status = 'done', last_error = NULL, updated_at = ? "
        "WHERE entry_id = ?",
        (_now(), entry_id),
    )
    return True


def enqueue_job(conn: sqlite3.Connection, entry_id: str) -> None:
    try:
        conn.execute(
            "INSERT INTO extraction_job (entry_id, status, attempts, created_at, updated_at) "
            "VALUES (?, 'queued', 0, ?, ?)",
            (entry_id, _now(), _now()),
        )
    except IntegrityError:
        # Already exists — reset to queued for re-extraction.
        conn.execute(
            "UPDATE extraction_job SET status = 'queued', last_error = NULL, updated_at = ? "
            "WHERE entry_id = ?",
            (_now(), entry_id),
        )


def queue_summary(conn: sqlite3.Connection) -> dict[str, int]:
    rows = conn.execute(
        "SELECT status, COUNT(*) AS n FROM extraction_job GROUP BY status"
    ).fetchall()
    summary = {"queued": 0, "running": 0, "done": 0, "failed": 0}
    for row in rows:
        summary[row["status"]] = row["n"]
    return summary


def queue_jobs(conn: sqlite3.Connection, *, limit: int = 50) -> list[dict]:
    rows = conn.execute(
        "SELECT entry_id, status, attempts, last_error, updated_at "
        "FROM extraction_job ORDER BY updated_at DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]
