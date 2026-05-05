"""Ask-anything pipeline.

Plan section MVP-3, /api/insights/ask:

  Body: { question: string, language: "en"|"ru"|"it" }
  Returns: {
    answer_md: string,
    citations: [{entry_id, ts_event, snippet}, ...],
    refusal: { category, message } | null
  }

The flow:
  1. Red-flag scan on the user's question. If it trips, we return a
     templated refusal IMMEDIATELY — no LLM call at all.
  2. Otherwise, build a compact context: 25 most recent entries +
     abnormal labs (last 50) + active hypotheses.
  3. Call Gemma with a system prompt that demands hedged language and
     inline `[entry-<prefix>]` citations.
  4. Validate the response: must be hedged and must cite at least one
     real entry from the context. If the response fails, fall back to
     a deterministic "here's what's in your data" summary that still
     cites real entries.
  5. Resolve cited prefixes → full entry rows for the structured
     citations array.

The endpoint is intentionally history-less: every call assembles fresh
context. That keeps the model's reasoning grounded in current journal
state rather than an accumulating chat that drifts.
"""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from typing import Any

from .llm import OllamaClient, OllamaError
from .safety import (
    RedFlag,
    extract_cited_prefixes,
    has_any_citation,
    is_hedged_language,
    red_flag,
)


# ---------- context assembly -------------------------------------------------


@dataclass
class AskContext:
    entries: list[dict]
    abnormal_labs: list[dict]
    hypotheses: list[dict]
    valid_prefixes: set[str]
    prefix_to_entry: dict[str, dict]


def gather_context(conn: sqlite3.Connection, *, limit: int = 25) -> AskContext:
    entry_rows = conn.execute(
        "SELECT id, ts_event, text_md, mood, severity FROM entry "
        "ORDER BY ts_event DESC LIMIT ?",
        (limit,),
    ).fetchall()
    entries = [dict(r) for r in entry_rows]

    lab_rows = conn.execute(
        """
        SELECT lv.id, lv.test_name, lv.test_name_raw, lv.value_numeric, lv.unit,
               lv.is_abnormal, lv.measured_at
        FROM lab_value lv
        WHERE lv.is_abnormal IS NOT NULL AND lv.is_abnormal != 0
        ORDER BY COALESCE(lv.measured_at, '') DESC
        LIMIT 30
        """
    ).fetchall()
    abnormal_labs = [dict(r) for r in lab_rows]

    hyp_rows = conn.execute(
        """
        SELECT h.id, h.signal_strength, h.match_score, d.name AS disease_name
        FROM hypothesis h JOIN disease_profile d ON d.id = h.disease_id
        WHERE h.status = 'active'
        ORDER BY h.match_score DESC LIMIT 5
        """
    ).fetchall()
    hypotheses = [dict(r) for r in hyp_rows]

    valid_prefixes = {e["id"].split("-")[0].lower() for e in entries}
    prefix_to_entry = {e["id"].split("-")[0].lower(): e for e in entries}
    return AskContext(
        entries=entries,
        abnormal_labs=abnormal_labs,
        hypotheses=hypotheses,
        valid_prefixes=valid_prefixes,
        prefix_to_entry=prefix_to_entry,
    )


# ---------- prompt building --------------------------------------------------


SYSTEM_PROMPT = (
    "You are a careful assistant answering questions about a single user's "
    "private symptom diary. RULES — every output must satisfy ALL of them:\n"
    "1. NEVER claim a diagnosis. Use only hedged language: 'the pattern "
    "resembles', 'consider', 'doctor may want to evaluate', 'might', 'could'.\n"
    "2. Refer ONLY to information in the provided context. If the answer is "
    "not in the context, say so plainly.\n"
    "3. Every assertion must cite at least one entry inline using the "
    "format [entry-<prefix>] where <prefix> is the short id given in the "
    "context (e.g. [entry-3f8a]). At least one cited prefix MUST appear in "
    "your final response.\n"
    "4. Never recommend medication doses, switches, or combinations.\n"
    "5. If the question is asking for an emergency triage decision, refuse "
    "and direct the user to call local emergency services.\n"
    "Output 2-5 sentences in plain prose. No markdown headings."
)


def _short_prefix(entry_id: str) -> str:
    return entry_id.split("-")[0].lower()


def build_user_prompt(question: str, ctx: AskContext, language: str) -> str:
    entry_lines: list[str] = []
    for e in ctx.entries:
        prefix = _short_prefix(e["id"])
        snippet = (e["text_md"] or "").strip().replace("\n", " ")[:240]
        sev = f", severity {e['severity']}" if e.get("severity") is not None else ""
        entry_lines.append(
            f"[entry-{prefix}] {e['ts_event'][:10]}{sev}: {snippet}"
        )
    lab_lines: list[str] = []
    for l in ctx.abnormal_labs[:15]:
        direction = "↑" if l["is_abnormal"] == 1 else "↓"
        lab_lines.append(
            f"- {direction} {l['test_name_raw']} = {l.get('value_numeric')} "
            f"{l.get('unit') or ''} on {l.get('measured_at','?')[:10]}"
        )
    hyp_lines = [
        f"- ({h['signal_strength']}) {h['disease_name']} (score {h['match_score']:.2f})"
        for h in ctx.hypotheses
    ]
    parts = [
        f"User language preference: {language}.",
        f"Question: {question.strip()}",
        "",
        "Recent journal entries (most recent first):",
        "\n".join(entry_lines) or "(no entries)",
    ]
    if lab_lines:
        parts += ["", "Abnormal lab values:", "\n".join(lab_lines)]
    if hyp_lines:
        parts += ["", "Active AI-noticed patterns (already shown to the user):", "\n".join(hyp_lines)]
    parts += [
        "",
        "Now answer the question following all five rules. Cite at least one "
        "[entry-<prefix>] from above.",
    ]
    return "\n".join(parts)


# ---------- response shaping -------------------------------------------------


def _resolve_citations(answer: str, ctx: AskContext) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for prefix in extract_cited_prefixes(answer):
        if prefix in seen:
            continue
        entry = ctx.prefix_to_entry.get(prefix)
        if entry is None:
            continue
        seen.add(prefix)
        snippet = (entry["text_md"] or "").strip().replace("\n", " ")
        if len(snippet) > 240:
            snippet = snippet[:237].rstrip() + "…"
        out.append({
            "entry_id": entry["id"],
            "ts_event": entry["ts_event"],
            "snippet": snippet,
            "prefix": prefix,
        })
    return out


def _deterministic_fallback(question: str, ctx: AskContext) -> str:
    """When the LLM fails the safety check or Ollama is unreachable, return a
    grounded summary that still satisfies the citation requirement."""
    if not ctx.entries:
        return (
            "I don't see any entries in your journal yet, so I can't answer "
            "questions about your data. Add a few entries first."
        )
    cited: list[str] = []
    bits: list[str] = []
    bits.append(
        "I can't reach the local AI model right now, so this is a "
        "deterministic summary of what's in your journal — not analysis."
    )
    # Use the 3 most recent entries as concrete citations.
    for e in ctx.entries[:3]:
        prefix = _short_prefix(e["id"])
        cited.append(prefix)
        date = e["ts_event"][:10]
        snippet = (e["text_md"] or "").strip().replace("\n", " ")[:140]
        bits.append(f"On {date} you wrote: \"{snippet}\" [entry-{prefix}].")
    if ctx.abnormal_labs:
        labs = ", ".join(
            f"{l['test_name_raw']} ({l['value_numeric']} {l.get('unit') or ''})"
            for l in ctx.abnormal_labs[:3]
        )
        bits.append(f"Recent abnormal labs include: {labs}.")
    bits.append(
        "If you want grounded reasoning over this, start Ollama from the AI "
        "page and ask again. This is not a diagnosis."
    )
    return " ".join(bits)


# ---------- main entry point -------------------------------------------------


@dataclass
class AskResult:
    answer_md: str
    citations: list[dict[str, Any]]
    refusal: dict[str, str] | None
    used_fallback: bool


async def answer_question(
    conn: sqlite3.Connection,
    *,
    question: str,
    language: str = "en",
    llm: OllamaClient | None = None,
) -> AskResult:
    flag = red_flag(question)
    if flag is not None:
        return AskResult(
            answer_md=flag.refusal_md,
            citations=[],
            refusal={"category": flag.category, "message": flag.refusal_md},
            used_fallback=False,
        )

    ctx = gather_context(conn)
    prompt = build_user_prompt(question, ctx, language)

    if llm is None:
        return AskResult(
            answer_md=_deterministic_fallback(question, ctx),
            citations=_resolve_citations(_deterministic_fallback(question, ctx), ctx),
            refusal=None,
            used_fallback=True,
        )

    try:
        text = await llm.generate_text(
            prompt,
            system=SYSTEM_PROMPT,
            timeout=180.0,
        )
    except OllamaError:
        fallback = _deterministic_fallback(question, ctx)
        return AskResult(
            answer_md=fallback,
            citations=_resolve_citations(fallback, ctx),
            refusal=None,
            used_fallback=True,
        )

    text = text.strip()
    safe = is_hedged_language(text) and has_any_citation(text, ctx.valid_prefixes)
    if not safe:
        fallback = _deterministic_fallback(question, ctx)
        return AskResult(
            answer_md=fallback,
            citations=_resolve_citations(fallback, ctx),
            refusal=None,
            used_fallback=True,
        )

    citations = _resolve_citations(text, ctx)
    return AskResult(
        answer_md=text,
        citations=citations,
        refusal=None,
        used_fallback=False,
    )
