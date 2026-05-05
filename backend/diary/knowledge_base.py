"""Disease knowledge-base ingestion + lookup helpers.

The bundled seed (`diary/data/diseases_seed.json`) is a curated, citable
subset of common + rare conditions used to bootstrap the Hypothesis Engine
in the demo. A future `POST /api/kb/sync` should replace this with the
full Orphanet XML dump while keeping the same `disease_profile` /
`disease_feature` shape.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import struct
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import EMBED_DIM
from .llm import OllamaClient, OllamaError

logger = logging.getLogger("diary.kb")

SEED_PATH = Path(__file__).parent / "data" / "diseases_seed.json"

FREQUENCY_WEIGHT = {
    "obligate": 1.0,
    "very_frequent": 0.7,
    "frequent": 0.4,
    "occasional": 0.2,
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _pack(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def _unpack(buf: bytes) -> list[float]:
    n = len(buf) // 4
    return list(struct.unpack(f"{n}f", buf))


def _zero_vec() -> list[float]:
    return [0.0] * EMBED_DIM


def load_seed() -> dict[str, Any]:
    return json.loads(SEED_PATH.read_text(encoding="utf-8"))


# ---------- ingest ------------------------------------------------------------


def kb_status(conn: sqlite3.Connection) -> dict[str, Any]:
    diseases = conn.execute("SELECT COUNT(*) AS n FROM disease_profile").fetchone()["n"]
    features = conn.execute("SELECT COUNT(*) AS n FROM disease_feature").fetchone()["n"]
    embedded = conn.execute(
        "SELECT COUNT(*) AS n FROM disease_feature WHERE embedding IS NOT NULL"
    ).fetchone()["n"]
    last = conn.execute(
        "SELECT MAX(last_synced_at) AS ts FROM disease_profile"
    ).fetchone()["ts"]
    return {
        "disease_count": diseases,
        "feature_count": features,
        "embedded_feature_count": embedded,
        "last_synced_at": last,
        "seed_version": load_seed().get("version"),
    }


async def ingest_seed(
    conn: sqlite3.Connection,
    *,
    llm: OllamaClient | None = None,
    embed: bool = True,
) -> dict[str, int]:
    """Insert (or refresh) disease_profile / disease_feature rows from the seed.

    If `embed=False` or `llm` is None / offline, features are stored without
    embeddings; matching falls back to keyword overlap until a future re-sync.
    """
    seed = load_seed()
    diseases = seed.get("diseases", [])
    inserted_d = 0
    inserted_f = 0
    embed_failures = 0
    now = _now()

    # Insert diseases + features in one transaction (no embeddings yet).
    conn.execute("BEGIN")
    try:
        for d in diseases:
            existing = conn.execute(
                "SELECT id FROM disease_profile WHERE id = ?", (d["id"],)
            ).fetchone()
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO disease_profile
                      (id, source, name, synonyms, prevalence_class, inheritance,
                       age_of_onset, description_md, source_url, category, red_flag,
                       last_synced_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        d["id"],
                        "seed",
                        d["name"],
                        json.dumps(d.get("synonyms", []), ensure_ascii=False),
                        d.get("prevalence_class"),
                        d.get("inheritance"),
                        d.get("age_of_onset"),
                        d["description_md"],
                        d["source_url"],
                        d.get("category"),
                        int(d.get("red_flag", 0)),
                        now,
                    ),
                )
                inserted_d += 1
            else:
                conn.execute(
                    "UPDATE disease_profile SET last_synced_at = ? WHERE id = ?",
                    (now, d["id"]),
                )

            # Reset features for this disease so we converge on the seed exactly.
            conn.execute(
                "DELETE FROM disease_feature_vec WHERE feature_id IN "
                "(SELECT id FROM disease_feature WHERE disease_id = ?)",
                (d["id"],),
            )
            conn.execute("DELETE FROM disease_feature WHERE disease_id = ?", (d["id"],))
            for f in d.get("features", []):
                fid = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO disease_feature
                      (id, disease_id, feature_name, feature_kind, frequency_class, hpo_id, embedding)
                    VALUES (?, ?, ?, ?, ?, ?, NULL)
                    """,
                    (
                        fid,
                        d["id"],
                        f["name"],
                        f["kind"],
                        f["frequency"],
                        f.get("hpo_id"),
                    ),
                )
                inserted_f += 1
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise

    if not embed or llm is None:
        return {
            "inserted_diseases": inserted_d,
            "inserted_features": inserted_f,
            "embedded_features": 0,
            "embed_failures": embed_failures,
        }

    # Embedding pass: outside the txn so a long Ollama call doesn't hold a write lock.
    rows = conn.execute(
        "SELECT id, feature_name FROM disease_feature WHERE embedding IS NULL"
    ).fetchall()
    embedded = 0
    for row in rows:
        try:
            vec = await llm.embed(row["feature_name"])
        except OllamaError as e:
            embed_failures += 1
            logger.warning("kb embed failed for %s: %s", row["feature_name"], e)
            # If Ollama is fully offline, bail out — let the user re-sync later.
            if "unreachable" in str(e).lower():
                break
            continue
        conn.execute(
            "UPDATE disease_feature SET embedding = ? WHERE id = ?",
            (_pack(vec), row["id"]),
        )
        # Replace any prior vec0 row.
        conn.execute("DELETE FROM disease_feature_vec WHERE feature_id = ?", (row["id"],))
        conn.execute(
            "INSERT INTO disease_feature_vec (feature_id, embedding) VALUES (?, ?)",
            (row["id"], _pack(vec)),
        )
        embedded += 1
        # Yield so other tasks (e.g. a UI poll) can run.
        if embedded % 10 == 0:
            await asyncio.sleep(0)
    return {
        "inserted_diseases": inserted_d,
        "inserted_features": inserted_f,
        "embedded_features": embedded,
        "embed_failures": embed_failures,
    }


# ---------- lookup ------------------------------------------------------------


def all_features(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT f.id, f.disease_id, f.feature_name, f.feature_kind,
               f.frequency_class, f.embedding,
               d.name AS disease_name, d.category, d.red_flag
        FROM disease_feature f
        JOIN disease_profile d ON d.id = f.disease_id
        """
    ).fetchall()
    out: list[dict] = []
    for r in rows:
        emb = _unpack(r["embedding"]) if r["embedding"] else None
        out.append({
            "id": r["id"],
            "disease_id": r["disease_id"],
            "disease_name": r["disease_name"],
            "category": r["category"],
            "red_flag": r["red_flag"],
            "feature_name": r["feature_name"],
            "feature_kind": r["feature_kind"],
            "frequency_class": r["frequency_class"],
            "frequency_weight": FREQUENCY_WEIGHT.get(r["frequency_class"], 0.2),
            "embedding": emb,
        })
    return out


def disease(conn: sqlite3.Connection, disease_id: str) -> dict | None:
    r = conn.execute(
        "SELECT * FROM disease_profile WHERE id = ?", (disease_id,)
    ).fetchone()
    return dict(r) if r is not None else None
