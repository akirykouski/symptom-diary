"""Entity CRUD + merge."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from ..db import transaction
from ..deps import require_unlocked

router = APIRouter(prefix="/api/entities", tags=["entities"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_entity(row: sqlite3.Row, *, mention_count: int | None = None) -> dict:
    return {
        "id": row["id"],
        "type": row["type"],
        "canonical_name": row["canonical_name"],
        "aliases": json.loads(row["aliases"]),
        "mention_count": mention_count,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


@router.get("")
def list_entities(
    type: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = Query(default=200, le=1000),
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> list[dict]:
    sql = [
        "SELECT e.id, e.type, e.canonical_name, e.aliases, e.created_at, e.updated_at,",
        "  (SELECT COUNT(*) FROM entity_mention m WHERE m.entity_id = e.id) AS mention_count",
        "FROM entity e",
    ]
    params: list[object] = []
    where: list[str] = []
    if type:
        where.append("e.type = ?")
        params.append(type)
    if q:
        where.append("(LOWER(e.canonical_name) LIKE ? OR LOWER(e.aliases) LIKE ?)")
        params.append(f"%{q.lower()}%")
        params.append(f"%{q.lower()}%")
    if where:
        sql.append("WHERE " + " AND ".join(where))
    sql.append("ORDER BY mention_count DESC, e.canonical_name LIMIT ?")
    params.append(limit)
    rows = conn.execute(" ".join(sql), params).fetchall()
    return [
        _row_to_entity(r, mention_count=r["mention_count"]) for r in rows
    ]


@router.get("/{entity_id}")
def get_entity(entity_id: str, conn: sqlite3.Connection = Depends(require_unlocked)) -> dict:
    row = conn.execute(
        "SELECT id, type, canonical_name, aliases, created_at, updated_at FROM entity WHERE id = ?",
        (entity_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not_found")

    mentions = conn.execute(
        """
        SELECT m.id, m.entry_id, m.attrs, e.ts_event, SUBSTR(e.text_md, 1, 240) AS snippet
        FROM entity_mention m
        JOIN entry e ON e.id = m.entry_id
        WHERE m.entity_id = ?
        ORDER BY e.ts_event DESC
        LIMIT 50
        """,
        (entity_id,),
    ).fetchall()

    neighbors = conn.execute(
        """
        SELECT
          CASE WHEN edge.src_entity_id = ? THEN edge.dst_entity_id ELSE edge.src_entity_id END AS other_id,
          edge.kind, edge.weight, edge.evidence_count
        FROM edge
        WHERE edge.src_entity_id = ? OR edge.dst_entity_id = ?
        ORDER BY edge.weight DESC LIMIT 50
        """,
        (entity_id, entity_id, entity_id),
    ).fetchall()

    out = _row_to_entity(row, mention_count=len(mentions))
    out["recent_mentions"] = [
        {
            "id": m["id"],
            "entry_id": m["entry_id"],
            "ts_event": m["ts_event"],
            "snippet": m["snippet"],
            "attrs": json.loads(m["attrs"]) if m["attrs"] else {},
        }
        for m in mentions
    ]
    other_ids = [n["other_id"] for n in neighbors]
    if other_ids:
        placeholders = ",".join("?" * len(other_ids))
        names = {
            r["id"]: r["canonical_name"]
            for r in conn.execute(
                f"SELECT id, canonical_name FROM entity WHERE id IN ({placeholders})",
                other_ids,
            ).fetchall()
        }
    else:
        names = {}
    out["neighbors"] = [
        {
            "id": n["other_id"],
            "name": names.get(n["other_id"], "?"),
            "kind": n["kind"],
            "weight": n["weight"],
            "evidence_count": n["evidence_count"],
        }
        for n in neighbors
    ]
    return out


class EntityPatch(BaseModel):
    canonical_name: Optional[str] = None
    type: Optional[str] = None


@router.patch("/{entity_id}")
def patch_entity(
    entity_id: str,
    body: EntityPatch,
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> dict:
    row = conn.execute("SELECT id FROM entity WHERE id = ?", (entity_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not_found")
    fields: dict[str, object] = {}
    if body.canonical_name is not None:
        fields["canonical_name"] = body.canonical_name.strip().lower()
    if body.type is not None:
        from ..extraction import ENTITY_TYPES
        if body.type not in ENTITY_TYPES:
            raise HTTPException(status_code=400, detail="invalid_type")
        fields["type"] = body.type
    if not fields:
        return get_entity(entity_id, conn)
    fields["updated_at"] = _now()
    assigns = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(
        f"UPDATE entity SET {assigns} WHERE id = ?",
        [*fields.values(), entity_id],
    )
    return get_entity(entity_id, conn)


class EntityMerge(BaseModel):
    target_id: str


@router.post("/{entity_id}/merge")
def merge_entity(
    entity_id: str,
    body: EntityMerge,
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> dict:
    """Move all mentions and edges from `entity_id` into `body.target_id`, then delete src."""
    if entity_id == body.target_id:
        raise HTTPException(status_code=400, detail="same_entity")
    src = conn.execute("SELECT id, aliases FROM entity WHERE id = ?", (entity_id,)).fetchone()
    dst = conn.execute("SELECT id, aliases FROM entity WHERE id = ?", (body.target_id,)).fetchone()
    if src is None or dst is None:
        raise HTTPException(status_code=404, detail="not_found")

    with transaction(conn):
        conn.execute(
            "UPDATE entity_mention SET entity_id = ? WHERE entity_id = ?",
            (body.target_id, entity_id),
        )
        # Re-point edges, then collapse duplicates by summing weights.
        conn.execute(
            "UPDATE edge SET src_entity_id = ? WHERE src_entity_id = ?",
            (body.target_id, entity_id),
        )
        conn.execute(
            "UPDATE edge SET dst_entity_id = ? WHERE dst_entity_id = ?",
            (body.target_id, entity_id),
        )
        # Drop self-loops created by the merge.
        conn.execute("DELETE FROM edge WHERE src_entity_id = dst_entity_id")
        # Collapse duplicates: for each (src,dst,kind) keep one and sum the others.
        dups = conn.execute(
            """
            SELECT src_entity_id, dst_entity_id, kind, COUNT(*) AS n,
                   SUM(weight) AS w, SUM(evidence_count) AS ec,
                   MAX(last_observed_at) AS lo
            FROM edge GROUP BY src_entity_id, dst_entity_id, kind HAVING n > 1
            """
        ).fetchall()
        for d in dups:
            conn.execute(
                "DELETE FROM edge WHERE src_entity_id = ? AND dst_entity_id = ? AND kind = ?",
                (d["src_entity_id"], d["dst_entity_id"], d["kind"]),
            )
            conn.execute(
                "INSERT INTO edge (id, src_entity_id, dst_entity_id, kind, weight, evidence_count, last_observed_at) "
                "VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?)",
                (
                    d["src_entity_id"],
                    d["dst_entity_id"],
                    d["kind"],
                    float(d["w"]),
                    int(d["ec"]),
                    d["lo"],
                ),
            )

        merged_aliases = sorted(set(json.loads(src["aliases"])) | set(json.loads(dst["aliases"])))
        conn.execute(
            "UPDATE entity SET aliases = ?, updated_at = ? WHERE id = ?",
            (json.dumps(merged_aliases), _now(), body.target_id),
        )
        conn.execute("DELETE FROM entity_vec WHERE entity_id = ?", (entity_id,))
        conn.execute("DELETE FROM entity WHERE id = ?", (entity_id,))
    return get_entity(body.target_id, conn)


@router.delete("/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entity(entity_id: str, conn: sqlite3.Connection = Depends(require_unlocked)) -> None:
    with transaction(conn):
        conn.execute("DELETE FROM entity_vec WHERE entity_id = ?", (entity_id,))
        cur = conn.execute("DELETE FROM entity WHERE id = ?", (entity_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="not_found")
