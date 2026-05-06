"""Brief generation + ask-anything endpoints."""
from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field

from .. import ask, brief
from ..deps import require_unlocked
from ..llm import OllamaClient


router = APIRouter(tags=["insights"])


class BriefRequest(BaseModel):
    from_: Optional[str] = None
    to: Optional[str] = None
    enrich: bool = False  # if True, ask Gemma for an intro paragraph


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4_000)
    language: str = Field("en", pattern=r"^[a-z]{2}$")


async def _build_intro(ctx: dict, *, enrich: bool) -> str | None:
    """Try the LLM intro (when enrich=True); on any failure return None so
    render_markdown falls back to the deterministic summary."""
    if not enrich:
        return None
    return await brief.maybe_intro(ctx, llm=OllamaClient())


@router.post("/api/insights/brief")
async def post_brief(
    body: BriefRequest,
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> dict:
    ctx = brief.gather_context(conn, from_=body.from_, to=body.to)
    intro = await _build_intro(ctx, enrich=body.enrich)
    md = brief.render_markdown(ctx, intro=intro)
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
    intro = await _build_intro(ctx, enrich=enrich)
    md = brief.render_markdown(ctx, intro=intro)
    html = brief.render_html(md)
    return HTMLResponse(content=html)


@router.get("/api/insights/brief.pdf")
async def get_brief_pdf(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    enrich: bool = Query(False),
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> Response:
    """Stream the clinician brief as a real PDF when WeasyPrint is available.

    When WeasyPrint is missing (typical on Windows installs without GTK), we
    fall back to the same printable HTML used by /api/insights/brief.html, but
    with `Content-Disposition: attachment` so the browser saves it as a
    standalone file the clinician can open and print to PDF themselves. The
    response header `X-Diary-PDF-Engine` reports which path was taken so the
    UI can hint at the difference.
    """
    ctx = brief.gather_context(conn, from_=from_, to=to)
    intro = await _build_intro(ctx, enrich=enrich)
    md = brief.render_markdown(ctx, intro=intro)
    html = brief.render_html(md)

    if brief.pdf_engine_available():
        try:
            pdf_bytes = brief.render_pdf(html)
        except Exception:
            # Don't 500 if WeasyPrint blew up at runtime — degrade to HTML.
            return Response(
                content=html.encode("utf-8"),
                media_type="text/html; charset=utf-8",
                headers={
                    "Content-Disposition": 'attachment; filename="symptom-diary-brief.html"',
                    "X-Diary-PDF-Engine": "fallback-html-runtime-error",
                },
            )
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": 'attachment; filename="symptom-diary-brief.pdf"',
                "X-Diary-PDF-Engine": "weasyprint",
            },
        )

    return Response(
        content=html.encode("utf-8"),
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="symptom-diary-brief.html"',
            "X-Diary-PDF-Engine": "fallback-html",
            "X-Diary-PDF-Hint": (
                "Install backend with `pip install -e .[pdf]` for real PDF output. "
                "Otherwise open this HTML in a browser and use 'Print -> Save as PDF'."
            ),
        },
    )


@router.post("/api/insights/ask")
async def post_ask(
    body: AskRequest,
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> dict:
    result = await ask.answer_question(
        conn,
        question=body.question,
        language=body.language,
        llm=OllamaClient(),
    )
    return {
        "answer_md": result.answer_md,
        "citations": result.citations,
        "refusal": result.refusal,
        "used_fallback": result.used_fallback,
    }
