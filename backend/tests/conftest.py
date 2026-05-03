"""Test fixtures: isolated data dir per test, fresh app + client."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Iterator

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("DIARY_DATA_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def client(data_dir: Path) -> Iterator[TestClient]:
    # data_dir sets DIARY_DATA_DIR. Reload config so it picks up the env change.
    import importlib

    from diary import config

    importlib.reload(config)
    from diary import app as app_mod

    importlib.reload(app_mod)

    # Make sure no prior test left the store unlocked.
    from diary.session import store

    store.lock()

    with TestClient(app_mod.app) as c:
        yield c

    store.lock()
