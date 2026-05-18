"""SQLCipher connection management + migrations."""
from __future__ import annotations

import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

try:
    import sqlcipher3 as _sqlcipher
    from sqlcipher3.dbapi2 import (
        IntegrityError as _SQLCipherIntegrityError,
        ProgrammingError as _SQLCipherProgrammingError,
        Row as _SQLCipherRow,
    )
except ImportError:  # pragma: no cover
    _sqlcipher = None  # type: ignore[assignment]
    _SQLCipherRow = sqlite3.Row  # type: ignore[assignment]
    _SQLCipherIntegrityError = sqlite3.IntegrityError  # type: ignore[assignment]
    _SQLCipherProgrammingError = sqlite3.ProgrammingError  # type: ignore[assignment]

try:
    import sqlite_vec as _sqlite_vec
except ImportError:  # pragma: no cover
    _sqlite_vec = None  # type: ignore[assignment]


# Re-exported so route handlers don't import sqlcipher3 directly.
IntegrityError = _SQLCipherIntegrityError
ProgrammingError = _SQLCipherProgrammingError

from .config import db_path, migrations_dir
from .crypto import key_to_pragma_hex


_MIGRATION_RE = re.compile(r"^(\d{3})_.*\.sql$")


class DBError(Exception):
    pass


def _connect(path: Path, key: bytes) -> sqlite3.Connection:
    """Open the file and apply the SQLCipher key. Does NOT validate the key."""
    if _sqlcipher is None:
        raise DBError(
            "sqlcipher3 not installed. Install sqlcipher3-binary "
            "(or sqlcipher3 with system libs) to use the encrypted DB."
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    # check_same_thread=False: FastAPI sync endpoints run in a threadpool,
    # while the extraction worker runs on the event-loop thread; they share
    # the single user connection. SessionStore serializes access via its lock.
    conn = _sqlcipher.connect(
        str(path), isolation_level=None, check_same_thread=False
    )
    conn.row_factory = _SQLCipherRow
    # PRAGMA key must be the first statement on the connection.
    conn.execute(f"PRAGMA key = \"{key_to_pragma_hex(key)}\"")
    return conn


def _post_unlock_pragmas(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")


def _load_extensions(conn: sqlite3.Connection) -> None:
    """Load sqlite-vec for the entity_vec virtual table."""
    if _sqlite_vec is None:
        return
    conn.enable_load_extension(True)
    try:
        _sqlite_vec.load(conn)
    finally:
        conn.enable_load_extension(False)


def open_db(key: bytes, *, path: Path | None = None) -> sqlite3.Connection:
    """Open an existing encrypted DB. Raises DBError if the key is wrong."""
    p = path or db_path()
    conn = _connect(p, key)
    try:
        # Force decryption to validate the key. Wrong key → SQLITE_NOTADB.
        conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
        _post_unlock_pragmas(conn)
        _load_extensions(conn)
        _apply_migrations(conn)  # idempotent — applies any new migrations on existing DBs
    except _sqlcipher.DatabaseError as e:
        conn.close()
        raise DBError("invalid passphrase or corrupted database") from e
    return conn


def create_db(key: bytes, *, path: Path | None = None) -> sqlite3.Connection:
    """Create a fresh DB and run all migrations."""
    p = path or db_path()
    if p.exists():
        raise DBError(f"database already exists at {p}")
    conn = _connect(p, key)
    _post_unlock_pragmas(conn)
    _load_extensions(conn)
    _apply_migrations(conn)
    return conn


def _apply_migrations(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version ("
        "  version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now'))"
        ")"
    )
    applied = {row[0] for row in conn.execute("SELECT version FROM schema_version")}

    for sql_file in sorted(migrations_dir().glob("*.sql")):
        m = _MIGRATION_RE.match(sql_file.name)
        if not m:
            continue
        version = int(m.group(1))
        if version in applied:
            continue
        sql = sql_file.read_text(encoding="utf-8")
        conn.executescript(sql)
        conn.execute("INSERT INTO schema_version (version) VALUES (?)", (version,))


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """Explicit BEGIN/COMMIT block (we run with isolation_level=None)."""
    conn.execute("BEGIN")
    try:
        yield conn
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
