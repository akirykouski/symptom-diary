"""Extraction pipeline tests with a fake Ollama client."""
from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from diary import extraction
from diary.config import EMBED_DIM
from diary.session import store


class FakeLLM:
    """Deterministic stand-in for OllamaClient."""

    def __init__(self, mapping: dict[str, list[dict]] | None = None) -> None:
        self._mapping = mapping or {}

    def set_mapping(self, mapping: dict[str, list[dict]]) -> None:
        self._mapping = mapping

    async def generate_json(self, prompt: str, **_: Any) -> dict:
        for key, entities in self._mapping.items():
            if key in prompt.lower():
                return {"entities": entities}
        return {"entities": []}

    async def embed(self, text: str, **_: Any) -> list[float]:
        # Stable per-name pseudo-embedding so "headache" cosines high with itself
        # but separates from "coffee".
        seed = sum(ord(c) for c in text)
        vec = [0.0] * EMBED_DIM
        # Cluster bytes 0..63 active per character class.
        for i, ch in enumerate(text):
            vec[(seed + i) % EMBED_DIM] += 1.0 + (ord(ch) % 7) * 0.05
        # L2-normalize to keep cosine well-defined.
        norm = sum(v * v for v in vec) ** 0.5 or 1.0
        return [v / norm for v in vec]


def _setup_client(client: TestClient) -> None:
    r = client.post("/api/auth/setup", json={"passphrase": "correct horse battery staple"})
    assert r.status_code == 201


@pytest.mark.asyncio
async def test_extraction_pipeline_creates_entities_and_edges(client: TestClient) -> None:
    _setup_client(client)
    # Two entries that share "headache" + "coffee" → co_occurs edge.
    r1 = client.post(
        "/api/entries",
        json={"ts_event": "2026-05-03T08:00:00+00:00", "text_md": "Headache after coffee.", "tag_ids": []},
    )
    r2 = client.post(
        "/api/entries",
        json={"ts_event": "2026-05-03T20:00:00+00:00", "text_md": "Same headache, more coffee today.", "tag_ids": []},
    )
    assert r1.status_code == 201 and r2.status_code == 201
    eid1 = r1.json()["id"]

    fake = FakeLLM({
        "coffee": [
            {"type": "symptom", "name": "headache", "attrs": {"severity": 6}},
            {"type": "trigger", "name": "coffee", "attrs": {}},
        ],
    })
    conn = store.peek_conn()
    assert conn is not None

    # Run extraction directly so we don't need the worker loop.
    await extraction.process_one(conn, entry_id=eid1, llm=fake)  # type: ignore[arg-type]

    entities = client.get("/api/entities").json()
    names = {e["canonical_name"] for e in entities}
    assert {"headache", "coffee"} <= names

    # Co-occurrence edge between the two entities.
    g = client.get("/api/graph").json()
    assert len(g["nodes"]) >= 2
    kinds = {e["kind"] for e in g["edges"]}
    assert "co_occurs" in kinds


@pytest.mark.asyncio
async def test_lab_markers_retyped_even_when_llm_says_med(client: TestClient) -> None:
    """Issue 8: ANA / C3 / hemoglobin must land as `lab_marker`, not `med`."""
    _setup_client(client)
    r = client.post(
        "/api/entries",
        json={
            "ts_event": "2026-05-03T08:00:00+00:00",
            "text_md": "Doctor visit — ANA positive, C3 low, hemoglobin 11.",
            "tag_ids": [],
        },
    )
    assert r.status_code == 201
    eid = r.json()["id"]

    fake = FakeLLM({
        "doctor visit": [
            {"type": "med", "name": "ana", "attrs": {}},
            {"type": "med", "name": "c3", "attrs": {}},
            {"type": "symptom", "name": "hemoglobin", "attrs": {}},
            {"type": "med", "name": "hydroxychloroquine", "attrs": {}},
        ],
    })
    conn = store.peek_conn()
    assert conn is not None
    await extraction.process_one(conn, entry_id=eid, llm=fake)  # type: ignore[arg-type]

    entities = {e["canonical_name"]: e["type"] for e in client.get("/api/entities").json()}
    assert entities.get("ana") == "lab_marker"
    assert entities.get("c3") == "lab_marker"
    assert entities.get("hemoglobin") == "lab_marker"
    # A real medication stays a med — defense-in-depth must not over-trigger.
    assert entities.get("hydroxychloroquine") == "med"


@pytest.mark.asyncio
async def test_canonicalization_links_aliases(client: TestClient) -> None:
    _setup_client(client)
    r1 = client.post(
        "/api/entries",
        json={"ts_event": "2026-05-03T08:00:00+00:00", "text_md": "Headache today.", "tag_ids": []},
    )
    r2 = client.post(
        "/api/entries",
        json={"ts_event": "2026-05-03T09:00:00+00:00", "text_md": "Head pain again.", "tag_ids": []},
    )
    eid1, eid2 = r1.json()["id"], r2.json()["id"]
    conn = store.peek_conn()
    assert conn is not None

    fake = FakeLLM({
        "headache today": [{"type": "symptom", "name": "headache", "attrs": {}}],
        "head pain": [{"type": "symptom", "name": "headache", "attrs": {}}],  # same canonical → must link
    })
    await extraction.process_one(conn, entry_id=eid1, llm=fake)
    await extraction.process_one(conn, entry_id=eid2, llm=fake)

    entities = client.get("/api/entities").json()
    headache = [e for e in entities if e["canonical_name"] == "headache"]
    assert len(headache) == 1
    assert headache[0]["mention_count"] == 2


@pytest.mark.asyncio
async def test_reextract_replaces_mentions(client: TestClient) -> None:
    _setup_client(client)
    r = client.post(
        "/api/entries",
        json={"ts_event": "2026-05-03T08:00:00+00:00", "text_md": "Some symptom note.", "tag_ids": []},
    )
    eid = r.json()["id"]
    conn = store.peek_conn()
    assert conn is not None

    fake = FakeLLM({
        "some symptom": [
            {"type": "symptom", "name": "old_symptom", "attrs": {}},
        ],
    })
    await extraction.process_one(conn, entry_id=eid, llm=fake)

    after_first = client.get(f"/api/entries/{eid}/entities").json()
    assert any(e["canonical_name"] == "old_symptom" for e in after_first)

    # Re-extract with different mapping → mentions for this entry get replaced.
    fake.set_mapping({
        "some symptom": [
            {"type": "symptom", "name": "new_symptom", "attrs": {}},
        ],
    })
    await extraction.process_one(conn, entry_id=eid, llm=fake)
    after_second = client.get(f"/api/entries/{eid}/entities").json()
    canonicals = {e["canonical_name"] for e in after_second}
    assert "new_symptom" in canonicals
    assert "old_symptom" not in canonicals
