"""Brief generation + ask-anything endpoints."""
from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from .. import brief
from ..deps import require_unlocked
from ..llm import OllamaClient


router = APIRouter(tags=["insights"])


class BriefRequest(BaseModel):
    from_: Optional[str] = None
    to: Optional[str] = None
    enrich: bool = False  # if True, ask Gemma for an intro paragraph


@router.post("/api/insights/brief")
async def post_brief(
    body: BriefRequest,
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> dict:
    ctx = brief.gather_context(conn, from_=body.from_, to=body.to)
    intro = await brief.maybe_intro(ctx, llm=OllamaClient()) if body.enrich else None
    md = brief.render_markdown(ctx)
    if intro:
        md = md.replace("## At a glance", "## Patient-reported context\n\n" + intro + "\n\n## At a glance", 1)
    return {
        "markdown": md,
        "stats": {
            "entries": len(ctx["entries"]),
            "documents": len(ctx["documents"]),
            "abnormal_labs": len(ctx["abnormal_labs"]),
            "medications": len(ctx["medications"]),
            "hypotheses": len(ctx["hypotheses"]),
        },
    }


@router.get("/api/insights/brief.html", response_class=HTMLResponse)
async def get_brief_html(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    enrich: bool = Query(False),
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> HTMLResponse:
    ctx = brief.gather_context(conn, from_=from_, to=to)
    intro = await brief.maybe_intro(ctx, llm=OllamaClient()) if enrich else None
    md = brief.render_markdown(ctx)
    if intro:
        md = md.replace("## At a glance", "## Patient-reported context\n\n" + intro + "\n\n## At a glance", 1)
    html = brief.render_html(md)
    return HTMLResponse(content=html)
