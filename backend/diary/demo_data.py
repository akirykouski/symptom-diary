"""Synthetic reference-patient seeder.

These personas exist for two reasons:
  1. Demoable journals so the hackathon video shows the engine doing useful work.
  2. The MVP-3 plan calls for validation against ~50 synthetic patients
     covering both signal-rich and healthy baselines. The first 3 below are
     the headline demo cases; healthy / noise patterns will be added later.
"""
from __future__ import annotations

import json
import random
import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from .extraction import enqueue_job


@dataclass
class _Doc:
    doc_type: str
    doc_date: str
    clinician_name: str
    clinician_specialty: str | None
    facility: str | None
    findings_md: str
    recommendations_md: str
    labs: list[dict] = field(default_factory=list)
    medications: list[dict] = field(default_factory=list)


@dataclass
class _Persona:
    id: str
    title: str
    summary: str
    weeks_back: int
    entries: list[tuple[int, int, str]]   # (days_ago, hour, text_md)
    documents: list[_Doc]


# ---------- Persona library --------------------------------------------------


def _maria_lupus() -> _Persona:
    """Young woman, 8 months of fatigue + butterfly rash + joint pain + ANA+."""
    return _Persona(
        id="maria",
        title="Maria · 26y · 8 months of fatigue + rash + joint pain",
        summary=(
            "Persistent fatigue, intermittent malar (butterfly) rash worsened by sun, "
            "morning joint stiffness in hands and wrists, mild hair loss, occasional "
            "mouth ulcers. ANA positive. Ideal for surfacing autoimmune patterns."
        ),
        weeks_back=34,
        entries=[
            (235, 9,  "Bone-deep fatigue again today. Slept 9 hours and still dragged through the morning."),
            (228, 14, "Spent 30 minutes in the garden — within an hour my cheeks lit up red across the bridge of my nose. Butterfly rash is back."),
            (220, 8,  "Hands are stiff and sore for the first hour after waking. Both hands, both wrists. Symmetric."),
            (212, 19, "Two painful mouth ulcers on the inside of my lower lip. They lasted four days last time."),
            (205, 10, "Hair coming out in handfuls in the shower. I've been losing hair for months now."),
            (198, 7,  "Knees and finger joints ache today. Worse on the right side. Took ibuprofen 400 mg."),
            (190, 13, "Photosensitivity again — beach trip, full sun for 2 hours, woke up with the rash worse than ever."),
            (182, 9,  "Tired tired tired. Cancelled dinner with friends, had to nap at 6pm."),
            (170, 16, "GP ordered an ANA test today after I described the rash, joint pain and fatigue together."),
            (155, 11, "Got results back. ANA positive 1:640 speckled. C3 and C4 low normal. WBC slightly low at 3.4."),
            (140, 8,  "Cold-blue fingers in the morning when I take out the trash. Painful, then they go red. Raynaud?"),
            (125, 19, "Joints flared again — both knees, both wrists. Severity 6/10."),
            (110, 10, "Rash on my chest and forearms after a sunny weekend. Itchy this time."),
            (95,  9,  "Saw rheumatology. They want to repeat ANA + dsDNA + complement next week."),
            (78,  18, "Mouth ulcers x3 today. Hard to eat anything acidic."),
            (60,  8,  "Joint stiffness lasting almost 2 hours this morning. Hands, wrists, knees."),
            (45,  20, "Migraine + mouth ulcers + tired. Whole week has been like this."),
            (30,  10, "Rheumatology wrote a referral letter, copy in my journal."),
            (14,  9,  "Repeat labs back. ANA still positive. Anti-dsDNA elevated. C3 frankly low."),
            (4,   8,  "Constant fatigue. Hand joints achy again. Need to follow up on the dsDNA result."),
        ],
        documents=[
            _Doc(
                doc_type="lab_result",
                doc_date=_iso_days_ago(155),
                clinician_name="Dr. Khan",
                clinician_specialty="Internal medicine",
                facility="City Lab",
                findings_md="ANA 1:640 speckled. Low-normal complement. Mildly low WBC.",
                recommendations_md="Repeat with anti-dsDNA, anti-Sm, complement, urinalysis. Consider rheumatology referral.",
                labs=[
                    {"test_name_raw": "ANA", "value_text": "positive 1:640 speckled",
                     "unit": "titer", "measured_at": _iso_days_ago(155)},
                    {"test_name_raw": "C3", "value_numeric": 88, "unit": "mg/dL",
                     "reference_low": 90, "reference_high": 180, "measured_at": _iso_days_ago(155)},
                    {"test_name_raw": "C4", "value_numeric": 14, "unit": "mg/dL",
                     "reference_low": 16, "reference_high": 47, "measured_at": _iso_days_ago(155)},
                    {"test_name_raw": "WBC", "value_numeric": 3.4, "unit": "K/uL",
                     "reference_low": 4.0, "reference_high": 11.0, "measured_at": _iso_days_ago(155)},
                ],
            ),
            _Doc(
                doc_type="lab_result",
                doc_date=_iso_days_ago(14),
                clinician_name="Dr. Khan",
                clinician_specialty="Rheumatology",
                facility="University Hospital",
                findings_md="ANA 1:640 persists. Anti-dsDNA elevated at 142 IU/mL (ref <30). C3 88, C4 11 — frankly low. Mild proteinuria on urine dipstick.",
                recommendations_md="Pattern is suspicious for SLE per ACR criteria. Recommend hydroxychloroquine, urine protein:creatinine ratio, dermatology consult for photosensitivity.",
                labs=[
                    {"test_name_raw": "Anti-dsDNA", "value_numeric": 142, "unit": "IU/mL",
                     "reference_low": 0, "reference_high": 30, "measured_at": _iso_days_ago(14)},
                    {"test_name_raw": "C3", "value_numeric": 70, "unit": "mg/dL",
                     "reference_low": 90, "reference_high": 180, "measured_at": _iso_days_ago(14)},
                    {"test_name_raw": "C4", "value_numeric": 11, "unit": "mg/dL",
                     "reference_low": 16, "reference_high": 47, "measured_at": _iso_days_ago(14)},
                    {"test_name_raw": "Hemoglobin", "value_numeric": 11.2, "unit": "g/dL",
                     "reference_low": 12.0, "reference_high": 16.0, "measured_at": _iso_days_ago(14)},
                ],
                medications=[
                    {"drug_name_raw": "hydroxychloroquine 200 mg", "dose": "200 mg",
                     "frequency": "twice daily", "duration": "ongoing"},
                ],
            ),
        ],
    )


def _tom_mcas() -> _Persona:
    """Episodic flushing, GI symptoms, hives — ideal for MCAS / hereditary angioedema."""
    return _Persona(
        id="tom",
        title="Tom · 34y · episodic flushing + GI + hives for 6 months",
        summary=(
            "Sudden episodes of flushing, racing heart, abdominal cramps after meals, "
            "hives after warm showers, lightheadedness on standing. Triggers seem to be "
            "alcohol, aged cheese, exercise, heat. Mast-cell pattern suspect."
        ),
        weeks_back=26,
        entries=[
            (180, 19, "After half a glass of red wine my whole face went hot and red. Heart racing 110. Felt scared."),
            (172, 22, "Hives on chest and inner arms after a long hot shower. Itchy. Gone in an hour."),
            (165, 13, "Stomach cramps + diarrhea after lunch (aged cheese, leftover pasta). Standard pattern now."),
            (155, 18, "Light-headed when I stood up at the gym. Heart racing on standing."),
            (148, 21, "Dinner out — 2 glasses of wine, cured meats. Within 30 minutes flushing, hives, throat tightness."),
            (135, 9,  "Headache after a warm yoga class. Feels like the same trigger as alcohol."),
            (120, 10, "Itching all over after exercise, no rash visible this time."),
            (110, 15, "Episode at work — sudden flushing, racing heart, cramps. Lasted ~45 minutes."),
            (95,  20, "Tried an antihistamine prophylactically. Helped some but didn't stop the flush."),
            (82,  17, "GI specialist ordered tryptase, calprotectin, celiac panel."),
            (70,  9,  "Tryptase 14.5 ng/mL during a flush. Calprotectin normal. tTG-IgA negative."),
            (58,  19, "Another full episode after pasta with aged parmesan + wine."),
            (40,  18, "Heart rate jumps 40+ bpm just from standing up. Feels lightheaded constantly."),
            (28,  22, "Allergist suggested low-histamine diet trial."),
            (14,  12, "Two weeks low-histamine — episodes much less frequent. Maybe one mild flush this week."),
            (6,   20, "One bite of leftover spinach risotto and the flush came back hard. Spinach is high histamine."),
        ],
        documents=[
            _Doc(
                doc_type="lab_result",
                doc_date=_iso_days_ago(70),
                clinician_name="Dr. Bianchi",
                clinician_specialty="Gastroenterology",
                facility="Outpatient Clinic",
                findings_md="Tryptase 14.5 ng/mL drawn ~30 min into a flushing episode (ref <11.4). Stool calprotectin normal. tTG-IgA negative.",
                recommendations_md="Pattern is suggestive of mast cell activation. Refer to allergy/immunology. Trial low-histamine diet + H1+H2 blocker.",
                labs=[
                    {"test_name_raw": "Tryptase", "value_numeric": 14.5, "unit": "ng/mL",
                     "reference_low": 0, "reference_high": 11.4, "measured_at": _iso_days_ago(70)},
                    {"test_name_raw": "Calprotectin (stool)", "value_numeric": 38, "unit": "ug/g",
                     "reference_low": 0, "reference_high": 50, "measured_at": _iso_days_ago(70)},
                    {"test_name_raw": "tTG-IgA", "value_numeric": 1.2, "unit": "U/mL",
                     "reference_low": 0, "reference_high": 4, "measured_at": _iso_days_ago(70)},
                ],
                medications=[
                    {"drug_name_raw": "cetirizine 10 mg", "dose": "10 mg",
                     "frequency": "once daily", "duration": "8 weeks"},
                    {"drug_name_raw": "famotidine 20 mg", "dose": "20 mg",
                     "frequency": "twice daily", "duration": "8 weeks"},
                ],
            ),
        ],
    )


def _anna_hashimoto() -> _Persona:
    """Common pattern: cold + tired + weight gain + low T4 + high TSH."""
    return _Persona(
        id="anna",
        title="Anna · 41y · 5 months of fatigue, weight gain, cold intolerance",
        summary=(
            "Slow-onset fatigue, weight gain despite no diet change, cold hands and feet, "
            "constipation, dry skin, mild depressed mood. TSH high, free T4 low. "
            "Classic hypothyroidism / Hashimoto presentation."
        ),
        weeks_back=22,
        entries=[
            (155, 8,  "Tired in a way coffee doesn't fix. Slept 8 hours, still groggy."),
            (150, 16, "Cold all the time. Wearing two pairs of socks at home in May."),
            (140, 9,  "Up 4 kg over the last 3 months. Eating the same as before."),
            (130, 18, "Constipated again. Magnesium helps a bit."),
            (120, 7,  "Skin is dry and flaky on shins and elbows. Lotion not enough."),
            (108, 21, "Mood low. Hard to start anything. Crying more."),
            (95,  10, "Hair coming out more in the shower."),
            (82,  16, "Family doctor ordered a thyroid panel."),
            (68,  9,  "Results: TSH 8.4 (high), free T4 0.7 (low), anti-TPO 312 (very high)."),
            (55,  14, "Started levothyroxine 50 mcg daily."),
            (35,  9,  "A bit warmer in the mornings. Less brain fog."),
            (14,  8,  "Repeat TSH 3.1 — much better. Still some hair shedding but energy improving."),
        ],
        documents=[
            _Doc(
                doc_type="lab_result",
                doc_date=_iso_days_ago(68),
                clinician_name="Dr. Romano",
                clinician_specialty="Family medicine",
                facility="Family Medicine Clinic",
                findings_md="TSH elevated, free T4 low, anti-TPO strongly positive — autoimmune hypothyroidism.",
                recommendations_md="Start levothyroxine 50 mcg daily. Recheck TSH in 6 weeks.",
                labs=[
                    {"test_name_raw": "TSH", "value_numeric": 8.4, "unit": "mIU/L",
                     "reference_low": 0.4, "reference_high": 4.0, "measured_at": _iso_days_ago(68)},
                    {"test_name_raw": "Free T4", "value_numeric": 0.7, "unit": "ng/dL",
                     "reference_low": 0.8, "reference_high": 1.8, "measured_at": _iso_days_ago(68)},
                    {"test_name_raw": "Anti-TPO", "value_numeric": 312, "unit": "IU/mL",
                     "reference_low": 0, "reference_high": 35, "measured_at": _iso_days_ago(68)},
                ],
                medications=[
                    {"drug_name_raw": "Levothyroxine 50 mcg", "dose": "50 mcg",
                     "frequency": "once daily", "duration": "ongoing"},
                ],
            ),
            _Doc(
                doc_type="lab_result",
                doc_date=_iso_days_ago(14),
                clinician_name="Dr. Romano",
                clinician_specialty="Family medicine",
                facility="Family Medicine Clinic",
                findings_md="Repeat TSH 3.1, free T4 1.1 — within range on current dose.",
                recommendations_md="Continue 50 mcg daily. Recheck in 6 months.",
                labs=[
                    {"test_name_raw": "TSH", "value_numeric": 3.1, "unit": "mIU/L",
                     "reference_low": 0.4, "reference_high": 4.0, "measured_at": _iso_days_ago(14)},
                    {"test_name_raw": "Free T4", "value_numeric": 1.1, "unit": "ng/dL",
                     "reference_low": 0.8, "reference_high": 1.8, "measured_at": _iso_days_ago(14)},
                ],
            ),
        ],
    )


PERSONAS = [_maria_lupus, _tom_mcas, _anna_hashimoto]


def list_personas() -> list[dict]:
    return [{"id": p().id, "title": p().title, "summary": p().summary} for p in PERSONAS]


# ---------- helpers ----------------------------------------------------------


def _iso_days_ago(days: int, hour: int = 9, minute: int = 0) -> str:
    base = datetime.now(timezone.utc).replace(microsecond=0)
    base = base.replace(hour=hour, minute=minute, second=0)
    return (base - timedelta(days=days)).isoformat()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_database_empty(conn: sqlite3.Connection) -> bool:
    n = conn.execute("SELECT COUNT(*) AS n FROM entry").fetchone()["n"]
    return n == 0


def _wipe_journal(conn: sqlite3.Connection) -> None:
    """Reset journal-side tables so a fresh persona can be seeded.

    Disease profiles + hypothesis rows are kept (they only reference each other),
    but active hypotheses are expired so the engine re-runs cleanly.
    """
    # Order matters because of FK ON DELETE CASCADE chains.
    conn.execute("DELETE FROM hypothesis")
    conn.execute("DELETE FROM medication_record")
    conn.execute("DELETE FROM lab_value")
    conn.execute("DELETE FROM document_record")
    conn.execute("DELETE FROM media")
    conn.execute("DELETE FROM extraction_job")
    conn.execute("DELETE FROM entity_mention")
    conn.execute("DELETE FROM edge")
    conn.execute("DELETE FROM entity_vec")
    conn.execute("DELETE FROM entity")
    conn.execute("DELETE FROM entry_tag")
    conn.execute("DELETE FROM entry")


# ---------- seeder ----------------------------------------------------------


def _classify_lab(value: float | None, lo: float | None, hi: float | None) -> int | None:
    if value is None:
        return None
    if lo is not None and value < lo:
        return -1
    if hi is not None and value > hi:
        return 1
    if lo is None and hi is None:
        return None
    return 0


def _canon_lab_name(raw: str) -> str:
    from .documents import canon_lab_name as canon
    return canon(raw)


def _canon_drug_name(raw: str) -> str:
    from .documents import canon_drug_name as canon
    return canon(raw)


def seed_persona(
    conn: sqlite3.Connection,
    persona_id: str,
    *,
    overwrite: bool = False,
) -> dict[str, int]:
    """Insert all journal entries + documents for the named persona."""
    fn = next((p for p in PERSONAS if p().id == persona_id), None)
    if fn is None:
        raise ValueError(f"unknown persona: {persona_id}")
    persona = fn()

    if not overwrite and not _is_database_empty(conn):
        raise ValueError("database is not empty; pass overwrite=True to seed anyway")
    if overwrite:
        _wipe_journal(conn)

    inserted_entries = 0
    inserted_docs = 0
    inserted_labs = 0
    inserted_meds = 0

    rng = random.Random(hash(persona.id) & 0xFFFFFFFF)
    now = _now()

    conn.execute("BEGIN")
    try:
        for days_ago, hour, text in persona.entries:
            entry_id = str(uuid.uuid4())
            ts_event = _iso_days_ago(days_ago, hour=hour, minute=rng.randint(0, 59))
            severity = rng.choice([None, None, 4, 5, 6, 7])
            mood = rng.choice([None, -1, 0, 0, -1, -2])
            conn.execute(
                """
                INSERT INTO entry
                  (id, ts_recorded, ts_event, text_md, mood, severity, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (entry_id, now, ts_event, text, mood, severity, now, now),
            )
            enqueue_job(conn, entry_id)
            inserted_entries += 1

        # Documents arrive attached to a synthetic media row each.
        for doc in persona.documents:
            # Pick the entry that's closest in time to the document so the
            # citation back into the journal makes sense.
            owner = conn.execute(
                "SELECT id FROM entry ORDER BY ABS(strftime('%s', ts_event) - strftime('%s', ?)) "
                "LIMIT 1",
                (doc.doc_date,),
            ).fetchone()
            if owner is None:
                continue
            entry_id = owner["id"]

            media_id = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO media
                  (id, entry_id, kind, storage_path, mime, bytes, status, created_at, processed_at, description)
                VALUES (?, ?, 'document', ?, 'image/jpeg', 0, 'done', ?, ?, ?)
                """,
                (
                    media_id,
                    entry_id,
                    f"{entry_id}/{media_id}.enc",
                    now, now,
                    f"{doc.doc_type.replace('_', ' ')} by {doc.clinician_name} ({doc.doc_date})",
                ),
            )
            doc_id = str(uuid.uuid4())
            payload = {
                "doc_type": doc.doc_type,
                "doc_date": doc.doc_date,
                "clinician_name": doc.clinician_name,
                "clinician_specialty": doc.clinician_specialty,
                "facility": doc.facility,
                "findings_md": doc.findings_md,
                "recommendations_md": doc.recommendations_md,
                "lab_values": doc.labs,
                "medications": doc.medications,
            }
            conn.execute(
                """
                INSERT INTO document_record
                  (id, media_id, doc_type, doc_date, clinician_name, clinician_specialty,
                   facility, language_detected, findings_md, recommendations_md,
                   raw_extracted_json, user_verified, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'en', ?, ?, ?, 1, ?, ?)
                """,
                (
                    doc_id, media_id, doc.doc_type, doc.doc_date, doc.clinician_name,
                    doc.clinician_specialty, doc.facility, doc.findings_md,
                    doc.recommendations_md, json.dumps(payload, ensure_ascii=False), now, now,
                ),
            )
            inserted_docs += 1

            for lab in doc.labs:
                conn.execute(
                    """
                    INSERT INTO lab_value
                      (id, document_record_id, test_name, test_name_raw, value_numeric,
                       value_text, unit, reference_low, reference_high, is_abnormal,
                       measured_at, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                    """,
                    (
                        str(uuid.uuid4()), doc_id,
                        _canon_lab_name(lab["test_name_raw"]),
                        lab["test_name_raw"],
                        lab.get("value_numeric"),
                        lab.get("value_text"),
                        lab.get("unit"),
                        lab.get("reference_low"),
                        lab.get("reference_high"),
                        _classify_lab(
                            lab.get("value_numeric"),
                            lab.get("reference_low"),
                            lab.get("reference_high"),
                        ),
                        lab.get("measured_at"),
                    ),
                )
                inserted_labs += 1
            for med in doc.medications:
                conn.execute(
                    """
                    INSERT INTO medication_record
                      (id, document_record_id, drug_name, drug_name_raw, dose,
                       frequency, duration, prescribed_at, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
                    """,
                    (
                        str(uuid.uuid4()), doc_id,
                        _canon_drug_name(med["drug_name_raw"]),
                        med["drug_name_raw"],
                        med.get("dose"), med.get("frequency"), med.get("duration"),
                        doc.doc_date,
                    ),
                )
                inserted_meds += 1

        # Tag the persona id in the meta table so the UI can show "demo persona Y loaded".
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('demo_persona', ?)",
            (persona.id,),
        )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise

    return {
        "persona_id": persona.id,
        "entries": inserted_entries,
        "documents": inserted_docs,
        "lab_values": inserted_labs,
        "medications": inserted_meds,
    }
