"""End-to-end Hypothesis Engine tests."""
from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from diary import demo_data
from diary import extraction
from diary import hypothesis_engine as he
from diary import knowledge_base as kb
from diary.config import EMBED_DIM
from diary.session import store


class _FakeLLM:
    """Returns deterministic name embeddings so the engine never hits the network."""

    def __init__(self, mapping: dict[str, list[dict]] | None = None) -> None:
        self._mapping = mapping or {}

    async def generate_json(self, prompt: str, **_: Any) -> dict:
        for k, ents in self._mapping.items():
            if k in prompt.lower():
                return {"entities": ents}
        return {"entities": []}

    async def generate_text(self, prompt: str, **_: Any) -> str:
        # Keep this hedged so the safety filter accepts it.
        return (
            "The pattern resembles features documented in this disease. "
            "The cited entries above support this observation. "
            "Consider discussing these patterns with your clinician for further evaluation."
        )

    async def embed(self, text: str, **_: Any) -> list[float]:
        seed = sum(ord(c) for c in text)
        vec = [0.0] * EMBED_DIM
        for i, ch in enumerate(text):
            vec[(seed + i) % EMBED_DIM] += 1.0 + (ord(ch) % 7) * 0.05
        norm = sum(v * v for v in vec) ** 0.5 or 1.0
        return [v / norm for v in vec]


def _setup(client: TestClient) -> None:
    r = client.post("/api/auth/setup", json={"passphrase": "correct horse battery staple"})
    assert r.status_code == 201


# ---------- KB ingestion -----------------------------------------------------


@pytest.mark.asyncio
async def test_ingest_seed_without_embeddings(client: TestClient) -> None:
    _setup(client)
    conn = store.peek_conn()
    assert conn is not None
    summary = await kb.ingest_seed(conn, llm=None, embed=False)
    assert summary["inserted_diseases"] >= 30
    assert summary["inserted_features"] > 200
    assert summary["embedded_features"] == 0
    status = kb.kb_status(conn)
    assert status["disease_count"] == summary["inserted_diseases"]
    assert status["feature_count"] == summary["inserted_features"]
    assert status["embedded_feature_count"] == 0


# ---------- demo persona ----------------------------------------------------


def test_load_persona_blocks_when_db_not_empty(client: TestClient) -> None:
    _setup(client)
    r = client.post(
        "/api/entries",
        json={"ts_event": "2026-05-03T08:00:00+00:00", "text_md": "manual note", "tag_ids": []},
    )
    assert r.status_code == 201
    r = client.post("/api/demo/load", json={"persona_id": "maria"})
    assert r.status_code == 400


def test_load_persona_creates_entries_and_documents(client: TestClient) -> None:
    _setup(client)
    r = client.post("/api/demo/load", json={"persona_id": "maria"})
    assert r.status_code == 200
    body = r.json()
    assert body["entries"] >= 15
    assert body["documents"] >= 1
    assert body["lab_values"] >= 4

    docs = client.get("/api/documents").json()
    assert any(d["clinician_name"] == "Dr. Khan" for d in docs)
    assert any("ANA" in (d["findings_md"] or "") for d in docs)

    labs = client.get("/api/labs/timeline?test=ana").json()
    # ANA is text-valued so value_numeric is None — but the timeline endpoint
    # still returns the row.
    assert labs["test_name"] == "ana"

    r = client.get("/api/demo/active")
    assert r.json()["persona_id"] == "maria"


# ---------- end-to-end engine ------------------------------------------------


@pytest.mark.asyncio
async def test_engine_surfaces_lupus_for_maria(client: TestClient) -> None:
    _setup(client)
    r = client.post("/api/demo/load", json={"persona_id": "maria"})
    assert r.status_code == 200
    conn = store.peek_conn()
    assert conn is not None

    # Run extraction on every queued entry so entity_mention rows exist.
    fake = _FakeLLM(mapping={
        "butterfly": [
            {"type": "sign", "name": "butterfly rash on face", "attrs": {}},
            {"type": "symptom", "name": "fatigue", "attrs": {}},
        ],
        "rash": [
            {"type": "sign", "name": "malar rash", "attrs": {}},
            {"type": "symptom", "name": "photosensitive skin rash", "attrs": {}},
        ],
        "ulcer": [{"type": "symptom", "name": "oral ulcers", "attrs": {}}],
        "joint": [{"type": "symptom", "name": "joint pain", "attrs": {}}],
        "stiff": [{"type": "symptom", "name": "joint pain", "attrs": {}}],
        "hair": [{"type": "symptom", "name": "hair loss", "attrs": {}}],
        "fatigue": [{"type": "symptom", "name": "fatigue", "attrs": {}}],
        "cold-blue": [{"type": "symptom", "name": "raynaud phenomenon", "attrs": {}}],
        "dsdna": [
            {"type": "lab_pattern", "name": "positive ana antinuclear antibody", "attrs": {}},
        ],
    })

    entries = client.get("/api/entries").json()
    for e in entries:
        await extraction.process_one(conn, entry_id=e["id"], llm=fake)  # type: ignore[arg-type]

    # Ingest KB. We use the same fake embed to give all features vectors so the
    # cosine path runs (rather than the keyword fallback).
    await kb.ingest_seed(conn, llm=fake, embed=True)  # type: ignore[arg-type]

    summary = await he.recheck(conn, llm=fake)  # type: ignore[arg-type]
    assert summary["hypotheses_written"] >= 1

    hyps = client.get("/api/hypotheses").json()
    assert len(hyps) >= 1
    # Lupus must be in the top considered diseases because the fake mapping
    # produced multiple SLE-tagged features.
    diseases = {h["disease_name"] for h in hyps}
    assert any("lupus" in d.lower() for d in diseases), diseases

    top = next(h for h in hyps if "lupus" in h["disease_name"].lower())
    assert top["signal_strength"] in ("moderate", "strong")
    assert len(top["cited_entry_ids"]) >= 2
    assert len(top["matched_features"]) >= 2
    assert "consider" in top["rationale_md"].lower() or "resembles" in top["rationale_md"].lower()
    assert "diagnosed" not in top["rationale_md"].lower()


def test_dismiss_hypothesis(client: TestClient) -> None:
    _setup(client)
    client.post("/api/demo/load", json={"persona_id": "maria"})
    conn = store.peek_conn()
    assert conn is not None
    # Insert a fake active hypothesis directly to avoid needing the engine.
    import json as _json
    import uuid as _uuid
    from datetime import datetime, timezone

    # Make sure there is at least one disease row to FK against.
    conn.execute(
        "INSERT INTO disease_profile "
        "(id, source, name, synonyms, description_md, source_url, last_synced_at) "
        "VALUES ('test:foo', 'seed', 'Test condition', '[]', 'desc', 'http://example', ?)",
        (datetime.now(timezone.utc).isoformat(),),
    )
    hid = str(_uuid.uuid4())
    conn.execute(
        "INSERT INTO hypothesis "
        "(id, disease_id, match_score, signal_strength, rationale_md, "
        " cited_entry_ids, status, generated_at, expires_at) "
        "VALUES (?, 'test:foo', 1.0, 'moderate', 'rationale', '[]', 'active', ?, ?)",
        (hid, datetime.now(timezone.utc).isoformat(),
         datetime.now(timezone.utc).isoformat()),
    )

    r = client.patch(
        f"/api/hypotheses/{hid}",
        json={"status": "dismissed", "dismissed_reason": "Already worked up by my doctor."},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "dismissed"

    # Default list (active only) no longer contains it.
    assert all(h["id"] != hid for h in client.get("/api/hypotheses").json())
    # All-status listing does.
    assert any(h["id"] == hid for h in client.get("/api/hypotheses?status=all").json())
