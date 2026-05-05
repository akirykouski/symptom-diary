"""Encrypted `.diary` bundle export / import.

Plan section MVP-4: a single-file, opaque bundle of the entire installation
that the user can copy onto a USB stick, hand to a clinician, or move
between machines. The bundle is a gzip tarball containing:

  manifest.json    plain — format/version/created_at/schema_version/salt + counts
  diary.salt       raw 16-byte Argon2id salt (also recorded in manifest)
  diary.sqlite     the SQLCipher database, still encrypted with PRAGMA key
  media/<entry_id>/<media_id>.enc  the libsodium-encrypted media tree

Importantly: the bundle is cryptographically opaque without the passphrase,
because the SQLCipher file and every media chunk are still encrypted at
rest. The salt is included so an import on a fresh install can re-derive
the same key from the same passphrase.

Import semantics: an import is only permitted into an *empty* install
(no `diary.sqlite` and no `diary.salt` present at the target). After
import the imported passphrase becomes the install's passphrase. There
is no merge-into-existing flow on purpose — that would require knowing
both the source and destination passphrases at the same time and would
produce ambiguous duplication of every entry, lab and media file.
"""
from __future__ import annotations

import io
import json
import os
import shutil
import sqlite3
import tarfile
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import IO, Any

from .crypto import derive_key
from .db import DBError, open_db


BUNDLE_FORMAT = "symptom-diary.bundle"
BUNDLE_VERSION = 1

MANIFEST_NAME = "manifest.json"
SALT_NAME = "diary.salt"
DB_NAME = "diary.sqlite"
MEDIA_PREFIX = "media/"


# ---------- export -----------------------------------------------------------


@dataclass
class ExportSummary:
    bytes_written: int
    entries: int
    media_files: int
    schema_version: int


def _checkpoint(conn: sqlite3.Connection) -> None:
    """Force WAL → main DB so the .sqlite file alone is a complete snapshot."""
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except sqlite3.DatabaseError:
        pass


def _gather_stats(conn: sqlite3.Connection) -> tuple[int, int]:
    entries = conn.execute("SELECT COUNT(*) FROM entry").fetchone()[0]
    schema_row = conn.execute("SELECT COALESCE(MAX(version), 0) FROM schema_version").fetchone()
    schema_version = int(schema_row[0])
    return int(entries), schema_version


def export_bundle(
    out: Path | IO[bytes],
    *,
    conn: sqlite3.Connection,
    salt: bytes,
    src_db: Path,
    src_salt: Path,
    src_media: Path | None,
) -> ExportSummary:
    """Write the encrypted bundle tarball.

    The caller owns `conn` (typically the active session); we do not close it.
    `out` may be a path or any binary file-like (for streaming HTTP responses).
    """
    _checkpoint(conn)
    entries, schema_version = _gather_stats(conn)

    media_files: list[Path] = []
    if src_media is not None and src_media.exists():
        for p in sorted(src_media.rglob("*")):
            if p.is_file():
                media_files.append(p)

    manifest: dict[str, Any] = {
        "format": BUNDLE_FORMAT,
        "version": BUNDLE_VERSION,
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "schema_version": schema_version,
        "salt_hex": salt.hex(),
        "stats": {"entries": entries, "media_files": len(media_files)},
    }

    if isinstance(out, Path):
        out.parent.mkdir(parents=True, exist_ok=True)
        fileobj = out.open("wb")
        owns = True
    else:
        fileobj = out
        owns = False

    bytes_written = 0
    try:
        # Use a counting wrapper so streaming exports can report size.
        counter = _CountingWriter(fileobj)
        with tarfile.open(fileobj=counter, mode="w:gz") as tar:
            manifest_bytes = json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8")
            _add_bytes(tar, MANIFEST_NAME, manifest_bytes)

            tar.add(src_salt, arcname=SALT_NAME)
            tar.add(src_db, arcname=DB_NAME)

            if src_media is not None and src_media.exists():
                for p in media_files:
                    rel = p.relative_to(src_media).as_posix()
                    tar.add(p, arcname=f"{MEDIA_PREFIX}{rel}")
        bytes_written = counter.count
    finally:
        if owns:
            fileobj.close()

    return ExportSummary(
        bytes_written=bytes_written,
        entries=entries,
        media_files=len(media_files),
        schema_version=schema_version,
    )


def _add_bytes(tar: tarfile.TarFile, name: str, data: bytes) -> None:
    info = tarfile.TarInfo(name=name)
    info.size = len(data)
    info.mtime = int(datetime.now(timezone.utc).timestamp())
    tar.addfile(info, io.BytesIO(data))


class _CountingWriter:
    """Tiny pass-through that tracks how many bytes the tar layer wrote."""

    def __init__(self, inner: IO[bytes]) -> None:
        self._inner = inner
        self.count = 0

    def write(self, b: bytes) -> int:
        self._inner.write(b)
        self.count += len(b)
        return len(b)

    def flush(self) -> None:
        self._inner.flush()


# ---------- import -----------------------------------------------------------


@dataclass
class ImportSummary:
    entries: int
    media_files: int
    schema_version: int
    salt_hex: str


class BundleError(ValueError):
    """Raised for malformed bundles, version mismatches, or wrong passphrase."""


_ALLOWED_TOP = {MANIFEST_NAME, SALT_NAME, DB_NAME}


def _safe_arc(member: tarfile.TarInfo) -> bool:
    """Reject absolute paths, '..', symlinks/devices, and unknown layout."""
    name = member.name
    if not name or name.startswith("/") or ".." in Path(name).parts:
        return False
    if member.islnk() or member.issym() or member.isdev() or member.isfifo():
        return False
    if name in _ALLOWED_TOP:
        return member.isfile()
    if name.startswith(MEDIA_PREFIX):
        # allow media files and intermediate dirs
        return member.isfile() or member.isdir()
    return False


def import_bundle(
    src: Path | IO[bytes],
    *,
    target_data_dir: Path,
    passphrase: str,
) -> ImportSummary:
    """Extract a bundle into `target_data_dir`. Refuses if data is already there.

    Validates the passphrase by opening the bundled DB before moving anything
    into place — so a wrong passphrase aborts cleanly with no side effects.
    """
    target_data_dir = target_data_dir.expanduser().resolve()
    target_db = target_data_dir / DB_NAME
    target_salt = target_data_dir / SALT_NAME
    target_media = target_data_dir / "media"

    if target_db.exists() or target_salt.exists():
        raise BundleError("target install already has data — refusing to overwrite")

    with tempfile.TemporaryDirectory(prefix="diary-import-") as tmp:
        tmp_path = Path(tmp)
        # tarfile.open accepts both a path string and a fileobj.
        kwargs: dict[str, Any] = {"mode": "r:*"}
        if isinstance(src, Path):
            kwargs["name"] = str(src)
        else:
            kwargs["fileobj"] = src
        with tarfile.open(**kwargs) as tar:
            members = tar.getmembers()
            for m in members:
                if not _safe_arc(m):
                    raise BundleError(f"unsafe path in bundle: {m.name!r}")
            # Python 3.12 data filter is paranoid about ownership; we already
            # validated each member, so use the tarfile.data_filter explicitly.
            try:
                tar.extractall(tmp_path, filter="data")  # type: ignore[arg-type]
            except TypeError:
                # Older Python: fall back to the default extraction.
                tar.extractall(tmp_path)  # noqa: S202 — members are pre-validated

        manifest = _read_manifest(tmp_path)
        salt_file = tmp_path / SALT_NAME
        db_file = tmp_path / DB_NAME
        if not salt_file.exists() or not db_file.exists():
            raise BundleError("bundle missing salt or database")

        salt = salt_file.read_bytes()
        if salt.hex() != manifest["salt_hex"]:
            raise BundleError("salt file does not match manifest")

        key = derive_key(passphrase, salt)
        try:
            test_conn = open_db(key, path=db_file)
        except DBError as e:
            raise BundleError("invalid passphrase for this bundle") from e
        try:
            entries, schema_version = _gather_stats(test_conn)
        finally:
            test_conn.close()

        target_data_dir.mkdir(parents=True, exist_ok=True)

        # Move the validated artefacts into place.
        shutil.move(str(salt_file), target_salt)
        shutil.move(str(db_file), target_db)

        media_src = tmp_path / "media"
        media_count = 0
        if media_src.exists():
            shutil.move(str(media_src), target_media)
            media_count = sum(1 for p in target_media.rglob("*") if p.is_file())

    return ImportSummary(
        entries=entries,
        media_files=media_count,
        schema_version=schema_version,
        salt_hex=salt.hex(),
    )


def _read_manifest(extract_root: Path) -> dict[str, Any]:
    p = extract_root / MANIFEST_NAME
    if not p.exists():
        raise BundleError(f"bundle missing {MANIFEST_NAME}")
    try:
        manifest = json.loads(p.read_text("utf-8"))
    except json.JSONDecodeError as e:
        raise BundleError(f"manifest is not valid JSON: {e}") from e
    if manifest.get("format") != BUNDLE_FORMAT:
        raise BundleError(f"unrecognised bundle format: {manifest.get('format')!r}")
    version = manifest.get("version")
    if version != BUNDLE_VERSION:
        raise BundleError(f"unsupported bundle version: {version!r}")
    if not isinstance(manifest.get("salt_hex"), str):
        raise BundleError("manifest missing salt_hex")
    return manifest


# ---------- helpers ----------------------------------------------------------


def filename_for_export() -> str:
    """`symptom-diary-2026-05-04.diary`."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"symptom-diary-{today}.diary"


__all__ = [
    "BUNDLE_FORMAT",
    "BUNDLE_VERSION",
    "BundleError",
    "ExportSummary",
    "ImportSummary",
    "export_bundle",
    "import_bundle",
    "filename_for_export",
]
