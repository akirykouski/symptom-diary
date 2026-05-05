"""Cross-cutting clinical-safety helpers.

The plan's safety layer requires that for any user-facing AI output we:

1. Refuse to engage with prompts that ask for medication dosing,
   emergency triage, self-harm guidance, etc. These are the "red flag"
   triggers and they short-circuit before any LLM call happens — we
   return a templated refusal that points to qualified help instead.
2. Force hedged language on any LLM output and reject responses that
   contain unhedged diagnostic claims. (Already implemented in
   `hypothesis_engine._is_safe_language`; we re-export it here so the
   ask-anything endpoint can use it without crossing module layers.)
3. Require every assertion the model makes to cite at least one
   `entry_id` from the user's own journal — uncited claims get filtered
   in post-processing.

Keeping these checks in one place makes them auditable. Adding a new
trigger phrase is a single-file edit; that's deliberate.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .hypothesis_engine import _is_safe_language as is_hedged_language


# ---------- red-flag triggers -----------------------------------------------


# Each tuple is (regex, category, recommended action). Categories drive the
# refusal copy so we can be precise about WHY we declined to answer.
_RED_FLAGS: list[tuple[re.Pattern[str], str]] = [
    # Suicide / self-harm — top priority refusal, with hotline language.
    (re.compile(r"\b(kill myself|end my life|suicid|self[- ]?harm|hurt myself|"
                r"want to die|don'?t want to live)\b", re.IGNORECASE),
     "self_harm"),

    # Acute medical emergency — chest pain, stroke symptoms, etc.
    (re.compile(r"\b(chest pain|crushing chest|stroke|sudden weakness|sudden numbness|"
                r"can'?t breathe|severe shortness of breath|allergic reaction|"
                r"anaphylax|throat closing|seizure|loss of consciousness|"
                r"unconscious|blacked out)\b", re.IGNORECASE),
     "emergency"),

    # Medication dosing / drug interactions — outside our scope as a journal.
    (re.compile(r"\b(should i take|can i take|how many|how much|increase the dose|"
                r"double dose|skip a dose|stop taking|switch to|combine.*with|"
                r"mix .* with .* (alcohol|grapefruit|other med)|safe to take with|"
                r"interact with|overdose)\b", re.IGNORECASE),
     "dosing"),

    # Pregnancy + medication-specific (a known landmine class). Either order.
    (re.compile(
        r"\b(pregnant|pregnancy|breastfeed(?:ing)?|nursing).{0,60}"
        r"\b(safe|take|drug|medicine|med|dose)\b"
        r"|\b(safe|take|drug|medicine|med|dose).{0,60}"
        r"\b(pregnant|pregnancy|breastfeed(?:ing)?|nursing)\b",
        re.IGNORECASE),
     "pregnancy"),

    # Diagnostic certainty asks
    (re.compile(r"\b(do i have|am i (having|getting)|is this) (cancer|lupus|als|"
                r"ms|diabetes|stroke|heart attack)\b", re.IGNORECASE),
     "diagnostic_certainty"),
]


@dataclass
class RedFlag:
    category: str
    refusal_md: str


_REFUSAL_TEMPLATES: dict[str, str] = {
    "self_harm": (
        "**I can't help with this here.** What you describe deserves immediate, "
        "human support. If you are in the United States call or text **988**. "
        "Outside the US: <https://findahelpline.com>. If you are in immediate "
        "danger, please contact local emergency services (911 / 112)."
    ),
    "emergency": (
        "**This sounds like a medical emergency, not a journaling question.** "
        "Please call your local emergency number now (911 in the US, 112 in much "
        "of Europe) or go to the nearest emergency department. This app cannot "
        "triage acute symptoms safely."
    ),
    "dosing": (
        "**I won't suggest doses, drug switches, or combinations.** That kind of "
        "decision needs a clinician (your prescriber, a pharmacist, or your "
        "primary-care doctor) who knows your full history. I can help you "
        "*describe* what you've been taking and *gather* the questions you'd "
        "like to bring to them — try a different question along those lines."
    ),
    "pregnancy": (
        "**I won't speculate on medication safety in pregnancy.** Please ask "
        "your obstetric provider or pharmacist directly — they have access to "
        "the structured pregnancy-category data this app does not."
    ),
    "diagnostic_certainty": (
        "**I can't confirm or rule out a diagnosis.** I can only describe "
        "*patterns* in what you've written. Try asking 'what patterns do you "
        "notice in my entries?' instead — or visit the Patterns page for the "
        "engine's current observations, all of which are still "
        "patient-reported context, not diagnosis."
    ),
}


def red_flag(prompt: str) -> RedFlag | None:
    """Return a RedFlag if the prompt matches any trigger, else None."""
    if not prompt or len(prompt) > 4_000:
        return None
    for pattern, cat in _RED_FLAGS:
        if pattern.search(prompt):
            return RedFlag(category=cat, refusal_md=_REFUSAL_TEMPLATES[cat])
    return None


# ---------- citation enforcement --------------------------------------------


_ID_PREFIX_RE = re.compile(r"\[entry-([a-f0-9]{4,12})\]", re.IGNORECASE)


def extract_cited_prefixes(text: str) -> list[str]:
    """Return entry-id prefixes the model wrote inline like `[entry-1a2b3c]`."""
    return [m.group(1).lower() for m in _ID_PREFIX_RE.finditer(text)]


def has_any_citation(text: str, valid_prefixes: set[str]) -> bool:
    """True if at least one inline citation matches a real entry id prefix."""
    return any(p in valid_prefixes for p in extract_cited_prefixes(text))


# Re-exports so callers don't have to import from hypothesis_engine.
__all__ = [
    "RedFlag",
    "red_flag",
    "is_hedged_language",
    "extract_cited_prefixes",
    "has_any_citation",
]
