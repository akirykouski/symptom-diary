"""Hypothesis Engine endpoints."""
from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from .. import hypothesis_engine as he
from .. import knowledge_base as kb
from ..deps import require_unlocked
from ..llm import OllamaClient

router = APIRouter(tags=["hypotheses"])


class HypothesisPatch(BaseModel):
    status: str | None = None  # active|dismissed|expired|confirmed
    user_note: str | None = None
    dismissed_reason: str | None = None


@router.get("/api/hypotheses")
def list_hypotheses(
    status: str | None = Query("active"),
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> list[dict]:
    """List active (default) hypotheses, sorted by signal strength."""
    if status == "all":
        return he.list_hypotheses(conn, status=None)
    return he.list_hypotheses(conn, status=status)


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
