"""In-memory QR share-token store + helpers for the in-clinic handoff flow.

Plan section MVP-4 / "QR-bridge для in-clinic view":

  POST /api/export/qr-session
    Body: { ttl_minutes: 1-30, scope: "brief"|"full" }
    Returns { url, qr_svg_base64, token, expires_at }

  GET /share/<token>/brief.html
    Public read-only — validates the token, then renders the brief.

The URL points at the user's *LAN* IP so a clinician's phone on the same
WiFi can scan and load it directly. Tokens live in-memory only (never
persisted), have a TTL of at most 30 minutes, and can be revoked.

Security stance: this is explicitly a same-network handoff. The brief
content is patient-reported context, not credentials, so we accept that
*anyone with the URL while the token lives* can fetch it. We mitigate by:
  - short default TTL (10 min)
  - non-guessable tokens (32 bytes URL-safe random)
  - explicit revoke endpoint
  - one URL per scope; widening the scope requires a new token
"""
from __future__ import annotations

import base64
import io
import secrets
import socket
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import segno


SCOPES = {"brief", "full"}
DEFAULT_TTL_MINUTES = 10
MAX_TTL_MINUTES = 30


# ---------- token store -----------------------------------------------------


@dataclass
class ShareToken:
    token: str
    scope: str
    created_at: float
    expires_at: float
    fetches: int = 0
    last_fetched_at: float | None = None

    def is_expired(self, now: float | None = None) -> bool:
        return (now if now is not None else time.time()) >= self.expires_at

    def to_public(self) -> dict:
        return {
            "token": self.token,
            "scope": self.scope,
            "created_at": _isoz(self.created_at),
            "expires_at": _isoz(self.expires_at),
            "fetches": self.fetches,
        }


def _isoz(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class ShareStore:
    _lock: threading.RLock = field(default_factory=threading.RLock)
    _by_token: dict[str, ShareToken] = field(default_factory=dict)

    def create(self, *, scope: str, ttl_minutes: int) -> ShareToken:
        if scope not in SCOPES:
            raise ValueError(f"unknown scope: {scope!r}")
        ttl = max(1, min(MAX_TTL_MINUTES, int(ttl_minutes)))
        now = time.time()
        token = secrets.token_urlsafe(32)
        st = ShareToken(
            token=token,
            scope=scope,
            created_at=now,
            expires_at=now + ttl * 60,
        )
        with self._lock:
            self._by_token[token] = st
        return st

    def get(self, token: str) -> ShareToken | None:
        if not token:
            return None
        with self._lock:
            st = self._by_token.get(token)
            if st is None:
                return None
            if st.is_expired():
                # Lazy GC.
                self._by_token.pop(token, None)
                return None
            return st

    def consume(self, token: str) -> ShareToken | None:
        """Return the token if valid, and bump fetches/last_fetched_at."""
        with self._lock:
            st = self._by_token.get(token)
            if st is None or st.is_expired():
                if st is not None:
                    self._by_token.pop(token, None)
                return None
            st.fetches += 1
            st.last_fetched_at = time.time()
            return st

    def revoke(self, token: str) -> bool:
        with self._lock:
            return self._by_token.pop(token, None) is not None

    def list_active(self) -> list[ShareToken]:
        now = time.time()
        with self._lock:
            # Drop expired in passing.
            for t in list(self._by_token):
                if self._by_token[t].is_expired(now):
                    self._by_token.pop(t, None)
            return list(self._by_token.values())

    def reset(self) -> None:
        with self._lock:
            self._by_token.clear()


# Module-level singleton (process-wide).
store = ShareStore()


# ---------- LAN IP detection ------------------------------------------------


def detect_lan_ip() -> str:
    """Best-effort: open a UDP socket to a non-routable address and read the
    local addr. Returns 127.0.0.1 if we can't determine a LAN IP — the UI
    surfaces a warning so the user knows the QR will only work over USB
    tethering / hotspot."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # No packets are actually sent for SOCK_DGRAM connect.
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except OSError:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


def is_lan_ip(ip: str) -> bool:
    return ip != "127.0.0.1" and not ip.startswith("169.254.")  # link-local


# ---------- URL + QR helpers ------------------------------------------------


def share_url(token: str, *, scope: str, host: str, port: int) -> str:
    """Build the URL the clinician's phone will hit."""
    if scope == "brief":
        path = f"/share/{token}/brief.html"
    else:
        path = f"/share/{token}/full.html"
    return f"http://{host}:{port}{path}"


def render_qr_svg(text: str) -> str:
    """Return an SVG string for the given URL. Caller may base64-encode it
    for an <img src=data:...> embed."""
    qr = segno.make(text, error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", scale=8, dark="#0a0a0a", light="#ffffff", border=2, xmldecl=False)
    return buf.getvalue().decode("utf-8")


def render_qr_data_url(text: str) -> str:
    svg = render_qr_svg(text)
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{b64}"


__all__ = [
    "DEFAULT_TTL_MINUTES",
    "MAX_TTL_MINUTES",
    "SCOPES",
    "ShareStore",
    "ShareToken",
    "detect_lan_ip",
    "is_lan_ip",
    "render_qr_data_url",
    "render_qr_svg",
    "share_url",
    "store",
]
