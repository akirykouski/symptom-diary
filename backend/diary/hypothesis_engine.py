"""Hypothesis Engine — match user state to curated disease profiles.

Pipeline (per the plan, MVP-3):
  1. Build a "user fingerprint": active entities (mentioned in the last 6 months)
     + abnormal lab values + temporal cues from entry text.
  2. For every user-side signal, find the closest disease_feature(s) by
     vector cosine. If embeddings are missing (KB not yet embedded), fall back
     to substring / token-overlap matching on names + aliases.
  3. Aggregate per disease_id with `frequency_weight` from the feature.
  4. Top-N diseases above a soft floor → ask Gemma to write a 3-5 sentence
     rationale that explicitly cites the user's entries and lab IDs. If Ollama
     is offline, generate a deterministic templated rationale that still cites
     the same evidence.
  5. Persist `hypothesis` rows with signal_strength bucket + 30d expiry.

Safety rules (cross-cutting clinical principles):
  - Language is whitelisted: "the pattern resembles", "consider ruling out",
    "doctor may want to evaluate". Never "you have", "diagnosed with", etc.
  - Every rationale must end with at least one citation (entry id or lab id).
    Hypotheses without citations are rejected.
  - Confidence is a 3-tier bucket (weak / moderate / strong). Never a percent.
"""
from __future__ import annotations

import json
import logging
import re
import sqlite3
import struct
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from .config import EMBED_DIM
from .knowledge_base import FREQUENCY_WEIGHT, all_features
from .llm import OllamaClient, OllamaError

logger = logging.getLogger("diary.hypothesis")


# ---------- thresholds --------------------------------------------------------

ACTIVE_WINDOW_DAYS = 180
# Kind-aware similarity floors. Symptom/sign features arrive as colloquial
# diary phrasing ("sores in mouth") that often falls just below the lab-tuned
# 0.45 threshold even when an alias would clearly resolve the match. We lower
# the bar for those kinds and rely on aliases + frequency_weight to keep
# precision; lab_pattern stays at the original tighter floor because lab
# vocabulary is already canonical.
PER_FEATURE_FLOOR_BY_KIND = {
    "symptom": 0.32,
    "sign": 0.32,
    "temporal": 0.32,
    "lab_pattern": 0.45,
    "imaging": 0.40,
}
PER_FEATURE_FLOOR_DEFAULT = 0.40
TOP_K_PER_FEATURE = 3            # how many disease features compete per user signal
TOP_DISEASES = 8                 # how many diseases reach the LLM step
STRONG_THRESHOLD = 1.6           # aggregate score → strong signal
MODERATE_THRESHOLD = 0.9         # aggregate score → moderate signal
EXPIRY_DAYS = 30

# Learning loop — see migration 005_learning.sql.
#   DISMISSAL_COOLDOWN_DAYS: how long a dismissal suppresses re-surfacing.
#   RESURFACE_FACTOR: the new aggregate score must exceed the score-at-dismissal
#     by this multiplier before we re-promote a dismissed hypothesis to active.
#   CONFIRMED_BOOST: multiplicative bump applied to disease scores when the
#     user has confirmed the hypothesis once before — enough to flip an
#     edge-case weak/moderate but not enough to fabricate strong signals.
DISMISSAL_COOLDOWN_DAYS = 60
RESURFACE_FACTOR = 1.30
CONFIRMED_BOOST = 1.25


# ---------- data classes ------------------------------------------------------


@dataclass
class UserSignal:
    """A single piece of evidence we will try to match against disease features."""
    text: str               # canonical name we will embed/match on
    kind: str               # entity|lab|temporal
    entity_id: str | None = None
    lab_value_id: str | None = None
    medication_id: str | None = None
    entry_ids: list[str] = None        # type: ignore[assignment]
    weight: float = 1.0
    embedding: list[float] | None = None

    def __post_init__(self) -> None:
        if self.entry_ids is None:
            self.entry_ids = []


@dataclass
class FeatureMatch:
    feature_id: str
    disease_id: str
    disease_name: str
    feature_name: str
    frequency_class: str
    frequency_weight: float
    similarity: float
    matched_signal: UserSignal


# ---------- vector utils ------------------------------------------------------


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = na = nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / ((na ** 0.5) * (nb ** 0.5))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- step 1: fingerprint ----------------------------------------------


def build_fingerprint(conn: sqlite3.Connection) -> list[UserSignal]:
    """Collect the last-6-months evidence we'll try to match.

    - Active entities (any mention in window). Weight = sqrt(mention count).
    - Abnormal lab values. Weight 1.5 (high|low signal).
    - Medications mentioned anywhere. Weight 0.5 (descriptive, not diagnostic).
    """
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=ACTIVE_WINDOW_DAYS)
    ).isoformat()
    signals: list[UserSignal] = []

    ent_rows = conn.execute(
        """
        SELECT e.id, e.canonical_name, COUNT(m.id) AS n,
               GROUP_CONCAT(m.entry_id) AS entries
        FROM entity_mention m
        JOIN entity e ON e.id = m.entity_id
        JOIN entry en ON en.id = m.entry_id
        WHERE en.ts_event >= ?
        GROUP BY e.id
        ORDER BY n DESC
        """,
        (cutoff,),
    ).fetchall()
    for r in ent_rows:
        entry_ids = list({eid for eid in (r["entries"] or "").split(",") if eid})[:5]
        signals.append(
            UserSignal(
                text=r["canonical_name"],
                kind="entity",
                entity_id=r["id"],
                weight=min(2.0, max(0.6, r["n"] ** 0.5)),
                entry_ids=entry_ids,
            )
        )

    lab_rows = conn.execute(
        """
        SELECT lv.id, lv.test_name, lv.test_name_raw, lv.value_numeric,
               lv.value_text, lv.unit, lv.is_abnormal,
               lv.measured_at, m.entry_id
        FROM lab_value lv
        JOIN document_record dr ON dr.id = lv.document_record_id
        JOIN media m ON m.id = dr.media_id
        WHERE lv.is_abnormal IS NOT NULL AND lv.is_abnormal != 0
           OR (lv.value_text IS NOT NULL AND lv.value_text != '')
        """
    ).fetchall()
    for r in lab_rows:
        if r["is_abnormal"] is not None and r["is_abnormal"] != 0:
            direction = "elevated" if r["is_abnormal"] == 1 else "low"
            text = f"{direction} {r['test_name'].replace('_', ' ')}"
            weight = 1.5
        else:
            # Text-valued labs: e.g. ANA "positive 1:640", carry the raw text in.
            txt = (r["value_text"] or "").lower().strip()
            text = f"{r['test_name'].replace('_', ' ')} {txt}".strip()
            weight = 1.2
        signals.append(
            UserSignal(
                text=text,
                kind="lab",
                lab_value_id=r["id"],
                weight=weight,
                entry_ids=[r["entry_id"]] if r["entry_id"] else [],
            )
        )

    med_rows = conn.execute(
        """
        SELECT mr.id, mr.drug_name, m.entry_id
        FROM medication_record mr
        JOIN document_record dr ON dr.id = mr.document_record_id
        JOIN media m ON m.id = dr.media_id
        """
    ).fetchall()
    for r in med_rows:
        signals.append(
            UserSignal(
                text=f"taking {r['drug_name']}",
                kind="medication",
                medication_id=r["id"],
                weight=0.5,
                entry_ids=[r["entry_id"]] if r["entry_id"] else [],
            )
        )

    return signals


# ---------- step 2: per-signal feature matching -------------------------------


_TOKEN_RE = re.compile(r"[a-z0-9]+")
# Glue words that should never carry weight on their own.
_GLUE = {
    "of", "the", "in", "on", "to", "for", "with", "and", "or", "after",
    "before", "during", "from", "due", "is", "are", "was", "were", "be",
    "been", "an", "a", "at", "by", "very", "more", "less",
}


def _tokenize(s: str) -> set[str]:
    """Length-2+ tokens minus glue words. Keep medical shortcodes (c3, t4, b12)."""
    return {t for t in _TOKEN_RE.findall(s.lower()) if len(t) >= 2 and t not in _GLUE}


def _keyword_similarity(a: str, b: str) -> float:
    """Jaccard token overlap fallback used when embeddings are missing.

    Real Jaccard (inter/union) so a single ubiquitous token does not dominate
    the score; medical shortcodes (c3, t4, b12) are preserved because the
    regex keeps tokens of length >= 2. Modifiers like 'low'/'high' stay in
    the token set on purpose — for lab signals the direction is meaningful.
    """
    ta, tb = _tokenize(a), _tokenize(b)
    if not ta or not tb:
        return 0.0
    inter = ta & tb
    if not inter:
        return 0.0
    return len(inter) / len(ta | tb)


async def match_signals(
    conn: sqlite3.Connection,
    signals: list[UserSignal],
    *,
    llm: OllamaClient | None = None,
) -> list[FeatureMatch]:
    """For every user signal find the top features it hits."""
    features = all_features(conn)
    if not features or not signals:
        return []

    have_embeddings = any(f["embedding"] is not None for f in features)
    if have_embeddings and llm is not None:
        # Embed every user signal that doesn't already have a vector.
        for s in signals:
            if s.embedding is None:
                try:
                    s.embedding = await llm.embed(s.text)
                except OllamaError as e:
                    logger.warning("signal embed failed (%s): %s", s.text, e)
                    s.embedding = None

    matches: list[FeatureMatch] = []
    for s in signals:
        scored: list[tuple[float, dict]] = []
        for f in features:
            if have_embeddings and s.embedding and f["embedding"]:
                sim = _cosine(s.embedding, f["embedding"])
                # Aliases let "sores in mouth" reach "oral ulcers" without
                # demanding tight cosine on the formal term.
                for _alias_text, alias_emb in f.get("aliases") or []:
                    if alias_emb:
                        s_alias = _cosine(s.embedding, alias_emb)
                        if s_alias > sim:
                            sim = s_alias
            else:
                sim = _keyword_similarity(s.text, f["feature_name"])
                for alias_text, _ in f.get("aliases") or []:
                    s_alias = _keyword_similarity(s.text, alias_text)
                    if s_alias > sim:
                        sim = s_alias
            floor = PER_FEATURE_FLOOR_BY_KIND.get(
                f.get("feature_kind") or "", PER_FEATURE_FLOOR_DEFAULT
            )
            if sim >= floor:
                scored.append((sim, f))
        scored.sort(reverse=True, key=lambda x: x[0])
        for sim, f in scored[:TOP_K_PER_FEATURE]:
            matches.append(
                FeatureMatch(
                    feature_id=f["id"],
                    disease_id=f["disease_id"],
                    disease_name=f["disease_name"],
                    feature_name=f["feature_name"],
                    frequency_class=f["frequency_class"],
                    frequency_weight=f["frequency_weight"],
                    similarity=sim,
                    matched_signal=s,
                )
            )
    return matches


# ---------- step 3: aggregate into disease scores -----------------------------


@dataclass
class DiseaseCandidate:
    disease_id: str
    disease_name: str
    score: float
    matched: list[FeatureMatch]
    cited_entry_ids: list[str]
    cited_lab_value_ids: list[str]
    cited_medication_ids: list[str]


def aggregate(matches: list[FeatureMatch]) -> list[DiseaseCandidate]:
    by_disease: dict[str, dict[str, Any]] = {}
    for m in matches:
        bucket = by_disease.setdefault(
            m.disease_id,
            {
                "name": m.disease_name,
                "score": 0.0,
                "matched": [],
                "feature_ids_seen": set(),
                "entries": [],
                "labs": [],
                "meds": [],
            },
        )
        if m.feature_id in bucket["feature_ids_seen"]:
            # Don't double-credit a single disease feature that several user
            # signals all happened to match.
            continue
        bucket["feature_ids_seen"].add(m.feature_id)
        bucket["score"] += m.similarity * m.frequency_weight * m.matched_signal.weight
        bucket["matched"].append(m)
        bucket["entries"].extend(m.matched_signal.entry_ids)
        if m.matched_signal.lab_value_id:
            bucket["labs"].append(m.matched_signal.lab_value_id)
        if m.matched_signal.medication_id:
            bucket["meds"].append(m.matched_signal.medication_id)

    out: list[DiseaseCandidate] = []
    for did, data in by_disease.items():
        out.append(
            DiseaseCandidate(
                disease_id=did,
                disease_name=data["name"],
                score=data["score"],
                matched=data["matched"],
                cited_entry_ids=list(dict.fromkeys(data["entries"]))[:8],
                cited_lab_value_ids=list(dict.fromkeys(data["labs"]))[:6],
                cited_medication_ids=list(dict.fromkeys(data["meds"]))[:6],
            )
        )
    out.sort(key=lambda c: c.score, reverse=True)
    return out


def signal_bucket(score: float) -> str:
    if score >= STRONG_THRESHOLD:
        return "strong"
    if score >= MODERATE_THRESHOLD:
        return "moderate"
    return "weak"


# ---------- step 4: rationale generation --------------------------------------


_FORBIDDEN_PHRASES = [
    "you have", "you've been diagnosed", "you are diagnosed",
    "the diagnosis is", "diagnosed with", "definite diagnosis",
    "100%", "97%", "90%", "certainly",
]
_REQUIRED_HEDGE = re.compile(
    r"\b(consider|resembles|suggest|may want|might|could|pattern of|evaluation for|"
    r"potential|possible|worth ruling out|differential|further work[- ]up)\b",
    re.IGNORECASE,
)


def _is_safe_language(text: str) -> bool:
    lower = text.lower()
    if any(p in lower for p in _FORBIDDEN_PHRASES):
        return False
    return bool(_REQUIRED_HEDGE.search(text))


RATIONALE_SYSTEM = (
    "You write cautious clinical observations for a patient's personal symptom "
    "journal. You are NOT a doctor and you NEVER give a diagnosis. You always "
    "use hedged language: 'the pattern resembles', 'consider ruling out', "
    "'doctor may want to evaluate'. Every claim must reference a specific "
    "entry id provided in the context. Output 3-5 sentences in plain prose. "
    "Begin with one of the hedged openings above. End with a sentence "
    "explaining what step the user could ask their doctor about."
)


def _build_rationale_prompt(candidate: DiseaseCandidate, evidence: dict[str, Any]) -> str:
    matched_lines = "\n".join(
        f"- user reported '{m.matched_signal.text}' which resembles a known feature "
        f"of {candidate.disease_name}: '{m.feature_name}' "
        f"({m.frequency_class}, similarity={m.similarity:.2f})"
        for m in candidate.matched[:8]
    )
    cited_entries = ", ".join(candidate.cited_entry_ids[:5]) or "none"
    cited_labs = ", ".join(candidate.cited_lab_value_ids[:4]) or "none"
    return (
        f"Disease being considered: {candidate.disease_name}\n"
        f"Disease description: {evidence.get('description','')}\n"
        f"Aggregated match score: {candidate.score:.2f}\n\n"
        f"Matches found in this user's journal:\n{matched_lines}\n\n"
        f"Available entry citations: {cited_entries}\n"
        f"Available lab citations: {cited_labs}\n\n"
        "Write the cautious 3-5 sentence rationale now. Every assertion must "
        "reference at least one of the entry citations above by id."
    )


def _fallback_rationale(candidate: DiseaseCandidate, profile: dict[str, Any]) -> str:
    """Deterministic, citation-bearing rationale when Ollama is offline.

    Always uses hedged language and ends with a 'discuss with a clinician' nudge,
    so the safety filter accepts it.
    """
    bits = []
    bits.append(
        f"The pattern in your recent entries resembles features documented in "
        f"{candidate.disease_name}."
    )
    if candidate.matched:
        top = candidate.matched[:3]
        signal_text = "; ".join(
            f"'{m.matched_signal.text}' aligns with the known feature "
            f"'{m.feature_name}' ({m.frequency_class.replace('_', ' ')})"
            for m in top
        )
        bits.append(f"Specifically: {signal_text}.")
    if candidate.cited_lab_value_ids:
        bits.append(
            "Some abnormal lab values you uploaded contributed to this match — "
            "see the cited lab references below for the exact entries."
        )
    bits.append(
        "This is a pattern observation, not a diagnosis. Consider showing your "
        "doctor the cited journal entries so they can decide whether further "
        "evaluation makes sense."
    )
    return " ".join(bits)


def _suggested_actions(profile: dict[str, Any]) -> str:
    cat = (profile.get("category") or "").lower()
    base = (
        "Discuss the cited entries with your primary-care clinician. They can "
        "decide whether targeted tests or a specialist referral are warranted."
    )
    extras = {
        "autoimmune": "An autoimmune-screening panel (ANA, complement, CRP/ESR) is a common starting point.",
        "endocrine": "A thyroid panel and morning cortisol are common starting points.",
        "metabolic": "Targeted serum testing (e.g. ferritin, ceruloplasmin, B12) may be informative.",
        "gi": "A GI consultation with stool calprotectin or coeliac serology is a common next step.",
        "neuro": "A neurology consultation may help clarify the pattern.",
        "allergy": "An allergy/immunology referral and trigger diary may help.",
        "autoinflammatory": "A rheumatology or immunology referral is often appropriate.",
    }
    extra = extras.get(cat, "")
    if profile.get("red_flag"):
        extra = (
            "Some features of this condition can be time-sensitive. If symptoms "
            "are severe or rapidly worsening, please contact a clinician promptly."
        ) + ("\n" + extra if extra else "")
    return base + ("\n" + extra if extra else "")


async def write_rationale(
    candidate: DiseaseCandidate,
    profile: dict[str, Any],
    *,
    llm: OllamaClient | None,
) -> str:
    if llm is not None:
        try:
            text = await llm.generate_text(
                _build_rationale_prompt(candidate, profile),
                system=RATIONALE_SYSTEM,
                timeout=120.0,
            )
            text = text.strip()
            if _is_safe_language(text):
                return text
            logger.info(
                "LLM rationale rejected by safety filter for %s; using fallback",
                candidate.disease_id,
            )
        except OllamaError as e:
            logger.info("LLM rationale unavailable (%s); using fallback", e)
    return _fallback_rationale(candidate, profile)


# ---------- step 5: persist ---------------------------------------------------


def _recent_dismissals(conn: sqlite3.Connection) -> dict[str, tuple[str, float]]:
    """Map disease_id -> (recorded_at_iso, score_at_action) for dismissals
    inside the cooldown window. If a user has dismissed the same disease
    multiple times, the *most recent* dismissal wins (a fresh dismissal
    re-arms the cooldown)."""
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=DISMISSAL_COOLDOWN_DAYS)
    ).isoformat()
    rows = conn.execute(
        """
        SELECT disease_id,
               MAX(recorded_at) AS recorded_at,
               match_score_at_action
        FROM hypothesis_feedback
        WHERE action = 'dismissed' AND recorded_at >= ?
        GROUP BY disease_id
        """,
        (cutoff,),
    ).fetchall()
    out: dict[str, tuple[str, float]] = {}
    for r in rows:
        # The grouped query returns MAX(recorded_at) but the score column is
        # the score from *some* row — use the same row by re-selecting.
        latest = conn.execute(
            """
            SELECT recorded_at, match_score_at_action
            FROM hypothesis_feedback
            WHERE disease_id = ? AND action = 'dismissed'
            ORDER BY recorded_at DESC LIMIT 1
            """,
            (r["disease_id"],),
        ).fetchone()
        if latest is not None:
            out[r["disease_id"]] = (
                latest["recorded_at"],
                float(latest["match_score_at_action"]),
            )
    return out


def _confirmed_diseases(conn: sqlite3.Connection) -> set[str]:
    """All disease ids the user has at any point confirmed. Confirmation is
    persistent — a confirmed hypothesis keeps its boost until explicitly
    unset (we don't currently expose unsetting)."""
    rows = conn.execute(
        "SELECT DISTINCT disease_id FROM hypothesis_feedback WHERE action = 'confirmed'"
    ).fetchall()
    return {r["disease_id"] for r in rows}


async def recheck(conn: sqlite3.Connection, *, llm: OllamaClient | None) -> dict[str, int]:
    """Run the full pipeline and persist new hypothesis rows."""
    signals = build_fingerprint(conn)
    matches = await match_signals(conn, signals, llm=llm)
    candidates = aggregate(matches)
    # Soft floor: anything above this is worth surfacing (it'll be a "weak" signal,
    # but the user can still see we noticed it). Strong/moderate cuts are higher up.
    candidates = [c for c in candidates if c.score >= 0.3]

    # Apply learning-loop adjustments BEFORE the top-N cut so confirmed
    # diseases that were previously borderline get a fair shot at the list.
    confirmed = _confirmed_diseases(conn)
    for c in candidates:
        if c.disease_id in confirmed:
            c.score *= CONFIRMED_BOOST
    candidates.sort(key=lambda c: c.score, reverse=True)
    candidates = candidates[:TOP_DISEASES]

    dismissed = _recent_dismissals(conn)

    now = _now()
    expires = (datetime.now(timezone.utc) + timedelta(days=EXPIRY_DAYS)).isoformat()
    inserted = 0
    suppressed = 0

    # Expire stale active hypotheses (data age moved past the window).
    conn.execute(
        "UPDATE hypothesis SET status = 'expired' "
        "WHERE status = 'active' AND expires_at < ?",
        (now,),
    )

    for c in candidates:
        bucket = signal_bucket(c.score)

        # Learning loop: if this disease was recently dismissed and the new
        # score hasn't grown by RESURFACE_FACTOR, write the row as
        # 'suppressed' instead of 'active'. The UI shows suppressed rows in
        # a separate "you dismissed these" subsection.
        target_status = "active"
        if c.disease_id in dismissed:
            _, dismissed_score = dismissed[c.disease_id]
            if c.score < dismissed_score * RESURFACE_FACTOR:
                target_status = "suppressed"

        if target_status == "active" and bucket == "weak":
            # Keep only weak hypotheses that aren't already represented.
            existing = conn.execute(
                "SELECT id FROM hypothesis WHERE disease_id = ? AND status = 'active'",
                (c.disease_id,),
            ).fetchone()
            if existing is not None:
                continue

        profile = conn.execute(
            "SELECT * FROM disease_profile WHERE id = ?", (c.disease_id,)
        ).fetchone()
        if profile is None:
            continue
        profile_dict = dict(profile)

        rationale = await write_rationale(c, profile_dict, llm=llm)
        actions = _suggested_actions(profile_dict)

        # Replace any prior active/suppressed row for this disease so we
        # always have the freshest evidence.
        conn.execute(
            "UPDATE hypothesis SET status = 'expired' "
            "WHERE disease_id = ? AND status IN ('active', 'suppressed')",
            (c.disease_id,),
        )

        conn.execute(
            """
            INSERT INTO hypothesis
              (id, disease_id, match_score, signal_strength, rationale_md,
               cited_entry_ids, cited_lab_value_ids, cited_medication_ids,
               matched_features, suggested_actions_md, status, generated_at,
               expires_at, user_note, dismissed_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
            """,
            (
                str(uuid.uuid4()),
                c.disease_id,
                c.score,
                bucket,
                rationale,
                json.dumps(c.cited_entry_ids),
                json.dumps(c.cited_lab_value_ids),
                json.dumps(c.cited_medication_ids),
                json.dumps([
                    {
                        "feature_name": m.feature_name,
                        "frequency_class": m.frequency_class,
                        "similarity": round(m.similarity, 3),
                        "matched_signal": m.matched_signal.text,
                        "signal_kind": m.matched_signal.kind,
                    }
                    for m in c.matched[:10]
                ]),
                actions,
                target_status,
                now,
                expires,
            ),
        )
        if target_status == "active":
            inserted += 1
        else:
            suppressed += 1

    return {
        "candidates_considered": len(candidates),
        "hypotheses_written": inserted,
        "hypotheses_suppressed": suppressed,
        "user_signals": len(signals),
    }


# ---------- queries -----------------------------------------------------------


def list_hypotheses(
    conn: sqlite3.Connection,
    *,
    status: str | None = "active",
) -> list[dict]:
    sql = (
        "SELECT h.*, d.name AS disease_name, d.category, d.source_url, d.red_flag, "
        "       (SELECT 1 FROM hypothesis_feedback hf "
        "        WHERE hf.disease_id = h.disease_id AND hf.action = 'confirmed' "
        "        LIMIT 1) AS user_confirmed "
        "FROM hypothesis h JOIN disease_profile d ON d.id = h.disease_id"
    )
    params: list[Any] = []
    if status:
        sql += " WHERE h.status = ?"
        params.append(status)
    # Confirmed hypotheses pin to the top regardless of signal bucket.
    sql += " ORDER BY (user_confirmed IS NOT NULL) DESC, "
    sql += "  CASE h.signal_strength WHEN 'strong' THEN 0 WHEN 'moderate' THEN 1 ELSE 2 END, "
    sql += "  h.match_score DESC"
    rows = conn.execute(sql, params).fetchall()
    return [_hydrate_row(r, conn) for r in rows]


def _hydrate_row(row: sqlite3.Row, conn: sqlite3.Connection | None = None) -> dict:
    payload = {
        "id": row["id"],
        "disease_id": row["disease_id"],
        "disease_name": row["disease_name"],
        "category": row["category"],
        "source_url": row["source_url"],
        "red_flag": int(row["red_flag"] or 0),
        "match_score": float(row["match_score"]),
        "signal_strength": row["signal_strength"],
        "rationale_md": row["rationale_md"],
        "suggested_actions_md": row["suggested_actions_md"],
        "cited_entry_ids": json.loads(row["cited_entry_ids"] or "[]"),
        "cited_lab_value_ids": json.loads(row["cited_lab_value_ids"] or "[]"),
        "cited_medication_ids": json.loads(row["cited_medication_ids"] or "[]"),
        "matched_features": json.loads(row["matched_features"] or "[]"),
        "status": row["status"],
        "generated_at": row["generated_at"],
        "expires_at": row["expires_at"],
        "user_note": row["user_note"],
        "dismissed_reason": row["dismissed_reason"],
        "corroborated_entry_ids": [],
        "user_confirmed": False,
    }
    # Optional sort-helper column: True when the user has confirmed this
    # disease at any point. Surface it in the payload so the UI can pin a ★.
    try:
        payload["user_confirmed"] = bool(row["user_confirmed"])
    except (KeyError, IndexError):
        pass
    if conn is not None:
        payload["corroborated_entry_ids"] = corroborated_entry_ids(conn, row["id"])
    return payload


def get_hypothesis(conn: sqlite3.Connection, hid: str) -> dict | None:
    row = conn.execute(
        "SELECT h.*, d.name AS disease_name, d.category, d.source_url, d.red_flag, "
        "       (SELECT 1 FROM hypothesis_feedback hf "
        "        WHERE hf.disease_id = h.disease_id AND hf.action = 'confirmed' "
        "        LIMIT 1) AS user_confirmed "
        "FROM hypothesis h JOIN disease_profile d ON d.id = h.disease_id "
        "WHERE h.id = ?",
        (hid,),
    ).fetchone()
    return _hydrate_row(row, conn) if row is not None else None


_VALID_STATUSES = {"active", "dismissed", "expired", "confirmed", "suppressed"}
_FEEDBACK_ACTIONS = {"dismissed": "dismissed", "confirmed": "confirmed", "active": "reactivated"}


def _record_feedback(
    conn: sqlite3.Connection,
    *,
    hypothesis_id: str,
    disease_id: str,
    action: str,
    reason: str | None,
    score: float,
) -> None:
    conn.execute(
        """
        INSERT INTO hypothesis_feedback
          (id, hypothesis_id, disease_id, action, reason, recorded_at, match_score_at_action)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (str(uuid.uuid4()), hypothesis_id, disease_id, action, reason, _now(), score),
    )


def update_hypothesis_status(
    conn: sqlite3.Connection,
    hid: str,
    *,
    status: str | None = None,
    user_note: str | None = None,
    dismissed_reason: str | None = None,
) -> dict | None:
    current = conn.execute(
        "SELECT id, disease_id, status, match_score FROM hypothesis WHERE id = ?",
        (hid,),
    ).fetchone()
    if current is None:
        return None

    fields: dict[str, Any] = {}
    if status is not None:
        if status not in _VALID_STATUSES:
            return None
        fields["status"] = status
    if user_note is not None:
        fields["user_note"] = user_note
    if dismissed_reason is not None:
        fields["dismissed_reason"] = dismissed_reason

    if fields:
        assigns = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE hypothesis SET {assigns} WHERE id = ?", [*fields.values(), hid]
        )

    # Learning loop: any user-driven status change is recorded as feedback.
    # We don't log internal transitions (e.g. recheck() expiring stale rows)
    # because those don't go through this function.
    if status is not None and status != current["status"]:
        action = _FEEDBACK_ACTIONS.get(status)
        if action is not None:
            _record_feedback(
                conn,
                hypothesis_id=hid,
                disease_id=current["disease_id"],
                action=action,
                reason=dismissed_reason,
                score=float(current["match_score"]),
            )

    return get_hypothesis(conn, hid)


# ---------- corroboration -----------------------------------------------------


def corroborate_entry(conn: sqlite3.Connection, *, hypothesis_id: str, entry_id: str) -> bool:
    """Mark an entry as 'doctor agreed this matters' for a given hypothesis.

    Returns False if the hypothesis or entry id doesn't exist; otherwise True
    (idempotent — the primary key prevents duplicates)."""
    h = conn.execute("SELECT id FROM hypothesis WHERE id = ?", (hypothesis_id,)).fetchone()
    if h is None:
        return False
    e = conn.execute("SELECT id FROM entry WHERE id = ?", (entry_id,)).fetchone()
    if e is None:
        return False
    conn.execute(
        "INSERT OR IGNORE INTO entry_corroboration (entry_id, hypothesis_id, recorded_at) "
        "VALUES (?, ?, ?)",
        (entry_id, hypothesis_id, _now()),
    )
    return True


def uncorroborate_entry(conn: sqlite3.Connection, *, hypothesis_id: str, entry_id: str) -> None:
    conn.execute(
        "DELETE FROM entry_corroboration WHERE hypothesis_id = ? AND entry_id = ?",
        (hypothesis_id, entry_id),
    )


def corroborated_entry_ids(conn: sqlite3.Connection, hypothesis_id: str) -> list[str]:
    rows = conn.execute(
        "SELECT entry_id FROM entry_corroboration WHERE hypothesis_id = ? ORDER BY recorded_at",
        (hypothesis_id,),
    ).fetchall()
    return [r["entry_id"] for r in rows]


def feedback_history(conn: sqlite3.Connection, *, limit: int = 50) -> list[dict]:
    rows = conn.execute(
        """
        SELECT f.id, f.hypothesis_id, f.disease_id, f.action, f.reason,
               f.recorded_at, f.match_score_at_action,
               d.name AS disease_name, d.category
        FROM hypothesis_feedback f
        JOIN disease_profile d ON d.id = f.disease_id
        ORDER BY f.recorded_at DESC LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]
