"""Document records, lab values, medication timeline."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..deps import require_unlocked
from ..models import (
    DocumentOut,
    DocumentPatch,
    LabPoint,
    LabSeries,
    LabValueOut,
    MedicationOut,
)

router = APIRouter(tags=["documents"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hydrate(conn: sqlite3.Connection, doc_row: sqlite3.Row) -> DocumentOut:
    media_row = conn.execute(
        "SELECT entry_id FROM media WHERE id = ?", (doc_row["media_id"],)
    ).fetchone()
    entry_id = media_row["entry_id"] if media_row is not None else ""
    labs = conn.execute(
        "SELECT id, test_name, test_name_raw, value_numeric, value_text, unit, "
        "reference_low, reference_high, is_abnormal, measured_at "
        "FROM lab_value WHERE document_record_id = ?",
        (doc_row["id"],),
    ).fetchall()
    meds = conn.execute(
        "SELECT id, drug_name, drug_name_raw, dose, frequency, duration, prescribed_at "
        "FROM medication_record WHERE document_record_id = ?",
        (doc_row["id"],),
    ).fetchall()
    return DocumentOut(
        id=doc_row["id"],
        media_id=doc_row["media_id"],
        entry_id=entry_id,
        doc_type=doc_row["doc_type"],
        doc_date=doc_row["doc_date"],
        clinician_name=doc_row["clinician_name"],
        clinician_specialty=doc_row["clinician_specialty"],
        facility=doc_row["facility"],
        language_detected=doc_row["language_detected"],
        findings_md=doc_row["findings_md"],
        recommendations_md=doc_row["recommendations_md"],
        user_verified=int(doc_row["user_verified"] or 0),
        lab_values=[LabValueOut(**dict(r)) for r in labs],
        medications=[MedicationOut(**dict(r)) for r in meds],
        created_at=doc_row["created_at"],
        updated_at=doc_row["updated_at"],
    )


@router.get("/api/documents", response_model=list[DocumentOut])
def list_documents(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    type: Optional[str] = None,
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> list[DocumentOut]:
    sql = ["SELECT * FROM document_record WHERE 1=1"]
    params: list[object] = []
    if from_:
        sql.append("AND (doc_date >= ? OR doc_date IS NULL)")
        params.append(from_)
    if to:
        sql.append("AND (doc_date <= ? OR doc_date IS NULL)")
        params.append(to)
    if type:
        sql.append("AND doc_type = ?")
        params.append(type)
    sql.append("ORDER BY COALESCE(doc_date, created_at) DESC")
    rows = conn.execute(" ".join(sql), params).fetchall()
    return [_hydrate(conn, r) for r in rows]


@router.get("/api/documents/{doc_id}", response_model=DocumentOut)
def get_document(doc_id: str, conn: sqlite3.Connection = Depends(require_unlocked)) -> DocumentOut:
    row = conn.execute("SELECT * FROM document_record WHERE id = ?", (doc_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not_found")
    return _hydrate(conn, row)


@router.patch("/api/documents/{doc_id}", response_model=DocumentOut)
def patch_document(
    doc_id: str,
    body: DocumentPatch,
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> DocumentOut:
    row = conn.execute("SELECT id FROM document_record WHERE id = ?", (doc_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not_found")
    fields: dict[str, object] = {}
    for k in (
        "doc_type", "doc_date", "clinician_name", "clinician_specialty",
        "facility", "findings_md", "recommendations_md", "user_verified",
    ):
        v = getattr(body, k, None)
        if v is not None:
            fields[k] = v
    if not fields:
        full = conn.execute("SELECT * FROM document_record WHERE id = ?", (doc_id,)).fetchone()
        return _hydrate(conn, full)
    fields["updated_at"] = _now()
    assigns = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(
        f"UPDATE document_record SET {assigns} WHERE id = ?",
        [*fields.values(), doc_id],
    )
    full = conn.execute("SELECT * FROM document_record WHERE id = ?", (doc_id,)).fetchone()
    return _hydrate(conn, full)


@router.get("/api/labs/timeline", response_model=LabSeries)
def labs_timeline(
    test: str = Query(..., min_length=1),
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> LabSeries:
    sql = [
        "SELECT lv.measured_at, lv.value_numeric, lv.value_text, lv.unit, "
        "lv.is_abnormal, lv.reference_low, lv.reference_high, lv.document_record_id "
        "FROM lab_value lv WHERE lv.test_name = ?"
    ]
    params: list[object] = [test]
    if from_:
        sql.append("AND (lv.measured_at >= ? OR lv.measured_at IS NULL)")
        params.append(from_)
    if to:
        sql.append("AND (lv.measured_at <= ? OR lv.measured_at IS NULL)")
        params.append(to)
    sql.append("ORDER BY lv.measured_at ASC NULLS LAST")
    # SQLite doesn't accept "ORDER BY ... NULLS LAST"; use COALESCE trick instead.
    final_sql = " ".join(sql).replace("ASC NULLS LAST", "ASC")
    rows = conn.execute(final_sql, params).fetchall()
    points = [
        LabPoint(
            measured_at=r["measured_at"],
            value_numeric=r["value_numeric"],
            value_text=r["value_text"],
            unit=r["unit"],
            is_abnormal=r["is_abnormal"],
            reference_low=r["reference_low"],
            reference_high=r["reference_high"],
            document_id=r["document_record_id"],
        )
        for r in rows
    ]
    return LabSeries(test_name=test, points=points)


@router.get("/api/labs/tests")
def labs_tests(conn: sqlite3.Connection = Depends(require_unlocked)) -> list[dict]:
    rows = conn.execute(
        "SELECT test_name, COUNT(*) AS n FROM lab_value GROUP BY test_name "
        "ORDER BY n DESC, test_name ASC"
    ).fetchall()
    return [{"test_name": r["test_name"], "count": r["n"]} for r in rows]


@router.get("/api/medications/timeline", response_model=list[MedicationOut])
def medications_timeline(
    conn: sqlite3.Connection = Depends(require_unlocked),
) -> list[MedicationOut]:
    rows = conn.execute(
        "SELECT id, drug_name, drug_name_raw, dose, frequency, duration, prescribed_at "
        "FROM medication_record "
        "ORDER BY COALESCE(prescribed_at, '') DESC, drug_name ASC"
    ).fetchall()
    return [MedicationOut(**dict(r)) for r in rows]
