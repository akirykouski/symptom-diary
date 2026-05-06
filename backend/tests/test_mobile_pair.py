"""Mobile-companion pairing: token store + paired-phone session cookie."""
from __future__ import annotations

import io
import time

import pytest
from fastapi.testclient import TestClient

from diary import mobile_pair
from diary.mobile_pair import SESSION_COOKIE_NAME


_PASS = "correct horse battery staple"


def _setup(client: TestClient) -> None:
    r = client.post("/api/auth/setup", json={"passphrase": _PASS})
    assert r.status_code == 201


def _seed(client: TestClient) -> None:
    r = client.post("/api/demo/load", json={"persona_id": "anna"})
    assert r.status_code == 200


def _new_phone_client(client: TestClient) -> TestClient:
    """A second TestClient against the same FastAPI app, with NO cookies set —
    simulates a phone hitting the LAN URL fresh."""
    fresh = TestClient(client.app)
    fresh.cookies.clear()
    return fresh


@pytest.fixture(autouse=True)
def _reset_mobile_stores():
    mobile_pair.pairing_store.reset()
    mobile_pair.mobile_store.reset()
    yield
    mobile_pair.pairing_store.reset()
    mobile_pair.mobile_store.reset()


# ---------- store unit tests ------------------------------------------------


def test_pairing_store_one_shot() -> None:
    s = mobile_pair.PairingStore()
    tok = s.mint(ttl_minutes=5)
    assert s.consume(tok.token) is not None
    # Already consumed → second call returns None.
    assert s.consume(tok.token) is None


def test_pairing_store_expiry() -> None:
    s = mobile_pair.PairingStore()
    tok = s.mint(ttl_minutes=1)
    s._by_token[tok.token].expires_at = time.time() - 1.0
    assert s.consume(tok.token) is None


def test_pairing_store_caps_ttl() -> None:
    s = mobile_pair.PairingStore()
    tok = s.mint(ttl_minutes=999)
    assert tok.expires_at - tok.created_at <= mobile_pair.PAIR_MAX_TTL_MINUTES * 60 + 1


def test_mobile_store_create_touch_revoke() -> None:
    s = mobile_pair.MobileStore()
    sess = s.create(label="phone")
    assert s.touch(sess.cookie_token) is not None
    assert sess.fetches == 1
    assert s.revoke_by_id(sess.id) is True
    assert s.touch(sess.cookie_token) is None


def test_mobile_store_lists_only_active() -> None:
    s = mobile_pair.MobileStore()
    a = s.create()
    b = s.create()
    assert {x.id for x in s.list_active()} == {a.id, b.id}
    s._by_cookie[a.cookie_token].expires_at = time.time() - 1.0
    actives = {x.id for x in s.list_active()}
    assert actives == {b.id}


# ---------- HTTP route tests ------------------------------------------------


def test_pair_token_requires_unlock(client: TestClient) -> None:
    r = client.post("/api/mobile/pair-token", json={})
    assert r.status_code == 401


def test_pair_token_returns_qr_and_url(client: TestClient) -> None:
    _setup(client)
    r = client.post("/api/mobile/pair-token", json={"ttl_minutes": 5, "label": "alice phone"})
    assert r.status_code == 200
    body = r.json()
    assert body["url"].endswith(f"/m/pair?token={body['token']}")
    assert body["qr_data_url"].startswith("data:image/svg+xml;base64,")
    assert "expires_at" in body and "host" in body and "port" in body


def test_pair_token_caps_ttl(client: TestClient) -> None:
    _setup(client)
    r = client.post("/api/mobile/pair-token", json={"ttl_minutes": 9999})
    assert r.status_code == 422  # pydantic upper bound


def test_exchange_invalid_token(client: TestClient) -> None:
    _setup(client)
    phone = _new_phone_client(client)
    r = phone.post("/api/mobile/exchange", json={"token": "no-such-token"})
    assert r.status_code == 400


def test_full_pairing_flow_phone_can_post_entry(client: TestClient) -> None:
    """End-to-end: owner mints token → phone exchanges → phone posts entry."""
    _setup(client)
    _seed(client)

    r = client.post("/api/mobile/pair-token", json={"ttl_minutes": 5})
    token = r.json()["token"]

    phone = _new_phone_client(client)
    r = phone.post("/api/mobile/exchange", json={"token": token, "label": "test phone"})
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert SESSION_COOKIE_NAME in phone.cookies

    # Phone posts a new entry — uses ONLY the mobile cookie.
    r = phone.post(
        "/api/entries",
        json={"ts_event": "2026-05-05T10:00:00Z", "text_md": "from phone"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["text_md"] == "from phone"

    # Owner sees it from the desktop session.
    listed = client.get("/api/entries").json()
    assert any(e["id"] == body["id"] for e in listed)


def test_phone_token_is_one_shot(client: TestClient) -> None:
    _setup(client)
    r = client.post("/api/mobile/pair-token", json={})
    token = r.json()["token"]
    phone1 = _new_phone_client(client)
    assert phone1.post("/api/mobile/exchange", json={"token": token}).status_code == 200
    phone2 = _new_phone_client(client)
    r = phone2.post("/api/mobile/exchange", json={"token": token})
    assert r.status_code == 400


def test_mobile_cookie_cannot_lock_or_setup(client: TestClient) -> None:
    """The mobile session must NOT escalate to desktop-only auth surface."""
    _setup(client)
    r = client.post("/api/mobile/pair-token", json={})
    token = r.json()["token"]
    phone = _new_phone_client(client)
    phone.post("/api/mobile/exchange", json={"token": token})

    # /api/auth/setup short-circuits on existing setup before checking auth,
    # but lock requires no auth — exercise the surface that DOES require
    # owner-cookie auth: the brief endpoints, qr-share, mobile pair-token.
    assert phone.post("/api/insights/brief", json={}).status_code == 401
    assert phone.post("/api/mobile/pair-token", json={}).status_code == 401
    assert phone.post("/api/export/qr-session", json={"scope": "brief"}).status_code == 401


def test_locking_journal_invalidates_mobile_cookie(client: TestClient) -> None:
    _setup(client)
    r = client.post("/api/mobile/pair-token", json={})
    token = r.json()["token"]
    phone = _new_phone_client(client)
    phone.post("/api/mobile/exchange", json={"token": token})

    # Owner locks the journal.
    assert client.post("/api/auth/lock").status_code == 204

    # Phone's whoami still says paired — but owner_unlocked is False.
    who = phone.get("/api/mobile/whoami").json()
    assert who["paired"] is True
    assert who["owner_unlocked"] is False

    # Phone's writes are now blocked.
    r = phone.post("/api/entries", json={"ts_event": "2026-05-05T10:00:00Z", "text_md": "x"})
    assert r.status_code == 401


def test_exchange_blocked_when_owner_locked(client: TestClient) -> None:
    _setup(client)
    r = client.post("/api/mobile/pair-token", json={})
    token = r.json()["token"]
    client.post("/api/auth/lock")
    phone = _new_phone_client(client)
    r = phone.post("/api/mobile/exchange", json={"token": token})
    assert r.status_code == 401


def test_owner_can_list_and_revoke_mobile_sessions(client: TestClient) -> None:
    _setup(client)
    # Pair two phones.
    for _ in range(2):
        token = client.post("/api/mobile/pair-token", json={}).json()["token"]
        phone = _new_phone_client(client)
        phone.post("/api/mobile/exchange", json={"token": token})

    sessions = client.get("/api/mobile/sessions").json()["sessions"]
    assert len(sessions) == 2

    target = sessions[0]["id"]
    assert client.delete(f"/api/mobile/sessions/{target}").status_code == 204
    remaining = client.get("/api/mobile/sessions").json()["sessions"]
    assert len(remaining) == 1
    assert remaining[0]["id"] != target


def test_mobile_logout_clears_cookie(client: TestClient) -> None:
    _setup(client)
    token = client.post("/api/mobile/pair-token", json={}).json()["token"]
    phone = _new_phone_client(client)
    phone.post("/api/mobile/exchange", json={"token": token})
    assert phone.post("/api/mobile/logout").status_code == 204
    # Subsequent writes are unauthorized.
    r = phone.post("/api/entries", json={"ts_event": "2026-05-05T10:00:00Z", "text_md": "x"})
    assert r.status_code == 401


def test_mobile_can_upload_media(client: TestClient) -> None:
    """The phone uploads a photo — the backend pulls the master key from the
    desktop session, encrypts, and stores it under the new entry."""
    _setup(client)

    token = client.post("/api/mobile/pair-token", json={}).json()["token"]
    phone = _new_phone_client(client)
    phone.post("/api/mobile/exchange", json={"token": token})

    # Phone creates an entry first.
    r = phone.post(
        "/api/entries",
        json={"ts_event": "2026-05-05T10:00:00Z", "text_md": "rash photo"},
    )
    assert r.status_code == 201
    entry_id = r.json()["id"]

    # Tiny valid JPEG header + body — Pillow can open this.
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color=(200, 30, 30)).save(buf, format="JPEG")
    jpeg_bytes = buf.getvalue()

    files = {"file": ("rash.jpg", jpeg_bytes, "image/jpeg")}
    data = {"kind": "image"}
    r = phone.post(f"/api/entries/{entry_id}/media", files=files, data=data)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "image"
    assert body["bytes"] > 0
