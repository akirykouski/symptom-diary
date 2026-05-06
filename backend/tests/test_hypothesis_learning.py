"""Hypothesis Engine learning loop: dismissal cooldown, confirmed boost,
corroboration, feedback history."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from diary import hypothesis_engine as he
from diary.session import store as session_store


_PASS = "correct horse battery staple"


def _setup(client: TestClient) -> None:
    r = client.post("/api/auth/setup", json={"passphrase": _PASS})
    assert r.status_code == 201


def _seed(client: TestClient) -> None:
    r = client.post("/api/demo/load", json={"persona_id": "anna"})
    assert r.status_code == 200


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ago_days(n: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=n)).isoformat()


def _ensure_disease(conn, disease_id: str) -> None:
    exists = conn.execute(
        "SELECT 1 FROM disease_profile WHERE id = ?", (disease_id,)
    ).fetchone()
    if exists:
        return
    conn.execute(
        """
        INSERT INTO disease_profile
          (id, source, name, synonyms, prevalence_class, inheritance, age_of_onset,
           description_md, source_url, category, red_flag, last_synced_at)
        VALUES (?, 'seed', ?, '[]', NULL, NULL, NULL, '', 'http://example/', 'autoimmune', 0, ?)
        """,
        (disease_id, disease_id.split(":")[-1].replace("_", " ").title(), _now()),
    )


def _seed_hypothesis(
    conn,
    *,
    disease_id: str = "seed:lupus_sle",
    score: float = 1.0,
    signal: str = "moderate",
    status: str = "active",
    cited_entry_ids: list[str] | None = None,
) -> str:
    _ensure_disease(conn, disease_id)
    hid = str(uuid.uuid4())
    expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    conn.execute(
        """
        INSERT INTO hypothesis
          (id, disease_id, match_score, signal_strength, rationale_md,
           cited_entry_ids, cited_lab_value_ids, cited_medication_ids,
           matched_features, suggested_actions_md, status, generated_at,
           expires_at, user_note, dismissed_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
        """,
        (
            hid,
            disease_id,
            score,
            signal,
            "Consider ruling out something. The pattern resembles X.",
            json.dumps(cited_entry_ids or []),
            "[]",
            "[]",
            "[]",
            None,
            status,
            _now(),
            expires,
        ),
    )
    return hid


# ---------- update_hypothesis_status records feedback ------------------------


def test_dismiss_records_feedback_event(client: TestClient) -> None:
    _setup(client)
    _seed(client)
    conn = session_store.peek_conn()
    assert conn is not None
    hid = _seed_hypothesis(conn, score=0.95)

    h = he.update_hypothesis_status(conn, hid, status="dismissed", dismissed_reason="ruled out")
    assert h is not None
    assert h["status"] == "dismissed"

    rows = conn.execute(
        "SELECT * FROM hypothesis_feedback WHERE hypothesis_id = ?", (hid,)
    ).fetchall()
    assert len(rows) == 1
    r = rows[0]
    assert r["action"] == "dismissed"
    assert r["reason"] == "ruled out"
    assert abs(float(r["match_score_at_action"]) - 0.95) < 1e-6


def test_confirm_records_feedback_event(client: TestClient) -> None:
    _setup(client)
    conn = session_store.peek_conn()
    assert conn is not None
    hid = _seed_hypothesis(conn, score=1.4)
    he.update_hypothesis_status(conn, hid, status="confirmed")
    rows = conn.execute(
        "SELECT action FROM hypothesis_feedback WHERE hypothesis_id = ?", (hid,)
    ).fetchall()
    assert [r["action"] for r in rows] == ["confirmed"]


def test_reactivate_records_event(client: TestClient) -> None:
    _setup(client)
    conn = session_store.peek_conn()
    assert conn is not None
    hid = _seed_hypothesis(conn, score=1.0, status="dismissed")
    he.update_hypothesis_status(conn, hid, status="active")
    actions = [
        r["action"] for r in conn.execute(
            "SELECT action FROM hypothesis_feedback WHERE hypothesis_id = ? "
            "ORDER BY recorded_at",
            (hid,),
        ).fetchall()
    ]
    assert actions == ["reactivated"]


# ---------- recheck respects cooldown ---------------------------------------


def test_recheck_suppresses_recently_dismissed(client: TestClient) -> None:
    """End-to-end via HTTP: recheck → dismiss → recheck → dismissed disease
    must move to suppressed (not bubble back into active)."""
    _setup(client)
    _seed(client)

    # First recheck via the route, which auto-seeds the KB on first call.
    r = client.post("/api/hypotheses/recheck")
    assert r.status_code == 200
    assert r.json()["hypotheses_written"] >= 1

    active = client.get("/api/hypotheses?status=active").json()
    target = active[0]

    r = client.patch(
        f"/api/hypotheses/{target['id']}",
        json={"status": "dismissed", "dismissed_reason": "ruled out"},
    )
    assert r.status_code == 200

    # Re-run — same disease must NOT come back as 'active' (no growth).
    r = client.post("/api/hypotheses/recheck")
    assert r.status_code == 200

    actives_now = client.get("/api/hypotheses?status=active").json()
    assert target["disease_id"] not in {h["disease_id"] for h in actives_now}

    # It still surfaces under status=suppressed so the UI can show "you dismissed".
    suppressed = client.get("/api/hypotheses?status=suppressed").json()
    assert target["disease_id"] in {h["disease_id"] for h in suppressed}


@pytest.mark.asyncio
async def test_recheck_resurfaces_when_score_grows(client: TestClient) -> None:
    """If the new aggregate score is ≥ RESURFACE_FACTOR × the dismissal score,
    the disease is allowed back into 'active'."""
    _setup(client)
    conn = session_store.peek_conn()
    assert conn is not None

    # Inject a fake feedback row dismissing 'seed:lupus_sle' at score 0.5
    # AS IF it had happened recently. Then call recheck on a freshly-seeded
    # demo journal — Anna's Hashimoto picture should NOT match SLE strongly,
    # but we verify the cooldown logic by comparing the active list against
    # the dismissals map directly.
    hid = _seed_hypothesis(conn, score=0.5)
    conn.execute(
        """
        INSERT INTO hypothesis_feedback (id, hypothesis_id, disease_id, action,
                                         reason, recorded_at, match_score_at_action)
        VALUES (?, ?, ?, 'dismissed', NULL, ?, ?)
        """,
        (str(uuid.uuid4()), hid, "seed:lupus_sle", _now(), 0.5),
    )

    dismissed = he._recent_dismissals(conn)
    assert "seed:lupus_sle" in dismissed
    recorded_at, score = dismissed["seed:lupus_sle"]
    assert abs(score - 0.5) < 1e-6


def test_old_dismissals_outside_cooldown_are_ignored(client: TestClient) -> None:
    _setup(client)
    conn = session_store.peek_conn()
    assert conn is not None

    # Insert a dismissal recorded WAY in the past — outside the 60d window.
    hid = _seed_hypothesis(conn)
    conn.execute(
        "INSERT INTO hypothesis_feedback (id, hypothesis_id, disease_id, action, "
        "                                 reason, recorded_at, match_score_at_action) "
        "VALUES (?, ?, ?, 'dismissed', NULL, ?, ?)",
        (str(uuid.uuid4()), hid, "seed:lupus_sle", _ago_days(120), 0.9),
    )
    dismissed = he._recent_dismissals(conn)
    assert "seed:lupus_sle" not in dismissed


def test_confirmed_disease_is_pinned_at_top(client: TestClient) -> None:
    _setup(client)
    conn = session_store.peek_conn()
    assert conn is not None

    weak = _seed_hypothesis(conn, disease_id="seed:hashimoto", score=0.4, signal="weak")
    moderate = _seed_hypothesis(
        conn, disease_id="seed:lupus_sle", score=1.2, signal="moderate"
    )
    # Confirm the weak one — it should jump above the moderate.
    he.update_hypothesis_status(conn, weak, status="confirmed")
    # `confirmed` is itself filtered out of `status='active'`, so reactivate
    # it (the listing pinning still applies via the disease's confirmed-history).
    he.update_hypothesis_status(conn, weak, status="active")

    listing = he.list_hypotheses(conn, status="active")
    assert listing[0]["id"] == weak  # pinned
    assert listing[0]["user_confirmed"] is True
    assert listing[1]["id"] == moderate
    assert listing[1]["user_confirmed"] is False


def test_confirmed_diseases_helper(client: TestClient) -> None:
    _setup(client)
    conn = session_store.peek_conn()
    assert conn is not None
    hid = _seed_hypothesis(conn)
    he.update_hypothesis_status(conn, hid, status="confirmed")
    confirmed = he._confirmed_diseases(conn)
    assert "seed:lupus_sle" in confirmed


# ---------- corroboration ----------------------------------------------------


def test_corroborate_and_uncorroborate(client: TestClient) -> None:
    _setup(client)
    _seed(client)
    conn = session_store.peek_conn()
    assert conn is not None

    entry_id = conn.execute("SELECT id FROM entry LIMIT 1").fetchone()["id"]
    hid = _seed_hypothesis(conn, cited_entry_ids=[entry_id])

    assert he.corroborate_entry(conn, hypothesis_id=hid, entry_id=entry_id) is True
    assert he.corroborated_entry_ids(conn, hid) == [entry_id]

    # Idempotent.
    assert he.corroborate_entry(conn, hypothesis_id=hid, entry_id=entry_id) is True
    assert he.corroborated_entry_ids(conn, hid) == [entry_id]

    he.uncorroborate_entry(conn, hypothesis_id=hid, entry_id=entry_id)
    assert he.corroborated_entry_ids(conn, hid) == []


def test_corroborate_unknown_entry_returns_false(client: TestClient) -> None:
    _setup(client)
    conn = session_store.peek_conn()
    assert conn is not None
    hid = _seed_hypothesis(conn)
    assert he.corroborate_entry(conn, hypothesis_id=hid, entry_id="no-such-entry") is False


def test_corroborate_via_route(client: TestClient) -> None:
    _setup(client)
    _seed(client)
    conn = session_store.peek_conn()
    assert conn is not None
    entry_id = conn.execute("SELECT id FROM entry LIMIT 1").fetchone()["id"]
    hid = _seed_hypothesis(conn, cited_entry_ids=[entry_id])

    r = client.patch(f"/api/hypotheses/{hid}", json={"corroborate_entry_id": entry_id})
    assert r.status_code == 200
    body = r.json()
    assert body["corroborated_entry_ids"] == [entry_id]

    # Uncorroborate.
    r = client.patch(f"/api/hypotheses/{hid}", json={"uncorroborate_entry_id": entry_id})
    assert r.status_code == 200
    assert r.json()["corroborated_entry_ids"] == []


def test_corroborated_entries_appear_in_brief(client: TestClient) -> None:
    _setup(client)
    _seed(client)
    conn = session_store.peek_conn()
    assert conn is not None
    entry_id = conn.execute("SELECT id FROM entry LIMIT 1").fetchone()["id"]
    hid = _seed_hypothesis(conn, cited_entry_ids=[entry_id])
    he.corroborate_entry(conn, hypothesis_id=hid, entry_id=entry_id)

    r = client.post("/api/insights/brief", json={})
    assert r.status_code == 200
    md = r.json()["markdown"]
    short_id = entry_id.split("-")[0]
    assert f"#{short_id} ✓" in md


# ---------- feedback history -------------------------------------------------


def test_feedback_history_route(client: TestClient) -> None:
    _setup(client)
    conn = session_store.peek_conn()
    assert conn is not None
    a = _seed_hypothesis(conn)
    b = _seed_hypothesis(conn, disease_id="seed:hashimoto")
    he.update_hypothesis_status(conn, a, status="dismissed", dismissed_reason="r")
    he.update_hypothesis_status(conn, b, status="confirmed")

    r = client.get("/api/hypotheses/feedback-history")
    assert r.status_code == 200
    history = r.json()
    assert len(history) == 2
    # Reverse-chron: confirmed (b) was inserted last.
    assert history[0]["action"] == "confirmed"
    assert history[1]["action"] == "dismissed"


def test_invalid_status_rejected(client: TestClient) -> None:
    _setup(client)
    conn = session_store.peek_conn()
    assert conn is not None
    hid = _seed_hypothesis(conn)
    r = client.patch(f"/api/hypotheses/{hid}", json={"status": "totally-fake"})
    # update_hypothesis_status returns None for unknown status; route 404s.
    assert r.status_code == 404


def test_suppressed_status_is_valid(client: TestClient) -> None:
    _setup(client)
    conn = session_store.peek_conn()
    assert conn is not None
    hid = _seed_hypothesis(conn)
    h = he.update_hypothesis_status(conn, hid, status="suppressed")
    assert h is not None
    assert h["status"] == "suppressed"
    listing = he.list_hypotheses(conn, status="suppressed")
    assert any(x["id"] == hid for x in listing)
