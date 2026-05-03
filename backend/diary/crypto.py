"""Argon2id key derivation for SQLCipher and HKDF for media subkeys."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from pathlib import Path

from argon2.low_level import Type, hash_secret_raw

# Argon2id parameters: t=3, m=64MB, p=4 (per plan).
_TIME_COST = 3
_MEMORY_COST_KIB = 64 * 1024  # 64 MiB
_PARALLELISM = 4
_KEY_LEN = 32
_SALT_LEN = 16


def generate_salt() -> bytes:
    return secrets.token_bytes(_SALT_LEN)


def load_or_create_salt(salt_file: Path) -> bytes:
    if salt_file.exists():
        return salt_file.read_bytes()
    salt = generate_salt()
    salt_file.parent.mkdir(parents=True, exist_ok=True)
    salt_file.write_bytes(salt)
    return salt


def derive_key(passphrase: str, salt: bytes) -> bytes:
    """Argon2id → 32 raw bytes."""
    if not passphrase:
        raise ValueError("passphrase must not be empty")
    return hash_secret_raw(
        secret=passphrase.encode("utf-8"),
        salt=salt,
        time_cost=_TIME_COST,
        memory_cost=_MEMORY_COST_KIB,
        parallelism=_PARALLELISM,
        hash_len=_KEY_LEN,
        type=Type.ID,
    )


def key_to_pragma_hex(key: bytes) -> str:
    """Returns the value to pass to PRAGMA key — a quoted hex blob."""
    return f"x'{key.hex()}'"


def hkdf_subkey(master_key: bytes, label: bytes, length: int = 32) -> bytes:
    """RFC 5869 HKDF-SHA256 with empty salt (master key already has high entropy)."""
    # Extract
    prk = hmac.new(b"\x00" * 32, master_key, hashlib.sha256).digest()
    # Expand
    out = b""
    block = b""
    counter = 1
    while len(out) < length:
        block = hmac.new(prk, block + label + bytes([counter]), hashlib.sha256).digest()
        out += block
        counter += 1
    return out[:length]
