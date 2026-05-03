"""LLM (Ollama) integration endpoints."""
from __future__ import annotations

import json
from typing import AsyncIterator

from fastapi import APIRouter, Body, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..deps import require_unlocked  # noqa: F401  (we still gate everything behind unlock)
from ..llm import OllamaClient, OllamaError

router = APIRouter(prefix="/api/llm", tags=["llm"])


class PullRequest(BaseModel):
    model: str


def _client() -> OllamaClient:
    return OllamaClient()


@router.get("/status")
async def llm_status(_: object = Depends(require_unlocked)) -> dict:
    return await _client().status()


@router.post("/pull")
async def llm_pull(
    body: PullRequest = Body(...),
    _: object = Depends(require_unlocked),
) -> StreamingResponse:
    """Streams NDJSON progress objects from `ollama pull` straight to the client.

    The frontend reads the response body line-by-line and renders progress;
    we don't translate to SSE because NDJSON is what Ollama emits natively.
    """
    client = _client()

    async def generator() -> AsyncIterator[bytes]:
        try:
            async for chunk in client.pull(body.model):
                yield (json.dumps(chunk) + "\n").encode("utf-8")
        except OllamaError as e:
            yield (json.dumps({"error": str(e)}) + "\n").encode("utf-8")

    return StreamingResponse(generator(), media_type="application/x-ndjson")
