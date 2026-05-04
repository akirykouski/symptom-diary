"""Pydantic schemas — request/response models."""
from __future__ import annotations

from typing import Annotated, Optional

from pydantic import BaseModel, Field, StringConstraints


Passphrase = Annotated[str, StringConstraints(min_length=8, max_length=512)]
TagName = Annotated[str, StringConstraints(min_length=1, max_length=64, strip_whitespace=True)]
HexColor = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]


class AuthStatus(BaseModel):
    setup: bool
    unlocked: bool


class SetupRequest(BaseModel):
    passphrase: Passphrase


class UnlockRequest(BaseModel):
    passphrase: Passphrase


class TagCreate(BaseModel):
    name: TagName
    color: Optional[HexColor] = None


class TagOut(BaseModel):
    id: str
    name: str
    color: Optional[str] = None
    created_at: str


class EntryBase(BaseModel):
    ts_event: str = Field(..., description="ISO8601 timestamp of the event")
    text_md: str = Field(..., min_length=1, max_length=100_000)
    mood: Optional[int] = Field(None, ge=-2, le=2)
    severity: Optional[int] = Field(None, ge=0, le=10)
    tag_ids: list[str] = Field(default_factory=list)


class EntryCreate(EntryBase):
    pass


class EntryUpdate(BaseModel):
    ts_event: Optional[str] = None
    text_md: Optional[str] = Field(None, min_length=1, max_length=100_000)
    mood: Optional[int] = Field(None, ge=-2, le=2)
    severity: Optional[int] = Field(None, ge=0, le=10)
    tag_ids: Optional[list[str]] = None


class EntryOut(BaseModel):
    id: str
    ts_recorded: str
    ts_event: str
    text_md: str
    mood: Optional[int] = None
    severity: Optional[int] = None
    tags: list[TagOut]
    created_at: str
    updated_at: str


class MediaOut(BaseModel):
    id: str
    entry_id: str
    kind: str
    mime: str
    bytes: int
    duration_ms: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None
    description: Optional[str] = None
    transcript: Optional[str] = None
    status: str
    last_error: Optional[str] = None
    processed_at: Optional[str] = None
    created_at: str


class LabValueOut(BaseModel):
    id: str
    test_name: str
    test_name_raw: str
    value_numeric: Optional[float] = None
    value_text: Optional[str] = None
    unit: Optional[str] = None
    reference_low: Optional[float] = None
    reference_high: Optional[float] = None
    is_abnormal: Optional[int] = None
    measured_at: Optional[str] = None


class MedicationOut(BaseModel):
    id: str
    drug_name: str
    drug_name_raw: str
    dose: Optional[str] = None
    frequency: Optional[str] = None
    duration: Optional[str] = None
    prescribed_at: Optional[str] = None


class DocumentOut(BaseModel):
    id: str
    media_id: str
    entry_id: str
    doc_type: str
    doc_date: Optional[str] = None
    clinician_name: Optional[str] = None
    clinician_specialty: Optional[str] = None
    facility: Optional[str] = None
    language_detected: Optional[str] = None
    findings_md: Optional[str] = None
    recommendations_md: Optional[str] = None
    user_verified: int
    lab_values: list[LabValueOut] = Field(default_factory=list)
    medications: list[MedicationOut] = Field(default_factory=list)
    created_at: str
    updated_at: str


class DocumentPatch(BaseModel):
    doc_type: Optional[str] = None
    doc_date: Optional[str] = None
    clinician_name: Optional[str] = None
    clinician_specialty: Optional[str] = None
    facility: Optional[str] = None
    findings_md: Optional[str] = None
    recommendations_md: Optional[str] = None
    user_verified: Optional[int] = Field(None, ge=0, le=1)


class LabPoint(BaseModel):
    measured_at: Optional[str] = None
    value_numeric: Optional[float] = None
    value_text: Optional[str] = None
    unit: Optional[str] = None
    is_abnormal: Optional[int] = None
    reference_low: Optional[float] = None
    reference_high: Optional[float] = None
    document_id: str


class LabSeries(BaseModel):
    test_name: str
    points: list[LabPoint]
