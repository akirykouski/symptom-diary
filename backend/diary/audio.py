"""whisper.cpp wrapper for audio transcription.

We invoke the `whisper-cli` binary as a subprocess. If it is not on PATH (or
no model file is configured), `transcribe()` returns `None` and the caller
treats the audio as un-transcribed — uploads still go through; the user can
edit the entry text by hand.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

from .config import WHISPER_BIN, WHISPER_MODEL

logger = logging.getLogger("diary.audio")


def whisper_available() -> bool:
    if shutil.which(WHISPER_BIN) is None:
        return False
    if not WHISPER_MODEL:
        return False
    return Path(WHISPER_MODEL).exists()


def transcribe(audio_bytes: bytes, *, suffix: str = ".bin") -> str | None:
    """Run whisper-cli and return transcript text. None if unavailable / fails."""
    if not whisper_available():
        return None
    with tempfile.TemporaryDirectory() as td:
        in_path = Path(td) / f"in{suffix}"
        in_path.write_bytes(audio_bytes)
        out_prefix = Path(td) / "out"
        cmd = [
            WHISPER_BIN,
            "-m", WHISPER_MODEL,
            "-f", str(in_path),
            "-otxt",
            "-of", str(out_prefix),
            "-nt",  # no timestamps
        ]
        try:
            proc = subprocess.run(
                cmd, check=False, capture_output=True, timeout=600
            )
        except (FileNotFoundError, subprocess.TimeoutExpired) as e:
            logger.warning("whisper invocation failed: %s", e)
            return None
        if proc.returncode != 0:
            logger.warning(
                "whisper-cli exited %d: %s",
                proc.returncode,
                proc.stderr[-2000:].decode("utf-8", errors="replace"),
            )
            return None
        out_txt = out_prefix.with_suffix(out_prefix.suffix + ".txt") if out_prefix.suffix else Path(str(out_prefix) + ".txt")
        if not out_txt.exists():
            return None
        return out_txt.read_text(encoding="utf-8", errors="replace").strip()
