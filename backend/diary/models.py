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
