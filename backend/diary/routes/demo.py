"""Demo data endpoints — load synthetic patients for the video pitch."""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from .. import demo_data
from ..deps import require_unlocked

router = APIRouter(tags=["demo"])


class LoadDemoBody(BaseModel):
    persona_id: str
    overwrite: bool = False


@router.get("/api/demo/personas")
def list_personas() -> list[dict]:
    return demo_data.list_personas()


@router.post("/api/demo/load")
def load_demo(
    body: LoadDemoBody,
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> dict:
    try:
        return demo_data.seed_persona(
            conn, body.persona_id, overwrite=body.overwrite
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/api/demo/active")
def active_persona(conn: sqlite3.Connection = Depends(require_unlocked)) -> dict:
    row = conn.execute("SELECT value FROM meta WHERE key = 'demo_persona'").fetchone()
    return {"persona_id": row["value"] if row is not None else None}
