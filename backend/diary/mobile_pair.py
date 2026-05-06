"""Mobile-companion pairing: one-shot token mint → long-lived mobile session.

Plan section MVP-5 / "PWA mobile capture".

Two stores live here:

  PairingStore   - short-lived (≤ 30 min) one-shot tokens minted by the
                   desktop owner. The phone consumes the token by POSTing
                   it to /api/mobile/exchange and gets a session cookie back.

  MobileStore    - the long-lived session table. Each entry maps a
                   `diary_mobile_session` cookie to a `MobileSession` row
                   with metadata (label, created_at, last_used_at, fetches).
                   A mobile session shares the desktop owner's unlocked
                   sqlite connection (via `session.store.peek_conn`) — i.e.
                   when the journal locks, every mobile session loses access
                   simultaneously. That keeps the threat model simple: the
                   master key never crosses the LAN, and revocation is
                   already coupled to lock state.

Threat model: anyone on the same LAN with a valid pairing token can write
to the journal. Mitigations: short pairing TTL, one-shot consumption, the
mobile cookie has no read/auth surface beyond entries+media, and the owner
can list/revoke active sessions from the desktop UI.
"""
from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone


PAIR_DEFAULT_TTL_MINUTES = 10
PAIR_MAX_TTL_MINUTES = 30
SESSION_TTL_DAYS = 30
SESSION_COOKIE_NAME = "diary_mobile_session"


def _isoz(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------- pairing tokens (one-shot) ---------------------------------------


@dataclass
class PairingToken:
    token: str
    created_at: float
    expires_at: float
    consumed: bool = False

    def is_valid(self, now: float | None = None) -> bool:
        n = now if now is not None else time.time()
        return not self.consumed and n < self.expires_at

    def to_public(self) -> dict:
        return {
            "token": self.token,
            "created_at": _isoz(self.created_at),
            "expires_at": _isoz(self.expires_at),
        }


@dataclass
class PairingStore:
    _lock: threading.RLock = field(default_factory=threading.RLock)
    _by_token: dict[str, PairingToken] = field(default_factory=dict)

    def mint(self, *, ttl_minutes: int) -> PairingToken:
        ttl = max(1, min(PAIR_MAX_TTL_MINUTES, int(ttl_minutes)))
        now = time.time()
        token = PairingToken(
            token=secrets.token_urlsafe(24),
            created_at=now,
            expires_at=now + ttl * 60,
        )
        with self._lock:
            self._by_token[token.token] = token
        return token

    def consume(self, token: str) -> PairingToken | None:
        if not token:
            return None
        with self._lock:
            t = self._by_token.get(token)
            if t is None or not t.is_valid():
                if t is not None:
                    self._by_token.pop(token, None)
                return None
            t.consumed = True
            # Drop it after consume — these are one-shot.
            self._by_token.pop(token, None)
            return t

    def reset(self) -> None:
        with self._lock:
            self._by_token.clear()


# ---------- mobile sessions (long-lived) ------------------------------------


@dataclass
class MobileSession:
    id: str
    cookie_token: str
    label: str
    created_at: float
    expires_at: float
    last_used_at: float | None = None
    fetches: int = 0

    def is_valid(self, now: float | None = None) -> bool:
        n = now if now is not None else time.time()
        return n < self.expires_at

    def to_public(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "created_at": _isoz(self.created_at),
            "expires_at": _isoz(self.expires_at),
            "last_used_at": _isoz(self.last_used_at) if self.last_used_at else None,
            "fetches": self.fetches,
        }


@dataclass
class MobileStore:
    _lock: threading.RLock = field(default_factory=threading.RLock)
    _by_cookie: dict[str, MobileSession] = field(default_factory=dict)

    def create(self, *, label: str = "phone") -> MobileSession:
        now = time.time()
        sess = MobileSession(
            id=secrets.token_hex(8),
            cookie_token=secrets.token_urlsafe(32),
            label=label,
            created_at=now,
            expires_at=now + SESSION_TTL_DAYS * 86400,
        )
        with self._lock:
            self._by_cookie[sess.cookie_token] = sess
        return sess

    def touch(self, cookie_token: str) -> MobileSession | None:
        """Validate the cookie and bump usage. Returns None on miss/expiry."""
        if not cookie_token:
            return None
        with self._lock:
            sess = self._by_cookie.get(cookie_token)
            if sess is None or not sess.is_valid():
                if sess is not None:
                    self._by_cookie.pop(cookie_token, None)
                return None
            sess.last_used_at = time.time()
            sess.fetches += 1
            return sess

    def get(self, cookie_token: str) -> MobileSession | None:
        with self._lock:
            sess = self._by_cookie.get(cookie_token)
            if sess is None or not sess.is_valid():
                return None
            return sess

    def revoke_by_id(self, session_id: str) -> bool:
        with self._lock:
            for tok, sess in list(self._by_cookie.items()):
                if sess.id == session_id:
                    self._by_cookie.pop(tok, None)
                    return True
        return False

    def list_active(self) -> list[MobileSession]:
        now = time.time()
        with self._lock:
            for tok in list(self._by_cookie):
                if not self._by_cookie[tok].is_valid(now):
                    self._by_cookie.pop(tok, None)
            return list(self._by_cookie.values())

    def reset(self) -> None:
        with self._lock:
            self._by_cookie.clear()


# Module-level singletons. Tests reset them via the fixtures.
pairing_store = PairingStore()
mobile_store = MobileStore()


__all__ = [
    "PAIR_DEFAULT_TTL_MINUTES",
    "PAIR_MAX_TTL_MINUTES",
    "SESSION_COOKIE_NAME",
    "SESSION_TTL_DAYS",
    "MobileSession",
    "MobileStore",
    "PairingStore",
    "PairingToken",
    "mobile_store",
    "pairing_store",
]
