"""PDF brief endpoint — exercises both the WeasyPrint path and the
HTML-attachment fallback when the engine is unavailable."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from diary import brief


def _setup_and_seed(client: TestClient) -> None:
    r = client.post("/api/auth/setup", json={"passphrase": "correct horse battery staple"})
    assert r.status_code == 201
    r = client.post("/api/demo/load", json={"persona_id": "anna"})
    assert r.status_code == 200


def test_pdf_route_falls_back_to_html_when_engine_missing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _setup_and_seed(client)
    monkeypatch.setattr(brief, "pdf_engine_available", lambda: False)
    r = client.get("/api/insights/brief.pdf")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    assert r.headers["x-diary-pdf-engine"] == "fallback-html"
    assert "attachment" in r.headers["content-disposition"]
    assert "symptom-diary-brief.html" in r.headers["content-disposition"]
    # X-Diary-PDF-Hint helps the user understand what they got.
    assert "[pdf]" in r.headers.get("x-diary-pdf-hint", "")
    body = r.content.decode("utf-8")
    assert "<h1>" in body
    assert "Symptom diary brief" in body


def test_pdf_route_uses_engine_when_available(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _setup_and_seed(client)
    fake_pdf = b"%PDF-1.7\nfake bytes\n%%EOF"
    monkeypatch.setattr(brief, "pdf_engine_available", lambda: True)
    monkeypatch.setattr(brief, "render_pdf", lambda html: fake_pdf)

    r = client.get("/api/insights/brief.pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["x-diary-pdf-engine"] == "weasyprint"
    assert "symptom-diary-brief.pdf" in r.headers["content-disposition"]
    assert r.content == fake_pdf


def test_pdf_route_runtime_engine_failure_falls_back_to_html(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If WeasyPrint imports but blows up rendering, degrade gracefully."""
    _setup_and_seed(client)

    monkeypatch.setattr(brief, "pdf_engine_available", lambda: True)

    def _boom(_html: str) -> bytes:
        raise RuntimeError("freetype not found")

    monkeypatch.setattr(brief, "render_pdf", _boom)

    r = client.get("/api/insights/brief.pdf")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    assert r.headers["x-diary-pdf-engine"] == "fallback-html-runtime-error"


def test_pdf_route_requires_unlock(client: TestClient) -> None:
    r = client.get("/api/insights/brief.pdf")
    assert r.status_code == 401


def test_pdf_engine_available_is_safe_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Force the import lookup to return None and confirm we report False."""
    import importlib.util

    real_find = importlib.util.find_spec

    def fake_find(name: str, *a, **kw):
        if name == "weasyprint":
            return None
        return real_find(name, *a, **kw)

    monkeypatch.setattr(importlib.util, "find_spec", fake_find)
    assert brief.pdf_engine_available() is False


def test_render_pdf_raises_when_unavailable() -> None:
    """If weasyprint isn't installed in the test environment, render_pdf must
    raise a clear RuntimeError pointing at the [pdf] extra."""
    import importlib.util

    if importlib.util.find_spec("weasyprint") is not None:
        pytest.skip("weasyprint is installed; cannot test the missing-engine path")
    with pytest.raises(RuntimeError, match=r"\[pdf\]"):
        brief.render_pdf("<html><body>hi</body></html>")
