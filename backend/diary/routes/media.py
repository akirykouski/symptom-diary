"""Upload, fetch, list, delete media. Vision/whisper run async."""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from fastapi import (
    APIRouter,
    Cookie,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse

from .. import media as media_mod
from ..config import MAX_MEDIA_BYTES, SESSION_COOKIE
from ..db import transaction
from ..deps import require_mobile_or_unlocked, require_unlocked
from ..mobile_pair import SESSION_COOKIE_NAME as MOBILE_COOKIE, mobile_store
from ..models import MediaOut
from ..session import store

router = APIRouter(tags=["media"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_media(row: sqlite3.Row) -> MediaOut:
    return MediaOut(
        id=row["id"],
        entry_id=row["entry_id"],
        kind=row["kind"],
        mime=row["mime"],
        bytes=row["bytes"],
        duration_ms=row["duration_ms"],
        width=row["width"],
        height=row["height"],
        description=row["description"],
        transcript=row["transcript"],
        status=row["status"],
        last_error=row["last_error"],
        processed_at=row["processed_at"],
        created_at=row["created_at"],
    )


def _decide_kind(declared_kind: str | None, mime: str) -> str:
    """Infer one of image|audio|document. Document is opt-in via form field."""
    if declared_kind in ("image", "audio", "document"):
        return declared_kind
    if mime.startswith("image/"):
        return "image"
    if media_mod.is_audio_mime(mime):
        return "audio"
    return "image"  # last-resort default


def _master_key_or_401(diary_session: str | None) -> bytes:
    key = store.get_master_key(diary_session)
    if key is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="locked")
    return key


def _master_key_for_owner_or_mobile(
    diary_session: str | None, diary_mobile_session: str | None
) -> bytes:
    """Resolve the master key for an upload route that accepts either cookie.

    Owner cookie path: bumps activity, returns the per-session key.
    Mobile cookie path: validates the mobile session, then peeks the
    desktop's still-unlocked master key without bumping activity.
    """
    key = store.get_master_key(diary_session)
    if key is not None:
        return key
    if diary_mobile_session and mobile_store.touch(diary_mobile_session) is not None:
        peeked = store.peek_master_key()
        if peeked is not None:
            return peeked
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="locked")


@router.post(
    "/api/entries/{entry_id}/media",
    response_model=MediaOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_media(
    entry_id: str,
    file: UploadFile = File(...),
    kind: str | None = Form(default=None),
    diary_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    diary_mobile_session: str | None = Cookie(default=None, alias=MOBILE_COOKIE),
    conn: sqlite3.Connection = Depends(require_mobile_or_unlocked),
) -> MediaOut:
    master_key = _master_key_for_owner_or_mobile(diary_session, diary_mobile_session)

    row = conn.execute("SELECT id FROM entry WHERE id = ?", (entry_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="entry_not_found")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty_upload")
    if len(raw) > MAX_MEDIA_BYTES:
        raise HTTPException(status_code=413, detail="upload_too_large")

    declared_mime = file.content_type or ""
    chosen_kind = _decide_kind(kind, declared_mime)
    media_id = str(uuid.uuid4())
    storage = media_mod.media_file_path(entry_id, media_id)
    thumb_path = media_mod.thumb_file_path(entry_id, media_id)
    width: int | None = None
    height: int | None = None
    mime_to_store = declared_mime or "application/octet-stream"
    bytes_on_disk: int

    try:
        if chosen_kind in ("image", "document"):
            mime = media_mod.detect_image_mime(file.filename, declared_mime)
            prepared = media_mod.prepare_image(
                raw, mime=mime, document=(chosen_kind == "document")
            )
            bytes_on_disk = media_mod.encrypt_to_file(
                prepared.data, storage, master_key=master_key
            )
            if prepared.thumbnail:
                media_mod.encrypt_to_file(
                    prepared.thumbnail, thumb_path, master_key=master_key
                )
            width = prepared.width
            height = prepared.height
            mime_to_store = prepared.mime
        else:
            # audio (or anything else we treat as opaque blob)
            bytes_on_disk = media_mod.encrypt_to_file(
                raw, storage, master_key=master_key
            )
            mime_to_store = declared_mime or "application/octet-stream"
    except Exception as e:  # noqa: BLE001
        # Never leave half-written files around.
        media_mod.remove_media_files(entry_id, media_id)
        raise HTTPException(status_code=400, detail=f"upload_failed: {e}") from e

    with transaction(conn):
        conn.execute(
            """
            INSERT INTO media
              (id, entry_id, kind, storage_path, mime, bytes, width, height,
               status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
            """,
            (
                media_id,
                entry_id,
                chosen_kind,
                str(storage.relative_to(media_mod.media_dir())),
                mime_to_store,
                bytes_on_disk,
                width,
                height,
                _now(),
            ),
        )
    out = conn.execute("SELECT * FROM media WHERE id = ?", (media_id,)).fetchone()
    return _row_to_media(out)


@router.get("/api/entries/{entry_id}/media", response_model=list[MediaOut])
def list_entry_media(
    entry_id: str,
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> list[MediaOut]:
    rows = conn.execute(
        "SELECT * FROM media WHERE entry_id = ? ORDER BY created_at ASC", (entry_id,)
    ).fetchall()
    return [_row_to_media(r) for r in rows]


def _stream_path(path: Path, master_key: bytes) -> Iterator[bytes]:
    yield from media_mod.decrypt_stream(path, master_key=master_key)


@router.get("/api/media/{media_id}")
def fetch_media(
    media_id: str,
    diary_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    conn: sqlite3.Connection = Depends(require_unlocked),
):
    master_key = _master_key_or_401(diary_session)
    row = conn.execute(
        "SELECT entry_id, mime, kind FROM media WHERE id = ?", (media_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not_found")
    path = media_mod.media_file_path(row["entry_id"], media_id)
    if not path.exists():
        raise HTTPException(status_code=410, detail="missing_on_disk")
    return StreamingResponse(_stream_path(path, master_key), media_type=row["mime"])


@router.get("/api/media/{media_id}/thumbnail")
def fetch_thumbnail(
    media_id: str,
    diary_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    conn: sqlite3.Connection = Depends(require_unlocked),
):
    master_key = _master_key_or_401(diary_session)
    row = conn.execute(
        "SELECT entry_id, kind FROM media WHERE id = ?", (media_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not_found")
    if row["kind"] not in ("image", "document"):
        raise HTTPException(status_code=400, detail="no_thumbnail")
    path = media_mod.thumb_file_path(row["entry_id"], media_id)
    if not path.exists():
        # Fall back to the full file.
        path = media_mod.media_file_path(row["entry_id"], media_id)
        if not path.exists():
            raise HTTPException(status_code=410, detail="missing_on_disk")
    return StreamingResponse(_stream_path(path, master_key), media_type="image/jpeg")


@router.delete("/api/media/{media_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_media(media_id: str, conn: sqlite3.Connection = Depends(require_unlocked)) -> None:
    row = conn.execute(
        "SELECT entry_id FROM media WHERE id = ?", (media_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not_found")
    media_mod.remove_media_files(row["entry_id"], media_id)
    conn.execute("DELETE FROM media WHERE id = ?", (media_id,))


@router.post("/api/media/{media_id}/reprocess", status_code=status.HTTP_202_ACCEPTED)
def reprocess_media(media_id: str, conn: sqlite3.Connection = Depends(require_unlocked)) -> dict:
    row = conn.execute("SELECT id FROM media WHERE id = ?", (media_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not_found")
    conn.execute(
        "UPDATE media SET status = 'pending', last_error = NULL WHERE id = ?",
        (media_id,),
    )
    return {"status": "queued"}
