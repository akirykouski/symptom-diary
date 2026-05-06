"""Hypothesis Engine endpoints."""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from .. import hypothesis_engine as he
from .. import knowledge_base as kb
from ..deps import require_unlocked
from ..llm import OllamaClient

router = APIRouter(tags=["hypotheses"])


class HypothesisPatch(BaseModel):
    status: str | None = None  # active|dismissed|expired|confirmed|suppressed
    user_note: str | None = None
    dismissed_reason: str | None = None
    corroborate_entry_id: str | None = None
    uncorroborate_entry_id: str | None = None


@router.get("/api/hypotheses")
def list_hypotheses(
    status: str | None = Query("active"),
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> list[dict]:
    """List active (default) hypotheses, sorted by signal strength."""
    if status == "all":
        return he.list_hypotheses(conn, status=None)
    return he.list_hypotheses(conn, status=status)


@router.get("/api/hypotheses/feedback-history")
def feedback_history(
    limit: int = Query(50, ge=1, le=500),
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> list[dict]:
    return he.feedback_history(conn, limit=limit)


@router.get("/api/hypotheses/{hid}")
def get_hypothesis(
    hid: str,
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> dict:
    h = he.get_hypothesis(conn, hid)
    if h is None:
        raise HTTPException(status_code=404, detail="not_found")
    return h


@router.patch("/api/hypotheses/{hid}")
def patch_hypothesis(
    hid: str,
    body: HypothesisPatch,
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> dict:
    if body.corroborate_entry_id is not None:
        ok = he.corroborate_entry(
            conn, hypothesis_id=hid, entry_id=body.corroborate_entry_id
        )
        if not ok:
            raise HTTPException(status_code=404, detail="hypothesis_or_entry_not_found")
    if body.uncorroborate_entry_id is not None:
        he.uncorroborate_entry(
            conn, hypothesis_id=hid, entry_id=body.uncorroborate_entry_id
        )

    h = he.update_hypothesis_status(
        conn,
        hid,
        status=body.status,
        user_note=body.user_note,
        dismissed_reason=body.dismissed_reason,
    )
    if h is None:
        raise HTTPException(status_code=404, detail="not_found_or_invalid_status")
    return h


@router.post("/api/hypotheses/recheck")
async def recheck(conn: sqlite3.Connection = Depends(require_unlocked)) -> dict:
    """Run the matching pipeline against the current journal state."""
    # Auto-seed the KB on first use so the demo works with one click.
    status = kb.kb_status(conn)
    if status["disease_count"] == 0:
        await kb.ingest_seed(conn, llm=OllamaClient(), embed=True)

    summary = await he.recheck(conn, llm=OllamaClient())
    return summary


@router.get("/api/kb/status")
def kb_status(conn: sqlite3.Connection = Depends(require_unlocked)) -> dict:
    return kb.kb_status(conn)


@router.post("/api/kb/sync")
async def kb_sync(
    embed: bool = Query(True),
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> dict:
    return await kb.ingest_seed(conn, llm=OllamaClient(), embed=embed)
