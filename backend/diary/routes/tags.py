"""Tag CRUD endpoints."""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from ..db import IntegrityError
from ..deps import require_unlocked
from ..models import TagCreate, TagOut

router = APIRouter(prefix="/api/tags", tags=["tags"])


def _row_to_tag(row: sqlite3.Row) -> TagOut:
    return TagOut(
        id=row["id"],
        name=row["name"],
        color=row["color"],
        created_at=row["created_at"],
    )


@router.get("", response_model=list[TagOut])
def list_tags(conn: sqlite3.Connection = Depends(require_unlocked)) -> list[TagOut]:
    rows = conn.execute("SELECT id, name, color, created_at FROM tag ORDER BY name").fetchall()
    return [_row_to_tag(r) for r in rows]


@router.post("", response_model=TagOut, status_code=status.HTTP_201_CREATED)
def create_tag(body: TagCreate, conn: sqlite3.Connection = Depends(require_unlocked)) -> TagOut:
    tag_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    try:
        conn.execute(
            "INSERT INTO tag (id, name, color, created_at) VALUES (?, ?, ?, ?)",
            (tag_id, body.name, body.color, now),
        )
    except IntegrityError as e:
        raise HTTPException(status_code=409, detail="tag_name_taken") from e
    row = conn.execute(
        "SELECT id, name, color, created_at FROM tag WHERE id = ?", (tag_id,)
    ).fetchone()
    return _row_to_tag(row)


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(tag_id: str, conn: sqlite3.Connection = Depends(require_unlocked)) -> None:
    cur = conn.execute("DELETE FROM tag WHERE id = ?", (tag_id,))
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="not_found")
