"""In-memory unlock state with auto-lock on inactivity.

The session holds the open DB connection. Lock destroys it.
"""
from __future__ import annotations

import secrets
import sqlite3
import threading
import time
from dataclasses import dataclass, field

from .config import SESSION_TIMEOUT_SECONDS


@dataclass
class _Session:
    token: str
    conn: sqlite3.Connection
    master_key: bytes
    last_activity: float = field(default_factory=time.monotonic)


class SessionStore:
    """Single-process, single-user. One session at a time."""

    def __init__(self, timeout_seconds: int = SESSION_TIMEOUT_SECONDS) -> None:
        self._timeout = timeout_seconds
        self._lock = threading.RLock()
        self._session: _Session | None = None

    def is_unlocked(self) -> bool:
        with self._lock:
            return self._active() is not None

    def unlock(self, conn: sqlite3.Connection, master_key: bytes = b"") -> str:
        with self._lock:
            if self._session is not None:
                try:
                    self._session.conn.close()
                except Exception:
                    pass
            token = secrets.token_urlsafe(32)
            self._session = _Session(token=token, conn=conn, master_key=master_key)
            return token

    def get_master_key(self, token: str | None) -> bytes | None:
        with self._lock:
            s = self._active()
            if s is None or token is None or not secrets.compare_digest(token, s.token):
                return None
            s.last_activity = time.monotonic()
            return s.master_key

    def peek_master_key(self) -> bytes | None:
        """Background-worker access — does NOT bump last_activity."""
        with self._lock:
            s = self._active()
            return s.master_key if s is not None else None

    def lock(self) -> None:
        with self._lock:
            if self._session is not None:
                try:
                    self._session.conn.close()
                finally:
                    self._session = None

    def get_conn(self, token: str | None) -> sqlite3.Connection | None:
        with self._lock:
            s = self._active()
            if s is None or token is None or not secrets.compare_digest(token, s.token):
                return None
            s.last_activity = time.monotonic()
            return s.conn

    def peek_conn(self) -> sqlite3.Connection | None:
        """Background-worker access — does NOT bump last_activity.

        The worker should not keep the session alive on its own; if the user
        is idle the session expires and the worker quietly stops processing.
        """
        with self._lock:
            s = self._active()
            return s.conn if s is not None else None

    def _active(self) -> _Session | None:
        s = self._session
        if s is None:
            return None
        if time.monotonic() - s.last_activity > self._timeout:
            try:
                s.conn.close()
            finally:
                self._session = None
            return None
        return s


# Module-level singleton, swapped in tests.
store = SessionStore()
