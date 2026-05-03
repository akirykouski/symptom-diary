"""FastAPI dependencies."""
from __future__ import annotations

import sqlite3

from fastapi import Cookie, HTTPException, status

from .config import SESSION_COOKIE
from .session import store


def require_unlocked(diary_session: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> sqlite3.Connection:
    conn = store.get_conn(diary_session)
    if conn is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="locked")
    return conn
