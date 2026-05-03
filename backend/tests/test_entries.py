"""Entry & tag CRUD with auth."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi.testclient import TestClient


def _setup(client: TestClient) -> None:
    r = client.post("/api/auth/setup", json={"passphrase": "correct horse battery staple"})
    assert r.status_code == 201


def _ts(year: int = 2026, month: int = 5, day: int = 3) -> str:
    return datetime(year, month, day, tzinfo=timezone.utc).isoformat()


def test_entries_require_unlock(client: TestClient) -> None:
    r = client.get("/api/entries")
    assert r.status_code == 401


def test_create_list_get_delete_entry(client: TestClient) -> None:
    _setup(client)
    payload = {
        "ts_event": _ts(),
        "text_md": "headache after coffee",
        "mood": -1,
        "severity": 6,
        "tag_ids": [],
    }
    r = client.post("/api/entries", json=payload)
    assert r.status_code == 201, r.text
    entry = r.json()
    assert entry["text_md"] == "headache after coffee"
    assert entry["severity"] == 6
    assert entry["tags"] == []
    eid = entry["id"]

    listing = client.get("/api/entries").json()
    assert len(listing) == 1 and listing[0]["id"] == eid

    r = client.get(f"/api/entries/{eid}")
    assert r.status_code == 200 and r.json()["id"] == eid

    r = client.delete(f"/api/entries/{eid}")
    assert r.status_code == 204
    assert client.get("/api/entries").json() == []


def test_update_entry(client: TestClient) -> None:
    _setup(client)
    r = client.post(
        "/api/entries",
        json={"ts_event": _ts(), "text_md": "first version", "tag_ids": []},
    )
    eid = r.json()["id"]
    r = client.patch(f"/api/entries/{eid}", json={"text_md": "second version", "severity": 3})
    assert r.status_code == 200
    body = r.json()
    assert body["text_md"] == "second version"
    assert body["severity"] == 3


def test_tags_lifecycle(client: TestClient) -> None:
    _setup(client)
    r = client.post("/api/tags", json={"name": "head", "color": "#ff0000"})
    assert r.status_code == 201
    tag = r.json()
    assert tag["name"] == "head"

    # duplicate name → 409
    r = client.post("/api/tags", json={"name": "head"})
    assert r.status_code == 409

    tags = client.get("/api/tags").json()
    assert len(tags) == 1

    # entry referencing tag, then filter
    r = client.post(
        "/api/entries",
        json={"ts_event": _ts(), "text_md": "with tag", "tag_ids": [tag["id"]]},
    )
    assert r.status_code == 201
    entry = r.json()
    assert len(entry["tags"]) == 1 and entry["tags"][0]["id"] == tag["id"]

    filtered = client.get("/api/entries", params={"tag": tag["id"]}).json()
    assert len(filtered) == 1

    # delete tag cascades the entry_tag row but keeps the entry
    assert client.delete(f"/api/tags/{tag['id']}").status_code == 204
    e = client.get(f"/api/entries/{entry['id']}").json()
    assert e["tags"] == []


def test_invalid_tag_id_rejected(client: TestClient) -> None:
    _setup(client)
    r = client.post(
        "/api/entries",
        json={"ts_event": _ts(), "text_md": "x", "tag_ids": ["does-not-exist"]},
    )
    assert r.status_code == 400


def test_date_range_filter(client: TestClient) -> None:
    _setup(client)
    a = client.post("/api/entries", json={"ts_event": _ts(2026, 1, 1), "text_md": "a", "tag_ids": []}).json()
    b = client.post("/api/entries", json={"ts_event": _ts(2026, 6, 1), "text_md": "b", "tag_ids": []}).json()
    rng = client.get("/api/entries", params={"from": _ts(2026, 5, 1), "to": _ts(2026, 12, 31)}).json()
    ids = [e["id"] for e in rng]
    assert b["id"] in ids and a["id"] not in ids
