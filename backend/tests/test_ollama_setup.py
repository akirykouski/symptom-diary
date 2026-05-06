"""Ollama bootstrap module — detection + streaming installer pipeline.

We never actually run `brew install ollama` from the test suite. Instead we
substitute a safe argv (`echo`, `false`) into the `_RUNNABLE` whitelist so
we can verify the streaming + exit-code plumbing end-to-end.
"""
from __future__ import annotations

import json
import sys
import pytest
from fastapi.testclient import TestClient

from diary import ollama_setup


def _setup_unlock(client: TestClient) -> None:
    r = client.post("/api/auth/setup", json={"passphrase": "correct horse battery staple"})
    assert r.status_code == 201


@pytest.mark.asyncio
async def test_detect_state_compact_object(client: TestClient) -> None:
    _setup_unlock(client)
    state = await ollama_setup.detect_state()
    # Required keys are always present, regardless of platform.
    for key in (
        "platform", "arch", "binary_present", "binary_path", "brew_present",
        "daemon_reachable", "daemon_managed_pid", "download_url",
        "methods", "linux_one_liner",
    ):
        assert key in state, f"missing key: {key}"
    assert state["platform"] in ("macos", "linux", "windows", "darwin", "win32") or isinstance(state["platform"], str)
    # Methods always carry the auto_runnable flag so the UI can decide.
    for m in state["methods"]:
        assert "auto_runnable" in m and "id" in m and "label" in m


def test_setup_endpoint_requires_unlock(client: TestClient) -> None:
    r = client.get("/api/ollama/setup")
    assert r.status_code == 401


def test_setup_endpoint_after_unlock(client: TestClient) -> None:
    _setup_unlock(client)
    r = client.get("/api/ollama/setup")
    assert r.status_code == 200
    body = r.json()
    assert "binary_present" in body
    assert "methods" in body


def test_install_route_rejects_unrunnable_method(client: TestClient) -> None:
    _setup_unlock(client)
    # macos_download is never auto_runnable — the UI should send the user to
    # the URL instead.
    r = client.post("/api/ollama/install/macos_download")
    assert r.status_code == 400
    r = client.post("/api/ollama/install/totally-bogus")
    assert r.status_code == 400


def test_install_streams_ndjson_with_safe_command(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Substitute a safe argv (echo) into the runnable whitelist and verify
    we stream `{type:line}` chunks plus a terminal `{type:exit, code:0}`."""
    _setup_unlock(client)

    # Make the brew method "auto_runnable" by injecting our safe argv. The route
    # asks detect_state() for the runnable list, so we patch _RUNNABLE — and
    # also force detect_state() to advertise the brew method on this host.
    monkeypatch.setitem(
        ollama_setup._RUNNABLE,
        "brew",
        [sys.executable, "-c", "print('hello-from-streaming-test')"],
    )
    # Force the detect step to show brew as auto-runnable so the route lets us through.
    real_detect = ollama_setup.detect_state

    async def fake_detect():
        d = await real_detect()
        d["methods"] = [{
            "id": "brew", "label": "Install via Homebrew",
            "command": "brew install ollama", "auto_runnable": True,
            "needs_confirm": True,
        }]
        return d

    monkeypatch.setattr(ollama_setup, "detect_state", fake_detect)

    with client.stream("POST", "/api/ollama/install/brew") as r:
        assert r.status_code == 200
        chunks: list[dict] = []
        for raw in r.iter_lines():
            if not raw:
                continue
            chunks.append(json.loads(raw))

    kinds = [c["type"] for c in chunks]
    assert "line" in kinds, chunks
    assert "exit" in kinds, chunks
    exit_chunks = [c for c in chunks if c["type"] == "exit"]
    assert exit_chunks[-1]["code"] == 0
    line_text = "".join(c.get("text", "") for c in chunks if c["type"] == "line")
    assert "hello-from-streaming-test" in line_text


def test_install_streams_error_when_binary_missing(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _setup_unlock(client)

    monkeypatch.setitem(
        ollama_setup._RUNNABLE,
        "brew",
        ["this-binary-does-not-exist-on-purpose-12345"],
    )
    real_detect = ollama_setup.detect_state

    async def fake_detect():
        d = await real_detect()
        d["methods"] = [{
            "id": "brew", "label": "Install via Homebrew",
            "command": "brew install ollama", "auto_runnable": True,
            "needs_confirm": True,
        }]
        return d

    monkeypatch.setattr(ollama_setup, "detect_state", fake_detect)

    with client.stream("POST", "/api/ollama/install/brew") as r:
        assert r.status_code == 200
        chunks = [json.loads(line) for line in r.iter_lines() if line]
    assert any(c["type"] == "error" for c in chunks), chunks


@pytest.mark.asyncio
async def test_start_daemon_no_binary_returns_reason() -> None:
    # No `ollama` on test PATH → start should refuse cleanly.
    import shutil
    if shutil.which("ollama") is not None:
        pytest.skip("ollama is installed on this host; can't test the missing-binary path")
    result = await ollama_setup.start_daemon(wait_seconds=0.1)
    assert result["running"] is False
    assert result["reason"] == "binary_missing"
    assert result["managed_pid"] is None


def test_stop_daemon_when_nothing_managed_is_safe() -> None:
    # Idempotent — stop without an active managed daemon must not raise.
    result = ollama_setup.stop_daemon()
    assert result["stopped"] is False
    assert result["reason"] == "not_managed"
