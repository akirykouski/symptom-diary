"""Mobile-companion pairing + session endpoints.

Owner-side (require_unlocked):
  POST   /api/mobile/pair-token      mint a one-shot pairing token + QR
  GET    /api/mobile/sessions        list active mobile sessions
  DELETE /api/mobile/sessions/{id}   revoke a mobile session

Phone-side (no cookie / mobile cookie):
  POST   /api/mobile/exchange        consume the token, set the cookie
  POST   /api/mobile/logout          forget the cookie on the phone
  GET    /api/mobile/whoami          tell the phone whether it's paired and
                                     whether the desktop is currently unlocked
"""
from __future__ import annotations

import os
import sqlite3
from typing import Any

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from ..deps import require_unlocked
from ..mobile_pair import (
    PAIR_DEFAULT_TTL_MINUTES,
    PAIR_MAX_TTL_MINUTES,
    SESSION_COOKIE_NAME,
    SESSION_TTL_DAYS,
    mobile_store,
    pairing_store,
)
from ..qr_share import detect_lan_ip, is_lan_ip, render_qr_data_url
from ..session import store as session_store


router = APIRouter(prefix="/api/mobile", tags=["mobile"])


def _backend_port() -> int:
    return int(os.environ.get("DIARY_PORT", "8765"))


def _backend_host_override() -> str | None:
    v = os.environ.get("DIARY_LAN_HOST", "").strip()
    return v or None


def _pairing_url(token: str, *, host: str, port: int) -> str:
    return f"http://{host}:{port}/m/pair?token={token}"


# ---------- request models --------------------------------------------------


class PairTokenRequest(BaseModel):
    ttl_minutes: int = Field(PAIR_DEFAULT_TTL_MINUTES, ge=1, le=PAIR_MAX_TTL_MINUTES)
    label: str = Field("phone", min_length=1, max_length=40)


class ExchangeRequest(BaseModel):
    token: str = Field(..., min_length=8, max_length=128)
    label: str = Field("phone", min_length=1, max_length=40)


# ---------- owner-side endpoints --------------------------------------------


@router.post("/pair-token")
def mint_pair_token(
    body: PairTokenRequest, _conn: sqlite3.Connection = Depends(require_unlocked)
) -> dict[str, Any]:
    token = pairing_store.mint(ttl_minutes=body.ttl_minutes)
    host = _backend_host_override() or detect_lan_ip()
    port = _backend_port()
    url = _pairing_url(token.token, host=host, port=port)
    return {
        **token.to_public(),
        "url": url,
        "qr_data_url": render_qr_data_url(url),
        "lan_ok": is_lan_ip(host),
        "host": host,
        "port": port,
        "label_default": body.label,
    }


@router.get("/sessions")
def list_sessions(
    _conn: sqlite3.Connection = Depends(require_unlocked),
) -> dict[str, list[dict]]:
    return {"sessions": [s.to_public() for s in mobile_store.list_active()]}


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(
    session_id: str,
    _conn: sqlite3.Connection = Depends(require_unlocked),
) -> None:
    mobile_store.revoke_by_id(session_id)
    return None


# ---------- phone-side endpoints --------------------------------------------


@router.post("/exchange")
def exchange_token(body: ExchangeRequest, response: Response) -> dict[str, Any]:
    token = pairing_store.consume(body.token)
    if token is None:
        raise HTTPException(status_code=400, detail="invalid_or_expired_token")

    # The owner must still be unlocked at exchange time — otherwise the
    # session we'd hand out wouldn't be backed by an open connection. Surface
    # the same 401 vocabulary we use elsewhere.
    if not session_store.is_unlocked():
        raise HTTPException(status_code=401, detail="owner_locked")

    sess = mobile_store.create(label=body.label)
    response.set_cookie(
        SESSION_COOKIE_NAME,
        sess.cookie_token,
        httponly=True,
        samesite="lax",
        secure=False,  # LAN — clinician phone won't have HTTPS to localhost
        max_age=SESSION_TTL_DAYS * 86400,
        path="/",
    )
    return {"ok": True, **sess.to_public()}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def mobile_logout(
    response: Response,
    diary_mobile_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> None:
    if diary_mobile_session:
        sess = mobile_store.get(diary_mobile_session)
        if sess is not None:
            mobile_store.revoke_by_id(sess.id)
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return None


@router.get("/whoami")
def whoami(
    diary_mobile_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> dict[str, Any]:
    """Phone polls this to check pairing + owner-unlocked status."""
    if not diary_mobile_session:
        return {"paired": False, "owner_unlocked": session_store.is_unlocked()}
    sess = mobile_store.get(diary_mobile_session)
    if sess is None:
        return {"paired": False, "owner_unlocked": session_store.is_unlocked()}
    return {
        "paired": True,
        "owner_unlocked": session_store.is_unlocked(),
        "session": sess.to_public(),
    }
