"""Ask-anything pipeline + red-flag refusal layer."""
from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from diary import ask, safety
from diary.session import store


# ---------- safety unit tests ------------------------------------------------


def test_red_flag_self_harm() -> None:
    flag = safety.red_flag("I want to kill myself")
    assert flag is not None
    assert flag.category == "self_harm"
    assert "988" in flag.refusal_md


def test_red_flag_emergency() -> None:
    flag = safety.red_flag("I have severe chest pain right now")
    assert flag is not None
    assert flag.category == "emergency"
    assert "emergency" in flag.refusal_md.lower()


def test_red_flag_dosing() -> None:
    flag = safety.red_flag("Should I take 400mg of ibuprofen?")
    assert flag is not None
    assert flag.category == "dosing"


def test_red_flag_diagnostic_certainty() -> None:
    flag = safety.red_flag("Do I have lupus?")
    assert flag is not None
    assert flag.category == "diagnostic_certainty"


def test_red_flag_pregnancy_med() -> None:
    flag = safety.red_flag("Is sertraline safe during pregnancy?")
    assert flag is not None
    assert flag.category == "pregnancy"


def test_no_flag_for_journal_questions() -> None:
    assert safety.red_flag("What patterns do you notice in my entries?") is None
    assert safety.red_flag("How often did I mention headaches last month?") is None
    assert safety.red_flag("What did I write about coffee triggers?") is None


def test_extract_cited_prefixes() -> None:
    text = "On the day [entry-1a2b3c] you mentioned X, then [entry-deadbe] said Y."
    assert safety.extract_cited_prefixes(text) == ["1a2b3c", "deadbe"]


def test_has_any_citation_filters_by_valid_prefixes() -> None:
    text = "[entry-aaa111] makes a claim, [entry-bbb222] another."
    assert safety.has_any_citation(text, {"aaa111"}) is True
    assert safety.has_any_citation(text, {"zzz999"}) is False
    assert safety.has_any_citation("no citations here", {"aaa111"}) is False


# ---------- end-to-end ask flow ---------------------------------------------


class _SafeFakeLLM:
    """Generates a hedged response that cites the first available entry."""

    def __init__(self, prefix_supplier: callable) -> None:
        self._prefix_supplier = prefix_supplier

    async def generate_text(self, prompt: str, **_: Any) -> str:
        prefix = self._prefix_supplier()
        return (
            f"The pattern in your recent entries [entry-{prefix}] could "
            "suggest a few things; consider discussing this with your clinician."
        )

    async def generate_json(self, *_a: Any, **_kw: Any) -> dict:
        return {}

    async def embed(self, *_a: Any, **_kw: Any) -> list[float]:
        return [0.0]


class _UnsafeFakeLLM:
    """Returns text that will fail the safety filter (no citation, unhedged)."""

    async def generate_text(self, prompt: str, **_: Any) -> str:
        return "You have lupus. The diagnosis is clear from your labs."


def _setup(client: TestClient) -> None:
    r = client.post("/api/auth/setup", json={"passphrase": "correct horse battery staple"})
    assert r.status_code == 201


def _seed_maria(client: TestClient) -> None:
    r = client.post("/api/demo/load", json={"persona_id": "maria"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_ask_with_safe_llm_returns_citations(client: TestClient) -> None:
    _setup(client)
    _seed_maria(client)
    conn = store.peek_conn()
    assert conn is not None

    # Use the most recent entry's id prefix so the citation is valid.
    entries = client.get("/api/entries").json()
    prefix = entries[0]["id"].split("-")[0].lower()
    fake = _SafeFakeLLM(lambda: prefix)

    result = await ask.answer_question(
        conn,
        question="What patterns do you see in my recent journal entries?",
        llm=fake,  # type: ignore[arg-type]
    )
    assert result.refusal is None
    assert result.used_fallback is False
    assert f"[entry-{prefix}]" in result.answer_md
    assert len(result.citations) >= 1
    assert result.citations[0]["entry_id"] == entries[0]["id"]


@pytest.mark.asyncio
async def test_ask_with_unsafe_output_falls_back(client: TestClient) -> None:
    _setup(client)
    _seed_maria(client)
    conn = store.peek_conn()
    assert conn is not None

    fake = _UnsafeFakeLLM()
    result = await ask.answer_question(
        conn,
        question="What patterns do you see?",
        llm=fake,  # type: ignore[arg-type]
    )
    # Unsafe output is rejected → deterministic fallback used. Fallback always
    # cites real entries from the user's data.
    assert result.used_fallback is True
    assert result.refusal is None
    assert "diagnosis" not in result.answer_md.lower() or "not a diagnosis" in result.answer_md.lower()
    assert len(result.citations) >= 1


@pytest.mark.asyncio
async def test_ask_red_flag_short_circuits_before_llm(client: TestClient) -> None:
    _setup(client)
    _seed_maria(client)
    conn = store.peek_conn()
    assert conn is not None

    class _Should_Not_Be_Called:
        async def generate_text(self, *_a: Any, **_kw: Any) -> str:
            raise AssertionError("LLM was called for a red-flag prompt")

    result = await ask.answer_question(
        conn,
        question="Should I take 400mg ibuprofen with my levothyroxine?",
        llm=_Should_Not_Be_Called(),  # type: ignore[arg-type]
    )
    assert result.refusal is not None
    assert result.refusal["category"] == "dosing"
    assert "won't suggest doses" in result.answer_md.lower()
    assert result.citations == []


@pytest.mark.asyncio
async def test_ask_without_llm_uses_fallback(client: TestClient) -> None:
    _setup(client)
    _seed_maria(client)
    conn = store.peek_conn()
    assert conn is not None

    result = await ask.answer_question(
        conn,
        question="What's been going on lately?",
        llm=None,
    )
    assert result.used_fallback is True
    assert "deterministic summary" in result.answer_md.lower() or "not reach" in result.answer_md.lower()
    assert len(result.citations) >= 1


# ---------- HTTP route -------------------------------------------------------


def test_ask_route_requires_unlock(client: TestClient) -> None:
    r = client.post("/api/insights/ask", json={"question": "anything"})
    assert r.status_code == 401


def test_ask_route_red_flag_returns_refusal(client: TestClient) -> None:
    _setup(client)
    _seed_maria(client)
    r = client.post(
        "/api/insights/ask",
        json={"question": "I want to kill myself"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["refusal"] is not None
    assert body["refusal"]["category"] == "self_harm"
    assert "988" in body["answer_md"]


def test_ask_route_question_too_long(client: TestClient) -> None:
    _setup(client)
    r = client.post("/api/insights/ask", json={"question": "x" * 5_000})
    assert r.status_code == 422  # pydantic max_length kicks in
