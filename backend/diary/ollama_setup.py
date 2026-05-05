"""Bootstrap Ollama from inside the app.

We can't fully bypass the OS's install gates (macOS gatekeeper for .dmg,
Windows UAC for .msi, Linux sudo for /usr/local/bin) — but we can do quite
a lot:

  - Detect OS, arch, whether `ollama` is on PATH, whether Homebrew is
    available, whether the daemon answers on localhost:11434.
  - Run `brew install ollama` as a subprocess on macOS+brew machines and
    stream stdout/stderr live (`POST /api/ollama/install/brew`).
  - Spawn `ollama serve` ourselves as a managed child process and kill it
    on backend shutdown (FastAPI lifespan).
  - For Linux + Windows, return the canonical install command / download
    URL so the UI can render copy-to-clipboard / "open download page"
    affordances.

The module is intentionally side-effect free at import time: the daemon is
only started on explicit request and is shared across requests via a
module-level handle.
"""
from __future__ import annotations

import asyncio
import logging
import os
import platform
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from typing import AsyncIterator

from .llm import OllamaClient

logger = logging.getLogger("diary.ollama_setup")


# ---------- detection -------------------------------------------------------


def _platform_id() -> str:
    if sys.platform == "darwin":
        return "macos"
    if sys.platform.startswith("linux"):
        return "linux"
    if sys.platform == "win32":
        return "windows"
    return sys.platform


_DOWNLOAD_URLS = {
    "macos": "https://ollama.com/download/Ollama-darwin.zip",
    "linux": "https://ollama.com/download/linux",
    "windows": "https://ollama.com/download/OllamaSetup.exe",
}

LINUX_INSTALL_ONE_LINER = "curl -fsSL https://ollama.com/install.sh | sh"


@dataclass
class _Daemon:
    proc: subprocess.Popen | None = None
    started_at: float | None = None


_DAEMON = _Daemon()


async def detect_state() -> dict:
    """Compact status object the UI uses to drive the wizard."""
    plat = _platform_id()
    binary = shutil.which("ollama")
    brew = shutil.which("brew") if plat == "macos" else None
    reachable = await OllamaClient().is_reachable()

    methods: list[dict] = []
    if binary is None:
        if plat == "macos" and brew is not None:
            methods.append({
                "id": "brew",
                "label": "Install via Homebrew",
                "command": "brew install ollama",
                "auto_runnable": True,
                "needs_confirm": True,
            })
        if plat == "macos":
            methods.append({
                "id": "macos_download",
                "label": "Download the macOS app",
                "command": None,
                "url": _DOWNLOAD_URLS["macos"],
                "auto_runnable": False,
                "needs_confirm": False,
            })
        if plat == "linux":
            methods.append({
                "id": "linux_oneliner",
                "label": "Official Linux installer",
                "command": LINUX_INSTALL_ONE_LINER,
                "auto_runnable": False,  # needs sudo, can't run from backend safely
                "needs_confirm": False,
                "hint": "Run this in a terminal — it prompts for sudo.",
            })
        if plat == "windows":
            methods.append({
                "id": "windows_download",
                "label": "Download the Windows installer",
                "command": None,
                "url": _DOWNLOAD_URLS["windows"],
                "auto_runnable": False,
                "needs_confirm": False,
            })

    daemon_pid = (
        _DAEMON.proc.pid
        if _DAEMON.proc and _DAEMON.proc.poll() is None
        else None
    )

    return {
        "platform": plat,
        "arch": platform.machine(),
        "binary_present": binary is not None,
        "binary_path": binary,
        "brew_present": brew is not None,
        "daemon_reachable": reachable,
        "daemon_managed_pid": daemon_pid,
        "download_url": _DOWNLOAD_URLS.get(plat),
        "methods": methods,
        "linux_one_liner": LINUX_INSTALL_ONE_LINER,
    }


# ---------- install (streamed) ----------------------------------------------


# Whitelist of methods we are willing to spawn as subprocesses. Anything not
# in this map is treated as "manual" and the caller must use the URL/command.
_RUNNABLE: dict[str, list[str]] = {
    # `--quiet` to keep brew's output reasonable in the streamed log.
    "brew": ["brew", "install", "--quiet", "ollama"],
}


async def run_install(method_id: str) -> AsyncIterator[str]:
    """Spawn the installer for `method_id` and yield NDJSON lines.

    Each yielded chunk is a JSON object terminated by a newline:
      {"type":"line","text":"..."}        — captured stdout/stderr
      {"type":"exit","code":N}            — process exit code
      {"type":"error","message":"..."}    — preflight or spawn error
    """
    if method_id not in _RUNNABLE:
        yield _ndjson("error", message=f"method {method_id!r} is not runnable from the app; "
                      "use the manual command/url instead")
        return

    argv = _RUNNABLE[method_id]
    if shutil.which(argv[0]) is None:
        yield _ndjson("error", message=f"{argv[0]!r} not found on PATH")
        return

    yield _ndjson("line", text=f"$ {' '.join(argv)}\n")
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env={**os.environ, "HOMEBREW_NO_AUTO_UPDATE": "1"},
        )
    except (FileNotFoundError, PermissionError) as e:
        yield _ndjson("error", message=f"failed to spawn: {e}")
        return

    assert proc.stdout is not None
    while True:
        chunk = await proc.stdout.readline()
        if not chunk:
            break
        yield _ndjson("line", text=chunk.decode("utf-8", errors="replace"))
    rc = await proc.wait()
    yield _ndjson("exit", code=rc)


def _ndjson(kind: str, **fields: object) -> str:
    import json as _json
    return _json.dumps({"type": kind, **fields}) + "\n"


# ---------- managed daemon --------------------------------------------------


def daemon_status() -> dict:
    proc = _DAEMON.proc
    running = proc is not None and proc.poll() is None
    return {
        "managed": running,
        "pid": proc.pid if running else None,
        "started_at": _DAEMON.started_at,
        "binary_present": shutil.which("ollama") is not None,
    }


async def start_daemon(*, wait_seconds: float = 8.0) -> dict:
    """Spawn `ollama serve` if not already running. Returns status dict.

    If a daemon is already reachable on localhost:11434 (started by the user
    or by the system), we don't spawn a second one — we simply report that.
    """
    client = OllamaClient()
    if await client.is_reachable():
        return {"running": True, "managed_pid": None, "started": False, "reason": "already_running"}

    if shutil.which("ollama") is None:
        return {"running": False, "managed_pid": None, "started": False, "reason": "binary_missing"}

    if _DAEMON.proc is not None and _DAEMON.proc.poll() is None:
        # We have a child but it isn't responding yet; give it a moment.
        ok = await _wait_reachable(client, wait_seconds)
        return {
            "running": ok,
            "managed_pid": _DAEMON.proc.pid,
            "started": False,
            "reason": "already_spawned" if ok else "spawned_but_unreachable",
        }

    proc = subprocess.Popen(  # noqa: S603 — `ollama` resolved via shutil.which
        ["ollama", "serve"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    _DAEMON.proc = proc
    _DAEMON.started_at = time.time()
    ok = await _wait_reachable(client, wait_seconds)
    if not ok:
        # Don't leave a zombie around if it couldn't even bind the port.
        try:
            proc.terminate()
        except Exception:
            pass
        _DAEMON.proc = None
        _DAEMON.started_at = None
        return {"running": False, "managed_pid": None, "started": False, "reason": "spawn_unreachable"}
    return {"running": True, "managed_pid": proc.pid, "started": True, "reason": "spawned"}


def stop_daemon() -> dict:
    """Stop the daemon ONLY if we started it ourselves. Never kill an
    unmanaged Ollama (the user might be using it elsewhere)."""
    proc = _DAEMON.proc
    if proc is None or proc.poll() is not None:
        _DAEMON.proc = None
        return {"stopped": False, "reason": "not_managed"}
    try:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    finally:
        _DAEMON.proc = None
        _DAEMON.started_at = None
    return {"stopped": True}


async def _wait_reachable(client: OllamaClient, seconds: float) -> bool:
    start = time.monotonic()
    while time.monotonic() - start < seconds:
        if await client.is_reachable():
            return True
        await asyncio.sleep(0.4)
    return False


# Cleanup hook used by FastAPI lifespan. Idempotent.
def shutdown() -> None:
    if _DAEMON.proc is not None and _DAEMON.proc.poll() is None:
        try:
            stop_daemon()
        except Exception:  # noqa: BLE001
            logger.exception("ollama daemon shutdown failed")
