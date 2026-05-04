"""Background processing for uploaded media.

A media row arrives in `status='pending'`. The worker picks it up, runs the
appropriate pipeline (vision caption / vision document extract / whisper
transcript), updates the row, and triggers a re-extraction of the parent
entry so anything we learned (caption, lab values, drugs) lands in the graph.
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone

from . import audio as audio_mod
from . import documents
from . import media as media_mod
from .config import VISION_MODEL
from .db import transaction
from .extraction import enqueue_job
from .llm import OllamaClient, OllamaError
from .session import store

logger = logging.getLogger("diary.media_jobs")


_VISION_CAPTION_PROMPT = (
    "Describe this photo in 1-3 sentences from the perspective of a symptom "
    "diary. Mention any visible symptoms, body parts, lesions, swellings, or "
    "rashes. If text is visible, transcribe it briefly. Do NOT diagnose."
)
_VISION_CAPTION_SYSTEM = (
    "You write short, factual descriptions of medical/personal photos. "
    "No diagnoses, no speculation. If unsure about a feature, say so plainly."
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mark_status(conn: sqlite3.Connection, media_id: str, status: str,
                 *, error: str | None = None, processed: bool = False) -> None:
    if processed:
        conn.execute(
            "UPDATE media SET status = ?, last_error = ?, processed_at = ? WHERE id = ?",
            (status, error, _now(), media_id),
        )
    else:
        conn.execute(
            "UPDATE media SET status = ?, last_error = ? WHERE id = ?",
            (status, error, media_id),
        )


async def process_one(conn: sqlite3.Connection, *, llm: OllamaClient) -> bool:
    """Pick one pending media row and process it. Returns True if work was done."""
    row = conn.execute(
        "SELECT id, entry_id, kind, mime, storage_path, description, transcript "
        "FROM media WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
    ).fetchone()
    if row is None:
        return False

    media_id = row["id"]
    entry_id = row["entry_id"]
    kind = row["kind"]
    _mark_status(conn, media_id, "running")

    master_key = store.peek_master_key()
    if master_key is None:
        # Locked — bounce back to pending; we'll retry once the user unlocks.
        _mark_status(conn, media_id, "pending", error="locked")
        return False

    storage = media_mod.media_file_path(entry_id, media_id)

    try:
        if kind == "image":
            await _process_image(conn, media_id=media_id, entry_id=entry_id,
                                 storage=storage, llm=llm, master_key=master_key)
        elif kind == "document":
            await _process_document(conn, media_id=media_id, entry_id=entry_id,
                                    storage=storage, llm=llm, master_key=master_key)
        elif kind == "audio":
            _process_audio(conn, media_id=media_id, entry_id=entry_id,
                           storage=storage, master_key=master_key)
        else:
            _mark_status(conn, media_id, "failed",
                         error=f"unknown kind: {kind}", processed=True)
            return True

        _mark_status(conn, media_id, "done", processed=True)
        # Re-extract the parent entry now that we have new context.
        enqueue_job(conn, entry_id)
    except OllamaError as e:
        _mark_status(conn, media_id, "failed", error=f"ollama: {e}", processed=True)
        logger.warning("media %s ollama failure: %s", media_id, e)
    except Exception as e:  # noqa: BLE001
        _mark_status(conn, media_id, "failed",
                     error=f"{type(e).__name__}: {e}", processed=True)
        logger.exception("media %s crashed", media_id)
    return True


async def _process_image(
    conn: sqlite3.Connection,
    *,
    media_id: str,
    entry_id: str,
    storage,
    llm: OllamaClient,
    master_key: bytes,
) -> None:
    raw = media_mod.decrypt_all(storage, master_key=master_key)
    caption = await llm.generate_text(
        _VISION_CAPTION_PROMPT,
        model=VISION_MODEL,
        system=_VISION_CAPTION_SYSTEM,
        images=[raw],
        timeout=180.0,
    )
    caption = caption.strip()
    if len(caption) > 4000:
        caption = caption[:4000]
    with transaction(conn):
        conn.execute(
            "UPDATE media SET description = ? WHERE id = ?",
            (caption, media_id),
        )
        if caption:
            _append_to_entry_text(conn, entry_id, f"\n\n> [photo] {caption}")


async def _process_document(
    conn: sqlite3.Connection,
    *,
    media_id: str,
    entry_id: str,
    storage,
    llm: OllamaClient,
    master_key: bytes,
) -> None:
    raw = media_mod.decrypt_all(storage, master_key=master_key)
    payload = await documents.extract_document(llm, image_bytes=raw)
    summary = _summarize_document(payload)
    with transaction(conn):
        conn.execute(
            "UPDATE media SET description = ? WHERE id = ?",
            (summary, media_id),
        )
        documents.persist_document(conn, media_id=media_id, payload=payload)
        if summary:
            _append_to_entry_text(conn, entry_id, f"\n\n> [document] {summary}")


def _process_audio(
    conn: sqlite3.Connection,
    *,
    media_id: str,
    entry_id: str,
    storage,
    master_key: bytes,
) -> None:
    raw = media_mod.decrypt_all(storage, master_key=master_key)
    transcript = audio_mod.transcribe(raw)
    if transcript is None:
        # Whisper unavailable — leave transcript empty but mark done so the file
        # is still browsable. The user can hand-edit the entry text later.
        with transaction(conn):
            conn.execute(
                "UPDATE media SET transcript = NULL WHERE id = ?",
                (media_id,),
            )
        return
    with transaction(conn):
        conn.execute(
            "UPDATE media SET transcript = ? WHERE id = ?",
            (transcript, media_id),
        )
        if transcript.strip():
            _append_to_entry_text(conn, entry_id, f"\n\n> [audio transcript] {transcript.strip()}")


def _summarize_document(payload: dict) -> str:
    parts: list[str] = []
    doc_type = payload.get("doc_type") or "document"
    parts.append(doc_type.replace("_", " "))
    if payload.get("clinician_name"):
        parts.append(f"by {payload['clinician_name']}")
    if payload.get("doc_date"):
        parts.append(f"({payload['doc_date']})")
    labs = payload.get("lab_values") or []
    if labs:
        parts.append(f"{len(labs)} lab values")
    meds = payload.get("medications") or []
    if meds:
        parts.append(f"{len(meds)} medications")
    findings = payload.get("findings_md")
    if findings and isinstance(findings, str):
        excerpt = findings.strip().replace("\n", " ")
        if len(excerpt) > 220:
            excerpt = excerpt[:220].rstrip() + "…"
        parts.append("— " + excerpt)
    return " ".join(parts)


def _append_to_entry_text(conn: sqlite3.Connection, entry_id: str, addendum: str) -> None:
    row = conn.execute("SELECT text_md FROM entry WHERE id = ?", (entry_id,)).fetchone()
    if row is None:
        return
    current = row["text_md"] or ""
    if addendum.strip() in current:
        return  # idempotent re-runs
    new_text = (current + addendum).strip()
    conn.execute(
        "UPDATE entry SET text_md = ?, updated_at = ? WHERE id = ?",
        (new_text, _now(), entry_id),
    )
