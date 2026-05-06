"""Auth endpoints: setup, unlock, lock, status, heartbeat."""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Response, status

from ..config import SESSION_COOKIE, db_path, salt_path
from ..crypto import derive_key, generate_salt
from ..db import DBError, create_db, open_db
from ..deps import require_unlocked
from ..models import AuthStatus, SetupRequest, UnlockRequest
from ..session import store

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/status", response_model=AuthStatus)
def auth_status() -> AuthStatus:
    return AuthStatus(setup=db_path().exists(), unlocked=store.is_unlocked())


@router.post("/setup", status_code=status.HTTP_201_CREATED)
def auth_setup(body: SetupRequest, response: Response) -> AuthStatus:
    if db_path().exists():
        raise HTTPException(status_code=409, detail="already_setup")
    salt = generate_salt()
    salt_file = salt_path()
    salt_file.parent.mkdir(parents=True, exist_ok=True)
    salt_file.write_bytes(salt)
    key = derive_key(body.passphrase, salt)
    try:
        conn = create_db(key)
    except DBError as e:
        # rollback salt file so retry works
        try:
            salt_file.unlink(missing_ok=True)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=str(e)) from e
    token = store.unlock(conn, key)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        secure=False,  # localhost dev
        max_age=15 * 60,
    )
    return AuthStatus(setup=True, unlocked=True)


@router.post("/unlock", response_model=AuthStatus)
def auth_unlock(body: UnlockRequest, response: Response) -> AuthStatus:
    if not db_path().exists() or not salt_path().exists():
        raise HTTPException(status_code=400, detail="not_setup")
    salt = salt_path().read_bytes()
    key = derive_key(body.passphrase, salt)
    try:
        conn = open_db(key)
    except DBError:
        raise HTTPException(status_code=401, detail="invalid_passphrase")
    token = store.unlock(conn, key)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=15 * 60,
    )
    return AuthStatus(setup=True, unlocked=True)


@router.post("/lock", status_code=status.HTTP_204_NO_CONTENT)
def auth_lock(response: Response) -> Response:
    store.lock()
    response.delete_cookie(SESSION_COOKIE)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/heartbeat", status_code=status.HTTP_204_NO_CONTENT)
def auth_heartbeat(
    _conn: sqlite3.Connection = Depends(require_unlocked),
) -> Response:
    """Bump the inactivity timer.

    The dependency itself bumps `last_activity` via `store.get_conn()`, so
    the body is a no-op. The frontend pings this on real user input
    (mouse, keyboard, scroll, touch) so the journal only auto-locks after
    a real period of idleness — not after 15 minutes of wall-clock time
    while the user reads the brief.
    """
    return Response(status_code=status.HTTP_204_NO_CONTENT)
