"""Bootstrap endpoints — detect / install / start / stop Ollama."""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from .. import ollama_setup
from ..deps import require_unlocked

router = APIRouter(prefix="/api/ollama", tags=["ollama-setup"])


@router.get("/setup")
async def get_setup_state(
    _: sqlite3.Connection = Depends(require_unlocked),
) -> dict:
    return await ollama_setup.detect_state()


@router.get("/daemon")
def get_daemon_state(_: sqlite3.Connection = Depends(require_unlocked)) -> dict:
    return ollama_setup.daemon_status()


@router.post("/install/{method}")
async def post_install(
    method: str,
    _: sqlite3.Connection = Depends(require_unlocked),
):
    """Stream installer output as NDJSON. The frontend reads each line
    and renders a live console."""
    state = await ollama_setup.detect_state()
    runnable_ids = {m["id"] for m in state["methods"] if m.get("auto_runnable")}
    if method not in runnable_ids:
        raise HTTPException(
            status_code=400,
            detail=f"method {method!r} is not auto-runnable on this platform",
        )
    return StreamingResponse(
        ollama_setup.run_install(method),
        media_type="application/x-ndjson",
    )


@router.post("/start")
async def post_start(_: sqlite3.Connection = Depends(require_unlocked)) -> dict:
    return await ollama_setup.start_daemon()


@router.post("/stop")
def post_stop(_: sqlite3.Connection = Depends(require_unlocked)) -> dict:
    return ollama_setup.stop_daemon()
