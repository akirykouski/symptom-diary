"""Graph endpoint — nodes + edges for force-directed layout."""
from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, Query

from ..deps import require_unlocked

router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.get("")
def get_graph(
    focus: Optional[str] = None,
    depth: int = Query(default=1, ge=1, le=3),
    types: Optional[str] = None,
    min_weight: float = 0.0,
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> dict:
    type_set: list[str] | None = (
        [t.strip() for t in types.split(",") if t.strip()] if types else None
    )

    if focus:
        node_ids = _bfs(conn, focus, depth)
    else:
        # Top-200 most-mentioned entities; type filter is applied below.
        rows = conn.execute(
            """
            SELECT e.id FROM entity e
            ORDER BY (SELECT COUNT(*) FROM entity_mention m WHERE m.entity_id = e.id) DESC
            LIMIT 200
            """
        ).fetchall()
        node_ids = [r["id"] for r in rows]

    if not node_ids:
        return {"nodes": [], "edges": []}

    placeholders = ",".join("?" * len(node_ids))
    nodes = conn.execute(
        f"""
        SELECT e.id, e.type, e.canonical_name,
          (SELECT COUNT(*) FROM entity_mention m WHERE m.entity_id = e.id) AS mention_count
        FROM entity e WHERE e.id IN ({placeholders})
        """,
        node_ids,
    ).fetchall()

    if type_set:
        nodes = [n for n in nodes if n["type"] in type_set]
        node_id_set = {n["id"] for n in nodes}
    else:
        node_id_set = set(node_ids)

    edges = conn.execute(
        f"""
        SELECT id, src_entity_id, dst_entity_id, kind, weight, evidence_count, last_observed_at
        FROM edge
        WHERE src_entity_id IN ({placeholders}) AND dst_entity_id IN ({placeholders})
          AND weight >= ?
        """,
        [*node_ids, *node_ids, min_weight],
    ).fetchall()

    return {
        "nodes": [
            {
                "id": n["id"],
                "type": n["type"],
                "name": n["canonical_name"],
                "mention_count": n["mention_count"],
            }
            for n in nodes
        ],
        "edges": [
            {
                "id": e["id"],
                "source": e["src_entity_id"],
                "target": e["dst_entity_id"],
                "kind": e["kind"],
                "weight": e["weight"],
                "evidence_count": e["evidence_count"],
                "last_observed_at": e["last_observed_at"],
            }
            for e in edges
            if e["src_entity_id"] in node_id_set and e["dst_entity_id"] in node_id_set
        ],
    }


def _bfs(conn: sqlite3.Connection, start: str, depth: int) -> list[str]:
    seen = {start}
    frontier = {start}
    for _ in range(depth):
        if not frontier:
            break
        placeholders = ",".join("?" * len(frontier))
        rows = conn.execute(
            f"""
            SELECT DISTINCT
              CASE WHEN src_entity_id IN ({placeholders}) THEN dst_entity_id ELSE src_entity_id END AS other
            FROM edge
            WHERE src_entity_id IN ({placeholders}) OR dst_entity_id IN ({placeholders})
            """,
            [*frontier, *frontier, *frontier],
        ).fetchall()
        new_ids = {r["other"] for r in rows} - seen
        frontier = new_ids
        seen |= new_ids
    return list(seen)
