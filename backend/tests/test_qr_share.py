"""QR-bridge for in-clinic handoff: token store + public share route."""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from diary import qr_share


_PASS = "correct horse battery staple"


def _setup_and_seed(client: TestClient) -> None:
    r = client.post("/api/auth/setup", json={"passphrase": _PASS})
    assert r.status_code == 201
    r = client.post("/api/demo/load", json={"persona_id": "anna"})
    assert r.status_code == 200


@pytest.fixture(autouse=True)
def _reset_share_store():
    qr_share.store.reset()
    yield
    qr_share.store.reset()


# ---------- store unit tests ------------------------------------------------


def test_store_create_and_consume() -> None:
    s = qr_share.ShareStore()
    tok = s.create(scope="brief", ttl_minutes=5)
    assert tok.scope == "brief"
    assert tok.expires_at > tok.created_at
    got = s.consume(tok.token)
    assert got is not None
    assert got.fetches == 1
    assert s.consume(tok.token).fetches == 2  # type: ignore[union-attr]


def test_store_unknown_scope_raises() -> None:
    s = qr_share.ShareStore()
    with pytest.raises(ValueError):
        s.create(scope="anything-else", ttl_minutes=5)


def test_store_expiry_drops_token() -> None:
    s = qr_share.ShareStore()
    tok = s.create(scope="brief", ttl_minutes=1)
    # Force expiry by rewinding the expiry timestamp.
    tok.expires_at = time.time() - 1.0
    assert s.get(tok.token) is None
    assert s.consume(tok.token) is None


def test_store_revoke() -> None:
    s = qr_share.ShareStore()
    tok = s.create(scope="brief", ttl_minutes=10)
    assert s.revoke(tok.token) is True
    assert s.consume(tok.token) is None
    assert s.revoke("nope") is False


def test_share_url_for_brief_scope() -> None:
    url = qr_share.share_url("abc", scope="brief", host="192.168.1.10", port=8765)
    assert url == "http://192.168.1.10:8765/share/abc/brief.html"


def test_render_qr_data_url_round_trip() -> None:
    data_url = qr_share.render_qr_data_url("http://example.local/foo")
    assert data_url.startswith("data:image/svg+xml;base64,")
    # Should decode to a valid SVG.
    import base64

    svg = base64.b64decode(data_url.split(",", 1)[1]).decode("utf-8")
    assert "<svg" in svg


def test_is_lan_ip() -> None:
    assert qr_share.is_lan_ip("192.168.1.10") is True
    assert qr_share.is_lan_ip("127.0.0.1") is False
    assert qr_share.is_lan_ip("169.254.1.2") is False


# ---------- HTTP route tests ------------------------------------------------


def test_create_qr_session_requires_unlock(client: TestClient) -> None:
    r = client.post("/api/export/qr-session", json={"scope": "brief"})
    assert r.status_code == 401


def test_create_qr_session_returns_url_and_qr(client: TestClient) -> None:
    _setup_and_seed(client)
    r = client.post("/api/export/qr-session", json={"scope": "brief", "ttl_minutes": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["scope"] == "brief"
    assert body["url"].endswith("/brief.html")
    assert body["qr_data_url"].startswith("data:image/svg+xml;base64,")
    assert body["fetches"] == 0
    assert "expires_at" in body
    assert "host" in body and "port" in body


def test_create_qr_session_rejects_unknown_scope(client: TestClient) -> None:
    _setup_and_seed(client)
    r = client.post("/api/export/qr-session", json={"scope": "weird"})
    # pydantic accepts any string but our route guards explicitly.
    assert r.status_code == 400


def test_create_qr_session_rejects_full_scope_for_now(client: TestClient) -> None:
    _setup_and_seed(client)
    r = client.post("/api/export/qr-session", json={"scope": "full"})
    assert r.status_code == 400


def test_create_qr_session_caps_ttl(client: TestClient) -> None:
    _setup_and_seed(client)
    r = client.post("/api/export/qr-session", json={"scope": "brief", "ttl_minutes": 9999})
    assert r.status_code == 422  # pydantic upper bound


def test_list_qr_sessions(client: TestClient) -> None:
    _setup_and_seed(client)
    client.post("/api/export/qr-session", json={"scope": "brief", "ttl_minutes": 3})
    client.post("/api/export/qr-session", json={"scope": "brief", "ttl_minutes": 3})
    r = client.get("/api/export/qr-sessions")
    assert r.status_code == 200
    body = r.json()
    assert len(body["sessions"]) == 2


def test_revoke_qr_session(client: TestClient) -> None:
    _setup_and_seed(client)
    r = client.post("/api/export/qr-session", json={"scope": "brief"})
    token = r.json()["token"]
    r2 = client.delete(f"/api/export/qr-session/{token}")
    assert r2.status_code == 204
    # subsequent share fetch must fail
    r3 = client.get(f"/share/{token}/brief.html")
    assert r3.status_code == 410


# ---------- public share endpoint -------------------------------------------


def test_share_brief_renders_for_valid_token(client: TestClient) -> None:
    _setup_and_seed(client)
    r = client.post("/api/export/qr-session", json={"scope": "brief", "ttl_minutes": 5})
    token = r.json()["token"]
    # Public fetch — TestClient does NOT carry the session cookie because
    # the route doesn't require it (it's keyed by token).
    r2 = client.get(f"/share/{token}/brief.html")
    assert r2.status_code == 200
    assert r2.headers["content-type"].startswith("text/html")
    body = r2.text
    assert "<h1>Symptom diary brief</h1>" in body
    # The share-mode banner must be present.
    assert "Read-only patient summary" in body


def test_share_brief_increments_fetch_counter(client: TestClient) -> None:
    _setup_and_seed(client)
    r = client.post("/api/export/qr-session", json={"scope": "brief", "ttl_minutes": 5})
    token = r.json()["token"]
    client.get(f"/share/{token}/brief.html")
    client.get(f"/share/{token}/brief.html")
    sessions = client.get("/api/export/qr-sessions").json()["sessions"]
    assert sessions[0]["fetches"] == 2


def test_share_brief_rejects_unknown_token(client: TestClient) -> None:
    _setup_and_seed(client)
    r = client.get("/share/no-such-token/brief.html")
    assert r.status_code == 410


def test_share_brief_rejects_when_journal_locked(client: TestClient) -> None:
    _setup_and_seed(client)
    r = client.post("/api/export/qr-session", json={"scope": "brief", "ttl_minutes": 5})
    token = r.json()["token"]
    # Lock the journal — clinician's URL should now degrade.
    client.post("/api/auth/lock")

    r2 = client.get(f"/share/{token}/brief.html")
    assert r2.status_code == 410
    assert "locked" in r2.text.lower() or "expired" in r2.text.lower()


def test_share_brief_rejects_after_expiry(client: TestClient) -> None:
    _setup_and_seed(client)
    r = client.post("/api/export/qr-session", json={"scope": "brief", "ttl_minutes": 1})
    token = r.json()["token"]
    # Force the in-memory token to look expired.
    qr_share.store._by_token[token].expires_at = time.time() - 1.0
    r2 = client.get(f"/share/{token}/brief.html")
    assert r2.status_code == 410
