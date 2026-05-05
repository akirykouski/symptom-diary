"""Brief generation — markdown summary + printable HTML.

The plan's MVP-3 brief should help a new clinician get up to speed in 60s.
We assemble the context from the journal directly (no LLM required by
default), so the brief is reproducible across runs and never makes claims
without an entry/lab/document citation.

Optional `enrich=True` will additionally call Gemma to produce a 3-5 sentence
"narrative" paragraph at the top, but every sentence is checked against the
hedged-language regex used by the Hypothesis Engine; on rejection we drop
the LLM paragraph and keep only the deterministic content.
"""
from __future__ import annotations

import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from .hypothesis_engine import _is_safe_language
from .llm import OllamaClient, OllamaError

DISCLAIMER = (
    "**This brief is generated from a personal symptom diary. It is not a "
    "diagnosis. Treat every line as patient-reported context for clinical "
    "evaluation, not as authoritative findings.**"
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- context assembly -------------------------------------------------


def _date(s: str | None) -> str:
    return (s or "")[:10]


def _entry_episodes(entries: list[dict], window_h: int = 4) -> list[list[dict]]:
    """Group entries within `window_h` hours into episodes for the brief."""
    if not entries:
        return []
    sorted_e = sorted(entries, key=lambda e: e["ts_event"])
    episodes: list[list[dict]] = [[sorted_e[0]]]
    for e in sorted_e[1:]:
        prev = episodes[-1][-1]
        try:
            d_prev = datetime.fromisoformat(prev["ts_event"].replace("Z", "+00:00"))
            d_curr = datetime.fromisoformat(e["ts_event"].replace("Z", "+00:00"))
        except ValueError:
            episodes.append([e])
            continue
        if (d_curr - d_prev) <= timedelta(hours=window_h):
            episodes[-1].append(e)
        else:
            episodes.append([e])
    return episodes


def gather_context(
    conn: sqlite3.Connection,
    *,
    from_: str | None = None,
    to: str | None = None,
) -> dict[str, Any]:
    sql = "SELECT * FROM entry"
    where = []
    params: list[Any] = []
    if from_:
        where.append("ts_event >= ?")
        params.append(from_)
    if to:
        where.append("ts_event <= ?")
        params.append(to)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY ts_event ASC"
    entries = [dict(r) for r in conn.execute(sql, params).fetchall()]

    entity_rows = conn.execute(
        """
        SELECT e.id, e.canonical_name, e.type, COUNT(m.id) AS n
        FROM entity_mention m JOIN entity e ON e.id = m.entity_id
        GROUP BY e.id ORDER BY n DESC LIMIT 25
        """
    ).fetchall()
    top_entities = [dict(r) for r in entity_rows]

    edge_rows = conn.execute(
        """
        SELECT s.canonical_name AS src, d.canonical_name AS dst,
               e.kind, e.weight, e.evidence_count, e.last_observed_at
        FROM edge e
        JOIN entity s ON s.id = e.src_entity_id
        JOIN entity d ON d.id = e.dst_entity_id
        ORDER BY e.weight DESC LIMIT 30
        """
    ).fetchall()
    top_edges = [dict(r) for r in edge_rows]

    abnormal_labs = conn.execute(
        """
        SELECT lv.id, lv.test_name, lv.test_name_raw, lv.value_numeric, lv.unit,
               lv.reference_low, lv.reference_high, lv.is_abnormal, lv.measured_at,
               dr.id AS document_id, dr.clinician_name
        FROM lab_value lv
        JOIN document_record dr ON dr.id = lv.document_record_id
        WHERE lv.is_abnormal IS NOT NULL AND lv.is_abnormal != 0
        ORDER BY COALESCE(lv.measured_at, '') DESC
        LIMIT 50
        """
    ).fetchall()

    medications = conn.execute(
        """
        SELECT mr.id, mr.drug_name, mr.drug_name_raw, mr.dose, mr.frequency,
               mr.duration, mr.prescribed_at
        FROM medication_record mr
        ORDER BY COALESCE(mr.prescribed_at, '') DESC
        LIMIT 30
        """
    ).fetchall()

    documents = conn.execute(
        """
        SELECT id, doc_type, doc_date, clinician_name, clinician_specialty,
               facility, findings_md, recommendations_md
        FROM document_record
        ORDER BY COALESCE(doc_date, created_at) DESC LIMIT 20
        """
    ).fetchall()

    hypotheses = conn.execute(
        """
        SELECT h.id, h.signal_strength, h.match_score, h.rationale_md,
               h.suggested_actions_md, h.cited_entry_ids, h.cited_lab_value_ids,
               d.name AS disease_name, d.source_url, d.red_flag, d.category
        FROM hypothesis h JOIN disease_profile d ON d.id = h.disease_id
        WHERE h.status = 'active'
        ORDER BY CASE h.signal_strength
          WHEN 'strong' THEN 0 WHEN 'moderate' THEN 1 ELSE 2 END,
          h.match_score DESC
        """
    ).fetchall()

    return {
        "entries": entries,
        "episodes": _entry_episodes(entries),
        "top_entities": top_entities,
        "top_edges": top_edges,
        "abnormal_labs": [dict(r) for r in abnormal_labs],
        "medications": [dict(r) for r in medications],
        "documents": [dict(r) for r in documents],
        "hypotheses": [
            {**dict(r),
             "cited_entry_ids": json.loads(r["cited_entry_ids"] or "[]"),
             "cited_lab_value_ids": json.loads(r["cited_lab_value_ids"] or "[]")}
            for r in hypotheses
        ],
        "from": from_,
        "to": to,
    }


# ---------- markdown rendering -----------------------------------------------


def _entry_id_short(eid: str) -> str:
    return f"#{eid.split('-')[0]}"


def render_markdown(ctx: dict[str, Any]) -> str:
    out: list[str] = []
    out.append("# Symptom diary brief")
    span = []
    if ctx.get("from"): span.append(f"from {ctx['from'][:10]}")
    if ctx.get("to"): span.append(f"to {ctx['to'][:10]}")
    if ctx["entries"]:
        first = ctx["entries"][0]["ts_event"][:10]
        last = ctx["entries"][-1]["ts_event"][:10]
        span.append(f"covering {first} → {last}")
    out.append("_" + ", ".join(span) + "_" if span else "")
    out.append("")
    out.append(DISCLAIMER)
    out.append("")

    # Snapshot
    out.append("## At a glance")
    out.append(f"- Entries: **{len(ctx['entries'])}**")
    out.append(f"- Documents on file: **{len(ctx['documents'])}**")
    out.append(f"- Abnormal lab values: **{len(ctx['abnormal_labs'])}**")
    out.append(f"- Medications recorded: **{len(ctx['medications'])}**")
    out.append(f"- AI-noticed patterns: **{len(ctx['hypotheses'])}**")
    out.append("")

    # Top symptoms
    if ctx["top_entities"]:
        out.append("## Top reported entities")
        out.append("")
        out.append("| Entity | Type | Mentions |")
        out.append("|---|---|---:|")
        for e in ctx["top_entities"][:15]:
            out.append(f"| {e['canonical_name']} | {e['type']} | {e['n']} |")
        out.append("")

    # Strong relationships
    if ctx["top_edges"]:
        out.append("## Co-occurring patterns")
        for ed in ctx["top_edges"][:10]:
            arrow = "↔" if ed["kind"] == "co_occurs" else "→"
            out.append(
                f"- **{ed['src']}** {arrow} **{ed['dst']}** "
                f"({ed['kind']}, weight {ed['weight']:.0f}, "
                f"last observed {_date(ed.get('last_observed_at'))})"
            )
        out.append("")

    # Abnormal labs
    if ctx["abnormal_labs"]:
        out.append("## Abnormal lab values")
        out.append("")
        out.append("| Test | Value | Reference | Flag | Date | Source |")
        out.append("|---|---|---|---|---|---|")
        for lv in ctx["abnormal_labs"][:25]:
            flag = "↑ high" if lv["is_abnormal"] == 1 else "↓ low"
            ref = f"{lv.get('reference_low','—')}–{lv.get('reference_high','—')}"
            value = lv.get("value_numeric") if lv.get("value_numeric") is not None else "—"
            out.append(
                f"| {lv['test_name_raw']} | {value} {lv.get('unit') or ''} | "
                f"{ref} | {flag} | {_date(lv.get('measured_at'))} | "
                f"{lv.get('clinician_name') or '—'} |"
            )
        out.append("")

    # Medications
    if ctx["medications"]:
        out.append("## Medications recorded in journal")
        for m in ctx["medications"][:15]:
            line = f"- **{m['drug_name_raw']}**"
            extras = []
            if m.get("dose"): extras.append(m["dose"])
            if m.get("frequency"): extras.append(m["frequency"])
            if m.get("duration"): extras.append(m["duration"])
            if extras: line += " · " + " · ".join(extras)
            if m.get("prescribed_at"):
                line += f" _(prescribed {_date(m['prescribed_at'])})_"
            out.append(line)
        out.append("")

    # Documents
    if ctx["documents"]:
        out.append("## Documents on file")
        for d in ctx["documents"][:10]:
            out.append(
                f"- **{d['doc_type'].replace('_',' ')}** "
                f"by {d.get('clinician_name') or '—'} "
                f"({d.get('clinician_specialty') or '—'}) "
                f"on {_date(d.get('doc_date'))}"
            )
            if d.get("findings_md"):
                excerpt = d["findings_md"].strip().splitlines()[0][:200]
                out.append(f"  > {excerpt}")
        out.append("")

    # Hypotheses
    if ctx["hypotheses"]:
        out.append("## Patterns AI noticed for clinician's consideration")
        out.append("_Each pattern is hedged language only — never a diagnosis. Citations link back to journal entries._")
        out.append("")
        for h in ctx["hypotheses"]:
            badge = h["signal_strength"].upper()
            out.append(f"### [{badge}] {h['disease_name']}")
            out.append("")
            out.append(h["rationale_md"])
            out.append("")
            if h["cited_entry_ids"]:
                cites = ", ".join(_entry_id_short(eid) for eid in h["cited_entry_ids"])
                out.append(f"_Cited entries: {cites}_  ")
            if h.get("source_url"):
                out.append(f"_Reference: {h['source_url']}_")
            if h.get("suggested_actions_md"):
                out.append("")
                out.append("**Suggested next step:** " + h["suggested_actions_md"])
            out.append("")

    out.append("---")
    out.append(f"_Brief generated {_now()}._")
    return "\n".join(out)


# ---------- optional LLM intro ------------------------------------------------


_INTRO_SYSTEM = (
    "You are summarising a symptom-journal context for a clinician. "
    "Output 3-5 cautious sentences. Use ONLY hedged language: 'the patient "
    "reports', 'the journal documents', 'the pattern of complaints includes'. "
    "Never assert diagnoses. Refer to entry IDs as '[entry-id-prefix]' when "
    "you cite. Begin with 'Patient-reported context:'."
)


def _intro_prompt(ctx: dict[str, Any]) -> str:
    top = ", ".join(e["canonical_name"] for e in ctx["top_entities"][:8])
    n_abn = len(ctx["abnormal_labs"])
    n_meds = len(ctx["medications"])
    n_hyp = len(ctx["hypotheses"])
    return (
        f"Top reported entities: {top}\n"
        f"Number of abnormal labs: {n_abn}\n"
        f"Number of recorded medications: {n_meds}\n"
        f"Number of active AI-noticed patterns: {n_hyp}\n"
        "Write the cautious 3-5 sentence summary now."
    )


async def maybe_intro(ctx: dict[str, Any], *, llm: OllamaClient | None) -> str | None:
    if llm is None:
        return None
    try:
        text = await llm.generate_text(
            _intro_prompt(ctx),
            system=_INTRO_SYSTEM,
            timeout=60.0,
        )
        text = text.strip()
        if not _is_safe_language(text):
            return None
        if "diagnosed" in text.lower() or "diagnosis is" in text.lower():
            return None
        return text
    except OllamaError:
        return None


# ---------- printable HTML ---------------------------------------------------


_HTML_TEMPLATE = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Symptom diary brief</title>
<style>
  body {{ font: 14px/1.55 -apple-system, system-ui, sans-serif;
          color: #1a1a1a; background: #fff; max-width: 760px;
          margin: 32px auto; padding: 0 24px; }}
  h1 {{ margin: 0 0 4px 0; font-size: 28px; }}
  h2 {{ margin-top: 28px; padding-top: 8px; border-top: 1px solid #e5e5e5; font-size: 18px; }}
  h3 {{ margin-bottom: 4px; font-size: 16px; }}
  table {{ border-collapse: collapse; width: 100%; margin: 8px 0 16px; font-size: 13px; }}
  th, td {{ text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }}
  th {{ font-weight: 600; color: #444; }}
  blockquote {{ border-left: 3px solid #d0d0d0; padding-left: 10px;
                color: #555; margin: 6px 0; font-size: 13px; }}
  .disclaimer {{ background: #fff7d6; border: 1px solid #ecc94b;
                 padding: 10px 14px; border-radius: 8px;
                 font-size: 13px; color: #6b3a00; }}
  .badge-strong {{ background: #c0392b; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; }}
  .badge-moderate {{ background: #d97706; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; }}
  .badge-weak {{ background: #6b7280; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; }}
  @media print {{ body {{ margin: 0; }} h2 {{ page-break-after: avoid; }} }}
</style>
</head><body>
{body}
</body></html>"""


def pdf_engine_available() -> bool:
    """True when WeasyPrint can be imported. Cheap — only the import is tried.

    We prefer `importlib.util.find_spec` so the import isn't actually executed
    every time the route runs (WeasyPrint is slow to import).
    """
    import importlib.util

    return importlib.util.find_spec("weasyprint") is not None


def render_pdf(html_text: str) -> bytes:
    """Render the printable HTML to PDF bytes via WeasyPrint.

    Raises RuntimeError if WeasyPrint is not installed — call sites should
    check `pdf_engine_available()` first or handle the exception by falling
    back to the HTML download.
    """
    try:
        from weasyprint import HTML  # type: ignore[import-not-found]
    except ImportError as e:
        raise RuntimeError(
            "weasyprint is not installed; install with `pip install -e .[pdf]`"
        ) from e
    return HTML(string=html_text).write_pdf()


def render_html(markdown_text: str) -> str:
    """Tiny markdown-ish → HTML conversion that handles only what render_markdown emits."""
    body_lines: list[str] = []
    in_table = False
    in_list = False
    for line in markdown_text.split("\n"):
        stripped = line.rstrip()
        if stripped.startswith("# "):
            _close_open(body_lines, in_table, in_list); in_table = in_list = False
            body_lines.append(f"<h1>{_inline(stripped[2:])}</h1>")
        elif stripped.startswith("## "):
            _close_open(body_lines, in_table, in_list); in_table = in_list = False
            body_lines.append(f"<h2>{_inline(stripped[3:])}</h2>")
        elif stripped.startswith("### "):
            _close_open(body_lines, in_table, in_list); in_table = in_list = False
            heading = stripped[4:]
            for level in ("STRONG", "MODERATE", "WEAK"):
                if heading.startswith(f"[{level}] "):
                    klass = f"badge-{level.lower()}"
                    text = heading[len(level) + 3:]
                    heading = f"<span class='{klass}'>{level}</span> {_inline(text)}"
                    break
            else:
                heading = _inline(heading)
            body_lines.append(f"<h3>{heading}</h3>")
        elif stripped.startswith("|"):
            if not in_table:
                _close_open(body_lines, False, in_list); in_list = False
                body_lines.append("<table>")
                in_table = True
                body_lines.append(_table_row(stripped, header=True))
                continue
            if set(stripped.replace("|", "").replace("-", "").replace(":", "").strip()) == set():
                continue   # divider row
            body_lines.append(_table_row(stripped, header=False))
        elif stripped.startswith("- "):
            if not in_list:
                _close_open(body_lines, in_table, False); in_table = False
                body_lines.append("<ul>")
                in_list = True
            body_lines.append(f"<li>{_inline(stripped[2:])}</li>")
        elif stripped.startswith("> "):
            _close_open(body_lines, in_table, in_list); in_table = in_list = False
            body_lines.append(f"<blockquote>{_inline(stripped[2:])}</blockquote>")
        elif stripped.startswith("---"):
            _close_open(body_lines, in_table, in_list); in_table = in_list = False
            body_lines.append("<hr>")
        elif stripped.startswith("**This brief"):
            _close_open(body_lines, in_table, in_list); in_table = in_list = False
            body_lines.append(f"<div class='disclaimer'>{_inline(stripped[2:-2])}</div>")
        elif stripped.startswith("_") and stripped.endswith("_") and len(stripped) > 2:
            _close_open(body_lines, in_table, in_list); in_table = in_list = False
            body_lines.append(f"<p><em>{_inline(stripped[1:-1])}</em></p>")
        elif not stripped:
            _close_open(body_lines, in_table, in_list); in_table = in_list = False
        else:
            _close_open(body_lines, in_table, in_list); in_table = in_list = False
            body_lines.append(f"<p>{_inline(stripped)}</p>")
    _close_open(body_lines, in_table, in_list)
    return _HTML_TEMPLATE.format(body="\n".join(body_lines))


def _close_open(buf: list[str], in_table: bool, in_list: bool) -> None:
    if in_table: buf.append("</table>")
    if in_list: buf.append("</ul>")


def _inline(s: str) -> str:
    s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"_([^_]+)_", r"<em>\1</em>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    return s


def _table_row(line: str, *, header: bool) -> str:
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    tag = "th" if header else "td"
    return "<tr>" + "".join(f"<{tag}>{_inline(c)}</{tag}>" for c in cells) + "</tr>"
