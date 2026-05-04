"""Media + documents pipeline tests."""
from __future__ import annotations

import io
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from diary import audio as audio_mod
from diary import media as media_mod
from diary import media_jobs
from diary.config import EMBED_DIM
from diary.session import store


# ---------- helpers -----------------------------------------------------------


class FakeLLM:
    """Fakes generate_text + generate_json + embed for media + extraction tests."""

    def __init__(
        self,
        *,
        caption: str = "Photo shows a small red rash on the left forearm.",
        document_payload: dict[str, Any] | None = None,
        text_entities: dict[str, list[dict]] | None = None,
    ) -> None:
        self.caption = caption
        self.document_payload = document_payload or {}
        self.text_entities = text_entities or {}

    async def generate_text(self, prompt: str, **_: Any) -> str:
        return self.caption

    async def generate_json(self, prompt: str, **kwargs: Any) -> dict:
        # Decide based on whether images were passed (= document call) vs not.
        if "images" in kwargs and kwargs.get("images"):
            return self.document_payload
        # Text-mode extraction call.
        for key, entities in self.text_entities.items():
            if key in prompt.lower():
                return {"entities": entities}
        return {"entities": []}

    async def embed(self, text: str, **_: Any) -> list[float]:
        seed = sum(ord(c) for c in text)
        vec = [0.0] * EMBED_DIM
        for i, ch in enumerate(text):
            vec[(seed + i) % EMBED_DIM] += 1.0 + (ord(ch) % 7) * 0.05
        norm = sum(v * v for v in vec) ** 0.5 or 1.0
        return [v / norm for v in vec]


def _setup(client: TestClient) -> None:
    r = client.post("/api/auth/setup", json={"passphrase": "correct horse battery staple"})
    assert r.status_code == 201


def _create_entry(client: TestClient) -> str:
    r = client.post(
        "/api/entries",
        json={"ts_event": "2026-05-03T08:00:00+00:00", "text_md": "Saw a rash today.", "tag_ids": []},
    )
    assert r.status_code == 201
    return r.json()["id"]


def _make_jpeg(color: tuple[int, int, int] = (200, 50, 50), size: tuple[int, int] = (320, 240)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="JPEG")
    return buf.getvalue()


# ---------- tests -------------------------------------------------------------


def test_media_subkey_changes_with_master_key() -> None:
    a = media_mod.media_subkey(b"\x11" * 32)
    b = media_mod.media_subkey(b"\x22" * 32)
    assert a != b
    assert len(a) == 32


def test_image_upload_and_fetch_roundtrip(client: TestClient) -> None:
    _setup(client)
    entry_id = _create_entry(client)
    img = _make_jpeg()
    r = client.post(
        f"/api/entries/{entry_id}/media",
        files={"file": ("test.jpg", img, "image/jpeg")},
        data={"kind": "image"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["kind"] == "image"
    assert body["mime"] == "image/jpeg"
    assert body["status"] == "pending"
    media_id = body["id"]

    r = client.get(f"/api/media/{media_id}")
    assert r.status_code == 200
    # Re-encoded by Pillow but still a valid JPEG.
    assert r.content[:3] == b"\xff\xd8\xff"

    r = client.get(f"/api/media/{media_id}/thumbnail")
    assert r.status_code == 200
    assert r.content[:3] == b"\xff\xd8\xff"


def test_oversize_image_is_resized_below_cap(client: TestClient) -> None:
    _setup(client)
    entry_id = _create_entry(client)
    big = _make_jpeg(size=(4096, 3000))
    r = client.post(
        f"/api/entries/{entry_id}/media",
        files={"file": ("big.jpg", big, "image/jpeg")},
        data={"kind": "image"},
    )
    assert r.status_code == 201
    body = r.json()
    assert max(body["width"], body["height"]) <= 2048


def test_delete_media_removes_file(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _setup(client)
    entry_id = _create_entry(client)
    img = _make_jpeg()
    r = client.post(
        f"/api/entries/{entry_id}/media",
        files={"file": ("d.jpg", img, "image/jpeg")},
        data={"kind": "image"},
    )
    media_id = r.json()["id"]
    storage = media_mod.media_file_path(entry_id, media_id)
    assert storage.exists()
    r = client.delete(f"/api/media/{media_id}")
    assert r.status_code == 204
    assert not storage.exists()


@pytest.mark.asyncio
async def test_image_pipeline_writes_caption_and_appends_to_entry(client: TestClient) -> None:
    _setup(client)
    entry_id = _create_entry(client)
    img = _make_jpeg()
    r = client.post(
        f"/api/entries/{entry_id}/media",
        files={"file": ("rash.jpg", img, "image/jpeg")},
        data={"kind": "image"},
    )
    media_id = r.json()["id"]

    fake = FakeLLM(caption="A red rash on forearm.")
    conn = store.peek_conn()
    assert conn is not None
    did = await media_jobs.process_one(conn, llm=fake)  # type: ignore[arg-type]
    assert did is True

    r = client.get(f"/api/entries/{entry_id}/media")
    body = r.json()[0]
    assert body["status"] == "done"
    assert body["description"] == "A red rash on forearm."

    entry = client.get(f"/api/entries/{entry_id}").json()
    assert "[photo] A red rash on forearm." in entry["text_md"]


@pytest.mark.asyncio
async def test_document_pipeline_creates_lab_values_and_medications(client: TestClient) -> None:
    _setup(client)
    entry_id = _create_entry(client)
    img = _make_jpeg()
    r = client.post(
        f"/api/entries/{entry_id}/media",
        files={"file": ("lab.jpg", img, "image/jpeg")},
        data={"kind": "document"},
    )
    media_id = r.json()["id"]

    fake = FakeLLM(document_payload={
        "doc_type": "lab_result",
        "doc_date": "2026-04-12",
        "clinician_name": "Dr. Rossi",
        "clinician_specialty": "Endocrinology",
        "facility": "City Lab",
        "language_detected": "en",
        "findings_md": "TSH elevated; recommend recheck in 6 weeks.",
        "recommendations_md": "Recheck TSH and FT4 in 6 weeks.",
        "lab_values": [
            {"test_name_raw": "TSH", "value_numeric": 6.8, "unit": "mIU/L",
             "reference_low": 0.4, "reference_high": 4.0, "measured_at": "2026-04-12"},
            {"test_name_raw": "Free T4", "value_numeric": 1.0, "unit": "ng/dL",
             "reference_low": 0.8, "reference_high": 1.8, "measured_at": "2026-04-12"},
        ],
        "medications": [
            {"drug_name_raw": "Levothyroxine 50 mcg", "dose": "50 mcg",
             "frequency": "once daily", "duration": "ongoing"},
        ],
        "icd_codes": ["E03.9"],
        "extraction_confidence": "high",
        "fields_that_were_unclear": [],
    })
    conn = store.peek_conn()
    assert conn is not None
    did = await media_jobs.process_one(conn, llm=fake)  # type: ignore[arg-type]
    assert did is True

    docs = client.get("/api/documents").json()
    assert len(docs) == 1
    doc = docs[0]
    assert doc["doc_type"] == "lab_result"
    assert doc["clinician_name"] == "Dr. Rossi"
    assert len(doc["lab_values"]) == 2
    assert len(doc["medications"]) == 1
    tsh = next(l for l in doc["lab_values"] if l["test_name"] == "tsh")
    assert tsh["is_abnormal"] == 1  # high
    ft4 = next(l for l in doc["lab_values"] if l["test_name"] == "ft4")
    assert ft4["is_abnormal"] == 0  # in range

    series = client.get("/api/labs/timeline?test=tsh").json()
    assert series["test_name"] == "tsh"
    assert len(series["points"]) == 1
    assert series["points"][0]["value_numeric"] == 6.8

    meds = client.get("/api/medications/timeline").json()
    assert any(m["drug_name"].startswith("levothyroxine") for m in meds)


@pytest.mark.asyncio
async def test_audio_pipeline_skips_when_whisper_unavailable(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _setup(client)
    entry_id = _create_entry(client)
    fake_audio = b"RIFF\x00\x00\x00\x00WAVEfake audio bytes"
    r = client.post(
        f"/api/entries/{entry_id}/media",
        files={"file": ("note.wav", fake_audio, "audio/wav")},
        data={"kind": "audio"},
    )
    assert r.status_code == 201
    media_id = r.json()["id"]

    monkeypatch.setattr(audio_mod, "transcribe", lambda *_a, **_kw: None)

    fake = FakeLLM()
    conn = store.peek_conn()
    assert conn is not None
    did = await media_jobs.process_one(conn, llm=fake)  # type: ignore[arg-type]
    assert did is True

    r = client.get(f"/api/entries/{entry_id}/media")
    body = r.json()[0]
    assert body["status"] == "done"
    assert body["transcript"] is None


@pytest.mark.asyncio
async def test_audio_pipeline_appends_transcript_when_available(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _setup(client)
    entry_id = _create_entry(client)
    fake_audio = b"RIFF\x00\x00\x00\x00WAVEfake audio bytes"
    r = client.post(
        f"/api/entries/{entry_id}/media",
        files={"file": ("note.wav", fake_audio, "audio/wav")},
        data={"kind": "audio"},
    )
    media_id = r.json()["id"]

    monkeypatch.setattr(
        audio_mod, "transcribe", lambda *_a, **_kw: "I felt dizzy this morning."
    )
    fake = FakeLLM()
    conn = store.peek_conn()
    assert conn is not None
    await media_jobs.process_one(conn, llm=fake)  # type: ignore[arg-type]

    body = client.get(f"/api/entries/{entry_id}/media").json()[0]
    assert body["transcript"] == "I felt dizzy this morning."
    entry = client.get(f"/api/entries/{entry_id}").json()
    assert "[audio transcript] I felt dizzy this morning." in entry["text_md"]
