"""Encrypted media storage.

Files are stored under `media_dir()/<entry_id>/<media_id>.enc`. Each file
is encrypted with libsodium's secretstream (XChaCha20-Poly1305) using a
subkey derived from the master key via HKDF (`label = "media-key-v1"`).
That gives us per-process forward secrecy for individual chunks while
keeping the master key the only secret that ever has to be held in RAM.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from PIL import Image, ImageOps

from nacl.bindings import (
    crypto_secretstream_xchacha20poly1305_ABYTES as _ABYTES,
    crypto_secretstream_xchacha20poly1305_HEADERBYTES as _HEADER_BYTES,
    crypto_secretstream_xchacha20poly1305_KEYBYTES as _KEY_BYTES,
    crypto_secretstream_xchacha20poly1305_TAG_FINAL as _TAG_FINAL,
    crypto_secretstream_xchacha20poly1305_TAG_MESSAGE as _TAG_MESSAGE,
    crypto_secretstream_xchacha20poly1305_init_pull,
    crypto_secretstream_xchacha20poly1305_init_push,
    crypto_secretstream_xchacha20poly1305_pull,
    crypto_secretstream_xchacha20poly1305_push,
    crypto_secretstream_xchacha20poly1305_state,
)

from .config import (
    MAX_DOCUMENT_DIMENSION,
    MAX_IMAGE_DIMENSION,
    THUMBNAIL_DIMENSION,
    media_dir,
)
from .crypto import hkdf_subkey

CHUNK_BYTES = 64 * 1024  # 64 KiB per secretstream message
_MEDIA_LABEL = b"media-key-v1"


# ---------- key derivation ----------------------------------------------------


def media_subkey(master_key: bytes) -> bytes:
    """Per-installation media key — same on every unlock with the same passphrase."""
    if len(master_key) < 16:
        raise ValueError("master key too short")
    return hkdf_subkey(master_key, _MEDIA_LABEL, length=_KEY_BYTES)


# ---------- encrypt / decrypt -------------------------------------------------


def encrypt_to_file(plaintext: bytes, dest: Path, *, master_key: bytes) -> int:
    """Stream-encrypt `plaintext` into `dest`. Returns ciphertext size on disk."""
    key = media_subkey(master_key)
    state = crypto_secretstream_xchacha20poly1305_state()
    header = crypto_secretstream_xchacha20poly1305_init_push(state, key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with dest.open("wb") as f:
        f.write(header)
        written += len(header)
        view = memoryview(plaintext)
        offset = 0
        total = len(plaintext)
        while True:
            end = min(offset + CHUNK_BYTES, total)
            chunk = bytes(view[offset:end])
            tag = _TAG_FINAL if end == total else _TAG_MESSAGE
            ct = crypto_secretstream_xchacha20poly1305_push(state, chunk, None, tag)
            f.write(ct)
            written += len(ct)
            if end == total:
                break
            offset = end
    return written


def decrypt_stream(src: Path, *, master_key: bytes) -> Iterator[bytes]:
    """Yield decrypted chunks from a media file, one secretstream message at a time."""
    key = media_subkey(master_key)
    state = crypto_secretstream_xchacha20poly1305_state()
    chunk_ct_size = CHUNK_BYTES + _ABYTES
    with src.open("rb") as f:
        header = f.read(_HEADER_BYTES)
        if len(header) != _HEADER_BYTES:
            raise ValueError("media file truncated (header)")
        crypto_secretstream_xchacha20poly1305_init_pull(state, header, key)
        while True:
            buf = f.read(chunk_ct_size)
            if not buf:
                # Reached EOF without a final tag — truncated.
                raise ValueError("media file truncated (missing final tag)")
            plaintext, tag = crypto_secretstream_xchacha20poly1305_pull(state, buf, None)
            yield plaintext
            if tag == _TAG_FINAL:
                break


def decrypt_all(src: Path, *, master_key: bytes) -> bytes:
    return b"".join(decrypt_stream(src, master_key=master_key))


# ---------- file paths --------------------------------------------------------


def media_file_path(entry_id: str, media_id: str) -> Path:
    return media_dir() / entry_id / f"{media_id}.enc"


def thumb_file_path(entry_id: str, media_id: str) -> Path:
    return media_dir() / entry_id / f"{media_id}.thumb.enc"


def remove_media_files(entry_id: str, media_id: str) -> None:
    for p in (media_file_path(entry_id, media_id), thumb_file_path(entry_id, media_id)):
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass


# ---------- image processing --------------------------------------------------


@dataclass
class PreparedImage:
    data: bytes
    width: int
    height: int
    thumbnail: bytes | None
    mime: str


_ALLOWED_IMAGE_MIME = {"image/jpeg", "image/png", "image/webp", "image/heic"}


def prepare_image(raw: bytes, *, mime: str, document: bool = False) -> PreparedImage:
    """Strip EXIF, auto-orient, resize to a sane cap. Returns JPEG bytes + thumb."""
    cap = MAX_DOCUMENT_DIMENSION if document else MAX_IMAGE_DIMENSION
    img = Image.open(io.BytesIO(raw))
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    if max(img.width, img.height) > cap:
        img.thumbnail((cap, cap), Image.LANCZOS)

    out = io.BytesIO()
    img.save(out, format="JPEG", quality=88, optimize=True, progressive=True)
    body = out.getvalue()

    thumb = img.copy()
    thumb.thumbnail((THUMBNAIL_DIMENSION, THUMBNAIL_DIMENSION), Image.LANCZOS)
    tout = io.BytesIO()
    thumb.save(tout, format="JPEG", quality=78, optimize=True)

    return PreparedImage(
        data=body,
        width=img.width,
        height=img.height,
        thumbnail=tout.getvalue(),
        mime="image/jpeg",
    )


def detect_image_mime(filename: str | None, declared: str | None) -> str:
    """Best-effort MIME guess: trust declared if it looks sane, else extension."""
    if declared and declared.lower() in _ALLOWED_IMAGE_MIME:
        return declared.lower()
    if filename:
        lower = filename.lower()
        if lower.endswith(".jpg") or lower.endswith(".jpeg"):
            return "image/jpeg"
        if lower.endswith(".png"):
            return "image/png"
        if lower.endswith(".webp"):
            return "image/webp"
        if lower.endswith(".heic"):
            return "image/heic"
    return "application/octet-stream"


# ---------- audio bookkeeping (encryption only here; whisper lives in audio.py) -----


def is_audio_mime(mime: str) -> bool:
    return mime.startswith("audio/") or mime in {
        "video/webm",  # MediaRecorder default on Chrome
        "video/ogg",
    }
