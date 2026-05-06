"""Entry CRUD endpoints with tag bindings."""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..db import transaction
from ..deps import require_mobile_or_unlocked, require_unlocked
from ..extraction import enqueue_job, queue_summary
from ..models import EntryCreate, EntryOut, EntryUpdate, TagOut

router = APIRouter(prefix="/api/entries", tags=["entries"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hydrate(conn: sqlite3.Connection, row: sqlite3.Row) -> EntryOut:
    tag_rows = conn.execute(
        """
        SELECT t.id, t.name, t.color, t.created_at
        FROM tag t
        JOIN entry_tag et ON et.tag_id = t.id
        WHERE et.entry_id = ?
        ORDER BY t.name
        """,
        (row["id"],),
    ).fetchall()
    return EntryOut(
        id=row["id"],
        ts_recorded=row["ts_recorded"],
        ts_event=row["ts_event"],
        text_md=row["text_md"],
        mood=row["mood"],
        severity=row["severity"],
        tags=[TagOut(id=t["id"], name=t["name"], color=t["color"], created_at=t["created_at"]) for t in tag_rows],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _validate_tags(conn: sqlite3.Connection, tag_ids: list[str]) -> None:
    if not tag_ids:
        return
    placeholders = ",".join("?" * len(tag_ids))
    rows = conn.execute(
        f"SELECT id FROM tag WHERE id IN ({placeholders})", tag_ids
    ).fetchall()
    if len(rows) != len(set(tag_ids)):
        raise HTTPException(status_code=400, detail="invalid_tag_id")


def _set_tags(conn: sqlite3.Connection, entry_id: str, tag_ids: list[str]) -> None:
    conn.execute("DELETE FROM entry_tag WHERE entry_id = ?", (entry_id,))
    if not tag_ids:
        return
    conn.executemany(
        "INSERT INTO entry_tag (entry_id, tag_id) VALUES (?, ?)",
        [(entry_id, tag_id) for tag_id in dict.fromkeys(tag_ids)],
    )


@router.get("", response_model=list[EntryOut])
def list_entries(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    tag: Optional[str] = None,
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> list[EntryOut]:
    sql = ["SELECT e.* FROM entry e"]
    params: list[object] = []
    where: list[str] = []
    if tag:
        sql.append("JOIN entry_tag et ON et.entry_id = e.id")
        where.append("et.tag_id = ?")
        params.append(tag)
    if from_:
        where.append("e.ts_event >= ?")
        params.append(from_)
    if to:
        where.append("e.ts_event <= ?")
        params.append(to)
    if where:
        sql.append("WHERE " + " AND ".join(where))
    sql.append("ORDER BY e.ts_event DESC")
    rows = conn.execute(" ".join(sql), params).fetchall()
    return [_hydrate(conn, r) for r in rows]


@router.post("", response_model=EntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(
    body: EntryCreate, conn: sqlite3.Connection = Depends(require_mobile_or_unlocked)
) -> EntryOut:
    _validate_tags(conn, body.tag_ids)
    entry_id = str(uuid.uuid4())
    now = _now()
    with transaction(conn):
        conn.execute(
            """
            INSERT INTO entry
              (id, ts_recorded, ts_event, text_md, mood, severity, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (entry_id, now, body.ts_event, body.text_md, body.mood, body.severity, now, now),
        )
        _set_tags(conn, entry_id, body.tag_ids)
        enqueue_job(conn, entry_id)
    row = conn.execute("SELECT * FROM entry WHERE id = ?", (entry_id,)).fetchone()
    return _hydrate(conn, row)


@router.post("/{entry_id}/reextract", status_code=status.HTTP_202_ACCEPTED)
def reextract_entry(entry_id: str, conn: sqlite3.Connection = Depends(require_unlocked)) -> dict:
    row = conn.execute("SELECT id FROM entry WHERE id = ?", (entry_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not_found")
    enqueue_job(conn, entry_id)
    return {"status": "queued"}


@router.get("/queue/status")
def extraction_queue_status(conn: sqlite3.Connection = Depends(require_unlocked)) -> dict:
    return queue_summary(conn)


@router.post("/queue/retry-failed")
def retry_failed_extraction_jobs(
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> dict:
    """Re-queue every entry whose extraction job failed.

    The "1 failed" badge in the toolbar calls this. Wrapped in `transaction`
    to keep the flip atomic with respect to the extraction worker, which
    otherwise could observe a partial mid-update state.
    """
    with transaction(conn):
        cur = conn.execute(
            "UPDATE extraction_job SET status = 'queued', last_error = NULL, "
            "updated_at = ? WHERE status = 'failed'",
            (_now(),),
        )
        retried = cur.rowcount
    return {"retried": retried}


@router.get("/{entity_entry_id}/entities")
def entry_entities(
    entity_entry_id: str,
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> list[dict]:
    """Entities extracted from a single entry."""
    rows = conn.execute(
        """
        SELECT DISTINCT e.id, e.type, e.canonical_name, m.attrs
        FROM entity_mention m
        JOIN entity e ON e.id = m.entity_id
        WHERE m.entry_id = ?
        ORDER BY e.canonical_name
        """,
        (entity_entry_id,),
    ).fetchall()
    return [
        {
            "id": r["id"],
            "type": r["type"],
            "canonical_name": r["canonical_name"],
            "attrs": r["attrs"],
        }
        for r in rows
    ]


@router.get("/{entry_id}", response_model=EntryOut)
def get_entry(
    entry_id: str, conn: sqlite3.Connection = Depends(require_mobile_or_unlocked)
) -> EntryOut:
    row = conn.execute("SELECT * FROM entry WHERE id = ?", (entry_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not_found")
    return _hydrate(conn, row)


@router.patch("/{entry_id}", response_model=EntryOut)
def update_entry(
    entry_id: str,
    body: EntryUpdate,
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> EntryOut:
    row = conn.execute("SELECT * FROM entry WHERE id = ?", (entry_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not_found")

    fields: dict[str, object] = {}
    if body.ts_event is not None:
        fields["ts_event"] = body.ts_event
    if body.text_md is not None:
        fields["text_md"] = body.text_md
    if body.mood is not None:
        fields["mood"] = body.mood
    if body.severity is not None:
        fields["severity"] = body.severity

    with transaction(conn):
        if fields:
            fields["updated_at"] = _now()
            assigns = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(
                f"UPDATE entry SET {assigns} WHERE id = ?",
                [*fields.values(), entry_id],
            )
        if body.tag_ids is not None:
            _validate_tags(conn, body.tag_ids)
            _set_tags(conn, entry_id, body.tag_ids)

    row = conn.execute("SELECT * FROM entry WHERE id = ?", (entry_id,)).fetchone()
    return _hydrate(conn, row)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(entry_id: str, conn: sqlite3.Connection = Depends(require_unlocked)) -> None:
    cur = conn.execute("DELETE FROM entry WHERE id = ?", (entry_id,))
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="not_found")
