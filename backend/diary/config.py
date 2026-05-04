"""Paths, environment, constants."""
from __future__ import annotations

import os
from pathlib import Path


def data_dir() -> Path:
    """Where encrypted data lives. Override with DIARY_DATA_DIR."""
    override = os.environ.get("DIARY_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    return Path.home() / ".symptom-diary" / "data"


def db_path() -> Path:
    return data_dir() / "diary.sqlite"


def salt_path() -> Path:
    return data_dir() / "diary.salt"


def media_dir() -> Path:
    return data_dir() / "media"


def migrations_dir() -> Path:
    return Path(__file__).parent / "migrations"


# Session inactivity timeout (auto-lock).
SESSION_TIMEOUT_SECONDS = 15 * 60

# CORS origin for the Vite dev server.
DEV_FRONTEND_ORIGIN = "http://localhost:5173"

# Cookie name for the unlock session.
SESSION_COOKIE = "diary_session"

# Ollama integration.
OLLAMA_URL = os.environ.get("DIARY_OLLAMA_URL", "http://127.0.0.1:11434")
# The plan targets Gemma 4 26B A4B (`gemma4:26b-a4b-it-q4_K_M`). If that tag is not yet
# published on Ollama, override DIARY_LLM_MODEL with whatever you can pull (e.g.
# `gemma3:4b` for a small machine, `gemma3:27b-instruct-q4_K_M` for a larger one).
LLM_MODEL = os.environ.get("DIARY_LLM_MODEL", "gemma4:26b-a4b-it-q4_K_M")
EMBED_MODEL = os.environ.get("DIARY_EMBED_MODEL", "nomic-embed-text")
EMBED_DIM = 768

# Vision model for image / document captioning.
VISION_MODEL = os.environ.get("DIARY_VISION_MODEL", LLM_MODEL)

# Whisper.cpp binary (auto-disabled if not on PATH and no override is set).
WHISPER_BIN = os.environ.get("DIARY_WHISPER_BIN", "whisper-cli")
WHISPER_MODEL = os.environ.get("DIARY_WHISPER_MODEL", "")  # path to ggml model

# Image processing limits.
MAX_IMAGE_DIMENSION = 2048
MAX_DOCUMENT_DIMENSION = 3072
THUMBNAIL_DIMENSION = 320

# Hard cap on a single uploaded media file (50 MiB).
MAX_MEDIA_BYTES = 50 * 1024 * 1024

# Canonicalization threshold — cosine similarity above this links to existing entity.
ENTITY_LINK_THRESHOLD = 0.85
# Pairs within ±N hours establish a "precedes" edge.
PRECEDES_WINDOW_HOURS = 2
