"""Auth flow: status, setup, lock, unlock, wrong-passphrase."""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_status_when_fresh(client: TestClient) -> None:
    r = client.get("/api/auth/status")
    assert r.status_code == 200
    assert r.json() == {"setup": False, "unlocked": False}


def test_setup_creates_db_and_unlocks(client: TestClient) -> None:
    r = client.post("/api/auth/setup", json={"passphrase": "correct horse battery"})
    assert r.status_code == 201
    assert r.json() == {"setup": True, "unlocked": True}
    s = client.get("/api/auth/status").json()
    assert s == {"setup": True, "unlocked": True}


def test_setup_twice_is_409(client: TestClient) -> None:
    client.post("/api/auth/setup", json={"passphrase": "correct horse battery"})
    r = client.post("/api/auth/setup", json={"passphrase": "different"})
    assert r.status_code == 409


def test_lock_then_unlock(client: TestClient) -> None:
    pw = "correct horse battery staple"
    client.post("/api/auth/setup", json={"passphrase": pw})
    assert client.post("/api/auth/lock").status_code == 204
    assert client.get("/api/auth/status").json()["unlocked"] is False
    r = client.post("/api/auth/unlock", json={"passphrase": pw})
    assert r.status_code == 200
    assert client.get("/api/auth/status").json()["unlocked"] is True


def test_unlock_wrong_passphrase(client: TestClient) -> None:
    client.post("/api/auth/setup", json={"passphrase": "right one is right"})
    client.post("/api/auth/lock")
    r = client.post("/api/auth/unlock", json={"passphrase": "wrong one is wrong"})
    assert r.status_code == 401


def test_unlock_before_setup(client: TestClient) -> None:
    r = client.post("/api/auth/unlock", json={"passphrase": "any passphrase here"})
    assert r.status_code == 400
