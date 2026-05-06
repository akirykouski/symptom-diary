"""Brief generation — markdown summary + printable HTML.

The plan's MVP-3 brief should help a new clinician get up to speed in 60s.
We assemble the context from the journal directly (no LLM required by
default), so the brief is reproducible across runs and never makes claims
without an entry/lab/document citation.

Optional `enrich=True` will additionally call Gemma to produce a 3-5 sentence
"Patient-reported context" paragraph at the top, but every sentence is checked
against the hedged-language regex used by the Hypothesis Engine; on rejection
we fall back to a deterministic summary so the section is always present.
"""
from __future__ import annotations

import json
import re
import sqlite3
from collections import defaultdict
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
               d.name AS disease_name, d.source_url, d.red_flag, d.category,
               (SELECT 1 FROM hypothesis_feedback hf
                WHERE hf.disease_id = h.disease_id AND hf.action = 'confirmed'
                LIMIT 1) AS user_confirmed
        FROM hypothesis h JOIN disease_profile d ON d.id = h.disease_id
        WHERE h.status = 'active'
        ORDER BY (user_confirmed IS NOT NULL) DESC,
          CASE h.signal_strength
          WHEN 'strong' THEN 0 WHEN 'moderate' THEN 1 ELSE 2 END,
          h.match_score DESC
        """
    ).fetchall()
    # Map hypothesis_id -> set of corroborated entry ids in one round trip.
    corroboration_rows = conn.execute(
        "SELECT hypothesis_id, entry_id FROM entry_corroboration"
    ).fetchall()
    corroborated_by_hyp: dict[str, set[str]] = {}
    for r in corroboration_rows:
        corroborated_by_hyp.setdefault(r["hypothesis_id"], set()).add(r["entry_id"])

    return {
        "entries": entries,
        "episodes": _entry_episodes(entries),
        "top_entities": top_entities,
        "abnormal_labs": [dict(r) for r in abnormal_labs],
        "medications": [dict(r) for r in medications],
        "documents": [dict(r) for r in documents],
        "hypotheses": [
            {**dict(r),
             "cited_entry_ids": json.loads(r["cited_entry_ids"] or "[]"),
             "cited_lab_value_ids": json.loads(r["cited_lab_value_ids"] or "[]"),
             "corroborated_entry_ids": sorted(corroborated_by_hyp.get(r["id"], set())),
             "user_confirmed": bool(r["user_confirmed"])}
            for r in hypotheses
        ],
        "from": from_,
        "to": to,
    }


# ---------- markdown rendering -----------------------------------------------


def _entry_id_short(eid: str) -> str:
    return f"#{eid.split('-')[0]}"


def _lab_severity(lv: dict[str, Any]) -> float:
    """Fractional deviation of a lab value from its reference range.

    0 means in-range or unmeasurable; larger means more abnormal. Used to
    sort within a date so the clinician's eye lands on the worst number.
    """
    v = lv.get("value_numeric")
    if v is None:
        # No numeric value — fall back to flag direction so abnormals still
        # rank above missing-value rows.
        return 0.001 if lv.get("is_abnormal") else 0.0
    lo = lv.get("reference_low")
    hi = lv.get("reference_high")
    try:
        v = float(v)
    except (TypeError, ValueError):
        return 0.0
    if lo is not None and v < float(lo):
        denom = max(abs(float(lo)), 1e-9)
        return (float(lo) - v) / denom
    if hi is not None and v > float(hi):
        denom = max(abs(float(hi)), 1e-9)
        return (v - float(hi)) / denom
    return 0.0


def _sort_labs_by_date_then_severity(labs: list[dict]) -> list[dict]:
    """Newest date first; within a date, most abnormal first."""
    by_date: dict[str, list[dict]] = defaultdict(list)
    undated: list[dict] = []
    for lv in labs:
        d = _date(lv.get("measured_at"))
        if d:
            by_date[d].append(lv)
        else:
            undated.append(lv)
    out: list[dict] = []
    for d in sorted(by_date.keys(), reverse=True):
        out.extend(sorted(by_date[d], key=_lab_severity, reverse=True))
    out.extend(undated)
    return out


def _deterministic_intro(ctx: dict[str, Any]) -> str:
    """Short clinician-style summary built without an LLM.

    Always available so the "Patient-reported context" section is present
    even when Ollama isn't configured or the LLM output is rejected by the
    hedged-language safety check.
    """
    syms = [e["canonical_name"] for e in ctx["top_entities"] if e.get("type") == "symptom"]
    abn = ctx["abnormal_labs"]
    parts: list[str] = ["Patient-reported context:"]
    if syms:
        head = ", ".join(syms[:3])
        parts.append(f" The journal documents recurring {head}.")
    if abn:
        dates = sorted(
            {_date(lv.get("measured_at")) for lv in abn if lv.get("measured_at")}
        )
        if len(dates) >= 2:
            parts.append(
                f" Multiple abnormal lab values are recorded across {dates[0]} → {dates[-1]} — see below."
            )
        elif dates:
            parts.append(f" Abnormal lab values are recorded on {dates[0]} — see below.")
    if ctx.get("medications"):
        parts.append(" The patient reports a current medication regimen, listed below.")
    if not syms and not abn:
        parts.append(" The journal does not yet document recurring symptoms or abnormal labs.")
    return "".join(parts)


def render_markdown(ctx: dict[str, Any], *, intro: str | None = None) -> str:
    """Render the full brief in markdown.

    Section order matches the clinician-feedback rewrite:
      1. Patient-reported context  (always present — `intro` or deterministic fallback)
      2. Abnormal lab values       (newest date first; severity-ranked within date)
      3. Patterns AI noticed       (promoted from the bottom)
      4. Active medications
      5. Top reported symptoms     (entity_type = symptom only)
      6. Documents on file
    """
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

    # 1) Patient-reported context — mandatory, first.
    out.append("## Patient-reported context")
    out.append("")
    out.append(intro or _deterministic_intro(ctx))
    out.append("")

    # 2) Abnormal lab values
    if ctx["abnormal_labs"]:
        out.append("## Abnormal lab values")
        out.append("")
        out.append("| Test | Value | Reference | Flag | Date | Source |")
        out.append("|---|---|---|---|---|---|")
        for lv in _sort_labs_by_date_then_severity(ctx["abnormal_labs"])[:25]:
            flag = "↑ high" if lv["is_abnormal"] == 1 else "↓ low"
            lo = lv.get("reference_low")
            hi = lv.get("reference_high")
            ref = f"{lo if lo is not None else '—'}–{hi if hi is not None else '—'}"
            value = lv.get("value_numeric") if lv.get("value_numeric") is not None else "—"
            out.append(
                f"| {lv['test_name_raw']} | {value} {lv.get('unit') or ''} | "
                f"{ref} | {flag} | {_date(lv.get('measured_at'))} | "
                f"{lv.get('clinician_name') or '—'} |"
            )
        out.append("")

    # 3) Patterns AI noticed — moved up from the bottom.
    if ctx["hypotheses"]:
        out.append("## Patterns AI noticed for clinician's consideration")
        out.append(
            "_Each pattern is hedged language only — never a diagnosis. "
            "Citations link back to journal entries._"
        )
        out.append("")
        # If every hypothesis carries the same suggested next step, lift it
        # to the section footer to stop the wall-of-repetition look.
        actions = [
            (h.get("suggested_actions_md") or "").strip()
            for h in ctx["hypotheses"]
        ]
        non_empty = [a for a in actions if a]
        common_action = (
            non_empty[0] if non_empty and all(a == non_empty[0] for a in non_empty) else None
        )

        for h in ctx["hypotheses"]:
            badge = h["signal_strength"].upper()
            star = " ★" if h.get("user_confirmed") else ""
            out.append(f"### [{badge}] {h['disease_name']}{star}")
            out.append("")
            out.append(h["rationale_md"])
            out.append("")
            if h["cited_entry_ids"]:
                corroborated = set(h.get("corroborated_entry_ids") or [])
                cites = ", ".join(
                    f"{_entry_id_short(eid)}{' ✓' if eid in corroborated else ''}"
                    for eid in h["cited_entry_ids"]
                )
                out.append(f"_Cited entries: {cites}_  ")
            if h.get("source_url"):
                out.append(f"_Reference: {h['source_url']}_")
            if not common_action and h.get("suggested_actions_md"):
                out.append("")
                out.append("**Suggested next step:** " + h["suggested_actions_md"])
            out.append("")

        if common_action:
            out.append("**Suggested next step:** " + common_action)
            out.append("")

    # 4) Active medications
    if ctx["medications"]:
        out.append("## Active medications")
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

    # 5) Top reported symptoms — symptom entities only, no Type column.
    sym_entities = [
        e for e in ctx["top_entities"] if (e.get("type") or "").lower() == "symptom"
    ][:8]
    if sym_entities:
        out.append("## Top reported symptoms")
        out.append("")
        out.append("| Symptom | Mentions |")
        out.append("|---|---:|")
        for e in sym_entities:
            out.append(f"| {e['canonical_name']} | {e['n']} |")
        out.append("")

    # 6) Documents on file
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
                # Note the lack of leading whitespace: the markdown→HTML pass
                # only matches `> ` at column 0, so indenting here used to
                # render the literal ">" instead of a blockquote.
                out.append(f"> {excerpt}")
        out.append("")

    out.append("---")
    out.append(f"_Brief generated {_now()}._")
    return "\n".join(out)


# ---------- optional LLM intro ------------------------------------------------


_INTRO_SYSTEM = (
    "You are summarising a symptom-journal context for a clinician in 3-5 "
    "cautious sentences. Use ONLY hedged language: 'the patient reports', "
    "'the journal documents', 'the pattern of complaints includes'. Never "
    "assert a diagnosis. When citing, use the EXACT [entry-XXXXXXXX] keys "
    "you were given verbatim — never write 'entry-id-prefix' or any other "
    "placeholder. Do NOT include meta-commentary about how many patterns "
    "or entries the brief contains. Do NOT restate the medication count. "
    "Begin with 'Patient-reported context:'."
)

_PLACEHOLDER_RE = re.compile(r"\[entry-id-prefix\]", re.IGNORECASE)
_CITATION_RE = re.compile(r"\[entry-([a-f0-9]{4,16})\]", re.IGNORECASE)


def _intro_prompt(ctx: dict[str, Any]) -> str:
    syms = [
        e["canonical_name"]
        for e in ctx["top_entities"]
        if (e.get("type") or "").lower() == "symptom"
    ][:8]
    # Hand the LLM real entry-id prefixes it can cite, with a short snippet
    # of each so the citation is grounded.
    bullet_entries = ctx["entries"][-12:] if ctx.get("entries") else []
    bullets: list[str] = []
    for e in bullet_entries:
        prefix = e["id"].split("-")[0]
        snippet = (e.get("text_md") or "").strip().splitlines()
        head = snippet[0][:120] if snippet else ""
        bullets.append(f"- [entry-{prefix}] {head}")
    return (
        f"Top reported symptoms: {', '.join(syms) or '—'}\n"
        f"Number of abnormal labs: {len(ctx['abnormal_labs'])}\n"
        f"Number of recorded medications: {len(ctx['medications'])}\n"
        f"Recent journal entries (cite using the [entry-…] keys exactly):\n"
        + "\n".join(bullets)
        + "\n\nWrite the cautious 3-5 sentence summary now. Cite at most 3 "
          "entries inline using their exact [entry-…] keys from the list "
          "above. Do NOT invent new entry IDs."
    )


async def maybe_intro(ctx: dict[str, Any], *, llm: OllamaClient | None) -> str | None:
    """Generate the "Patient-reported context" intro via the LLM.

    Returns None on any failure (Ollama unreachable, unsafe wording,
    placeholder leak, or hallucinated entry IDs). Callers should fall
    back to `_deterministic_intro` so the section is always present.
    """
    if llm is None:
        return None
    try:
        text = await llm.generate_text(
            _intro_prompt(ctx),
            system=_INTRO_SYSTEM,
            timeout=60.0,
        )
        text = text.strip()
        if not text:
            return None
        if _PLACEHOLDER_RE.search(text):
            return None
        if not _is_safe_language(text):
            return None
        if "diagnosed" in text.lower() or "diagnosis is" in text.lower():
            return None
        # Strip any [entry-XXX] citation that the model invented (not in
        # our context). Keeping known ones as plain text — render_html
        # will style them as small monospace pills.
        known_prefixes = {
            (e.get("id", "").split("-")[0] or "").lower()
            for e in (ctx.get("entries") or [])
        }

        def _scrub(match: re.Match[str]) -> str:
            prefix = match.group(1).lower()
            return match.group(0) if prefix in known_prefixes else ""

        text = _CITATION_RE.sub(_scrub, text)
        # Collapse the double-spaces left by stripped citations.
        text = re.sub(r"[ \t]{2,}", " ", text).strip()
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
  .cite {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
           font-size: 11px; padding: 1px 6px; border-radius: 4px;
           background: #eef2ff; color: #4338ca; }}
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
    s = re.sub(
        r"\[entry-([a-f0-9]{4,16})\]",
        r'<span class="cite">entry-\1</span>',
        s,
        flags=re.IGNORECASE,
    )
    return s


def _table_row(line: str, *, header: bool) -> str:
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    tag = "th" if header else "td"
    return "<tr>" + "".join(f"<{tag}>{_inline(c)}</{tag}>" for c in cells) + "</tr>"
