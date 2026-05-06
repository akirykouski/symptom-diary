"""FastAPI dependencies."""
from __future__ import annotations

import sqlite3

from fastapi import Cookie, HTTPException, status

from .config import SESSION_COOKIE
from .mobile_pair import SESSION_COOKIE_NAME as MOBILE_COOKIE, mobile_store
from .session import store


def require_unlocked(diary_session: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> sqlite3.Connection:
    conn = store.get_conn(diary_session)
    if conn is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="locked")
    return conn


def require_mobile_or_unlocked(
    diary_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    diary_mobile_session: str | None = Cookie(default=None, alias=MOBILE_COOKIE),
) -> sqlite3.Connection:
    """Accept either the desktop owner cookie or a paired-phone cookie.

    A mobile cookie only resolves while:
      - the cookie itself hasn't expired, AND
      - the desktop journal is unlocked (we share the desktop's connection).

    If only the mobile cookie is presented and the desktop has locked, we
    still 401 — locking the journal must invalidate every device.
    """
    # Desktop session takes precedence and bumps its own activity timer.
    conn = store.get_conn(diary_session)
    if conn is not None:
        return conn

    if diary_mobile_session:
        sess = mobile_store.touch(diary_mobile_session)
        if sess is not None:
            shared = store.peek_conn()
            if shared is not None:
                return shared

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="locked")
