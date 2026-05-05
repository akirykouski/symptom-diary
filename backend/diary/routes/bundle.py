"""Encrypted `.diary` bundle export / import endpoints."""
from __future__ import annotations

import io
import sqlite3
import tempfile
from pathlib import Path

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

from .. import bundle as bundle_mod
from ..config import SESSION_COOKIE, data_dir, db_path, media_dir, salt_path
from ..deps import require_unlocked
from ..session import store


router = APIRouter(prefix="/api/bundle", tags=["bundle"])


@router.get("/export")
def export_bundle_route(
    diary_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> StreamingResponse:
    """Stream the encrypted bundle for download.

    We assemble the tarball in a temp file (so the response can carry an
    accurate Content-Length and so any export error surfaces *before* we
    start streaming bytes to the client), then stream it back.
    """
    salt_file = salt_path()
    db_file = db_path()
    if not salt_file.exists() or not db_file.exists():
        raise HTTPException(status_code=400, detail="not_setup")

    salt = salt_file.read_bytes()
    tmp = tempfile.NamedTemporaryFile(prefix="diary-export-", suffix=".diary", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    try:
        summary = bundle_mod.export_bundle(
            tmp_path,
            conn=conn,
            salt=salt,
            src_db=db_file,
            src_salt=salt_file,
            src_media=media_dir(),
        )
    except Exception as e:  # noqa: BLE001 — surface to client, then rethrow
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=f"export_failed: {e}") from e

    def _stream():
        try:
            with tmp_path.open("rb") as f:
                while True:
                    chunk = f.read(64 * 1024)
                    if not chunk:
                        break
                    yield chunk
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass

    headers = {
        "Content-Disposition": f'attachment; filename="{bundle_mod.filename_for_export()}"',
        "Content-Length": str(summary.bytes_written),
        "X-Diary-Bundle-Entries": str(summary.entries),
        "X-Diary-Bundle-Media": str(summary.media_files),
        "X-Diary-Bundle-Schema": str(summary.schema_version),
    }
    return StreamingResponse(
        _stream(), media_type="application/x-symptom-diary", headers=headers
    )


@router.post("/import", status_code=status.HTTP_201_CREATED)
async def import_bundle_route(
    file: UploadFile = File(...),
    passphrase: str = Form(..., min_length=1, max_length=512),
) -> dict:
    """Import a `.diary` bundle into a fresh install.

    Refuses if the install already has data (must be a clean target). The
    passphrase must be the one the bundle was exported with — there is no
    re-encryption path, by design.
    """
    if db_path().exists() or salt_path().exists():
        raise HTTPException(status_code=409, detail="already_setup")
    if store.is_unlocked():
        # Defensive: shouldn't happen if not setup, but make it explicit.
        store.lock()

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty_file")
    # Cap bundle size to something sane so a hostile upload can't fill /tmp.
    if len(raw) > 1024 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="bundle_too_large")

    try:
        summary = bundle_mod.import_bundle(
            io.BytesIO(raw),
            target_data_dir=data_dir(),
            passphrase=passphrase,
        )
    except bundle_mod.BundleError as e:
        msg = str(e)
        # Distinguish wrong-passphrase from malformed-bundle so the UI can
        # show a precise error.
        if "passphrase" in msg.lower():
            raise HTTPException(status_code=401, detail="invalid_passphrase") from e
        raise HTTPException(status_code=400, detail=msg) from e

    return {
        "entries": summary.entries,
        "media_files": summary.media_files,
        "schema_version": summary.schema_version,
    }
