"""Encrypted `.diary` bundle export + import."""
from __future__ import annotations

import io
import json
import tarfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from diary import bundle
from diary.config import db_path, media_dir, salt_path


_PASS = "correct horse battery staple"


def _setup(client: TestClient, passphrase: str = _PASS) -> None:
    r = client.post("/api/auth/setup", json={"passphrase": passphrase})
    assert r.status_code == 201


def _seed(client: TestClient) -> None:
    r = client.post("/api/demo/load", json={"persona_id": "anna"})
    assert r.status_code == 200


# ---------- module-level export/import unit tests ----------------------------


def test_export_then_import_roundtrip(client: TestClient, tmp_path: Path) -> None:
    """Round-trip: export current install, blow it away, import into a fresh
    target — verify entries and media survive."""
    _setup(client)
    _seed(client)

    src_db = db_path()
    src_salt = salt_path()
    src_media = media_dir()
    salt = src_salt.read_bytes()

    from diary.session import store as _store

    conn = _store.peek_conn()
    assert conn is not None
    entries_before = conn.execute("SELECT COUNT(*) FROM entry").fetchone()[0]
    assert entries_before > 0

    out = tmp_path / "snapshot.diary"
    summary = bundle.export_bundle(
        out,
        conn=conn,
        salt=salt,
        src_db=src_db,
        src_salt=src_salt,
        src_media=src_media,
    )
    assert out.exists() and out.stat().st_size > 0
    assert summary.entries == entries_before
    assert summary.bytes_written == out.stat().st_size

    # Inspect the tar contents — manifest, salt, db all present.
    with tarfile.open(out, "r:gz") as tar:
        names = tar.getnames()
    assert "manifest.json" in names
    assert "diary.salt" in names
    assert "diary.sqlite" in names

    # Import into a fresh target dir.
    target = tmp_path / "restored"
    imported = bundle.import_bundle(
        out, target_data_dir=target, passphrase=_PASS
    )
    assert imported.entries == entries_before
    assert (target / "diary.salt").read_bytes() == salt
    assert (target / "diary.sqlite").exists()


def test_import_wrong_passphrase_is_rejected(client: TestClient, tmp_path: Path) -> None:
    _setup(client)
    _seed(client)

    from diary.session import store as _store

    conn = _store.peek_conn()
    assert conn is not None

    out = tmp_path / "snapshot.diary"
    bundle.export_bundle(
        out,
        conn=conn,
        salt=salt_path().read_bytes(),
        src_db=db_path(),
        src_salt=salt_path(),
        src_media=media_dir(),
    )

    target = tmp_path / "restored"
    with pytest.raises(bundle.BundleError, match="passphrase"):
        bundle.import_bundle(out, target_data_dir=target, passphrase="not the right one")
    # Nothing should have been moved into the target.
    assert not (target / "diary.sqlite").exists()
    assert not (target / "diary.salt").exists()


def test_import_into_nonempty_target_refused(client: TestClient, tmp_path: Path) -> None:
    _setup(client)

    from diary.session import store as _store

    conn = _store.peek_conn()
    assert conn is not None

    out = tmp_path / "snapshot.diary"
    bundle.export_bundle(
        out,
        conn=conn,
        salt=salt_path().read_bytes(),
        src_db=db_path(),
        src_salt=salt_path(),
        src_media=media_dir(),
    )

    target = tmp_path / "restored"
    target.mkdir()
    (target / "diary.sqlite").write_bytes(b"already here")

    with pytest.raises(bundle.BundleError, match="already"):
        bundle.import_bundle(out, target_data_dir=target, passphrase=_PASS)


def test_import_rejects_path_traversal(tmp_path: Path) -> None:
    """Hand-roll a tar with a path-traversal entry; importer must refuse."""
    bad = tmp_path / "bad.diary"
    with tarfile.open(bad, "w:gz") as tar:
        manifest = json.dumps(
            {
                "format": bundle.BUNDLE_FORMAT,
                "version": bundle.BUNDLE_VERSION,
                "salt_hex": "00" * 16,
            }
        ).encode("utf-8")
        info = tarfile.TarInfo("manifest.json")
        info.size = len(manifest)
        tar.addfile(info, io.BytesIO(manifest))
        bad_info = tarfile.TarInfo("../../etc/passwd")
        bad_info.size = 1
        tar.addfile(bad_info, io.BytesIO(b"x"))

    target = tmp_path / "restored"
    with pytest.raises(bundle.BundleError, match="unsafe path"):
        bundle.import_bundle(bad, target_data_dir=target, passphrase=_PASS)


def test_import_rejects_unknown_format(tmp_path: Path) -> None:
    bad = tmp_path / "wrong.diary"
    with tarfile.open(bad, "w:gz") as tar:
        manifest = json.dumps({"format": "something-else", "version": 1}).encode("utf-8")
        info = tarfile.TarInfo("manifest.json")
        info.size = len(manifest)
        tar.addfile(info, io.BytesIO(manifest))

    target = tmp_path / "restored"
    with pytest.raises(bundle.BundleError, match="format"):
        bundle.import_bundle(bad, target_data_dir=target, passphrase=_PASS)


def test_import_rejects_version_mismatch(tmp_path: Path) -> None:
    bad = tmp_path / "wrong-version.diary"
    with tarfile.open(bad, "w:gz") as tar:
        manifest = json.dumps(
            {"format": bundle.BUNDLE_FORMAT, "version": 999, "salt_hex": "00" * 16}
        ).encode("utf-8")
        info = tarfile.TarInfo("manifest.json")
        info.size = len(manifest)
        tar.addfile(info, io.BytesIO(manifest))

    target = tmp_path / "restored"
    with pytest.raises(bundle.BundleError, match="version"):
        bundle.import_bundle(bad, target_data_dir=target, passphrase=_PASS)


# ---------- HTTP route tests -------------------------------------------------


def test_export_route_requires_unlock(client: TestClient) -> None:
    r = client.get("/api/bundle/export")
    # Not setup at all → require_unlocked returns 401.
    assert r.status_code == 401


def test_export_route_streams_bundle(client: TestClient) -> None:
    _setup(client)
    _seed(client)
    r = client.get("/api/bundle/export")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/x-symptom-diary")
    assert "attachment" in r.headers["content-disposition"]
    body = r.content
    assert len(body) > 100  # gzipped tar is non-trivial

    # The body should be a valid tar.gz with the expected members.
    with tarfile.open(fileobj=io.BytesIO(body), mode="r:gz") as tar:
        names = tar.getnames()
    assert "manifest.json" in names
    assert "diary.salt" in names
    assert "diary.sqlite" in names


def test_import_route_requires_clean_target(client: TestClient) -> None:
    _setup(client)
    # produce a bundle from this install
    bundle_bytes = client.get("/api/bundle/export").content

    files = {"file": ("snap.diary", bundle_bytes, "application/x-symptom-diary")}
    data = {"passphrase": _PASS}
    r = client.post("/api/bundle/import", files=files, data=data)
    assert r.status_code == 409  # already_setup


def test_import_route_into_fresh_install(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Spin up a first install, export a bundle, then spin up a SECOND fresh
    install (different DIARY_DATA_DIR) and POST the bundle into it."""
    import importlib
    from diary import config
    from diary.session import store as _store

    # ---- install A: populate ----
    dir_a = tmp_path / "install-a"
    monkeypatch.setenv("DIARY_DATA_DIR", str(dir_a))
    importlib.reload(config)
    from diary import app as app_mod
    importlib.reload(app_mod)
    _store.lock()
    with TestClient(app_mod.app) as client_a:
        r = client_a.post("/api/auth/setup", json={"passphrase": _PASS})
        assert r.status_code == 201
        assert client_a.post("/api/demo/load", json={"persona_id": "anna"}).status_code == 200
        export_bytes = client_a.get("/api/bundle/export").content
    _store.lock()

    # ---- install B: empty, then import ----
    dir_b = tmp_path / "install-b"
    monkeypatch.setenv("DIARY_DATA_DIR", str(dir_b))
    importlib.reload(config)
    importlib.reload(app_mod)
    _store.lock()
    with TestClient(app_mod.app) as client_b:
        # status reflects fresh install
        s = client_b.get("/api/auth/status").json()
        assert s == {"setup": False, "unlocked": False}

        # wrong passphrase → 401
        r = client_b.post(
            "/api/bundle/import",
            files={"file": ("snap.diary", export_bytes, "application/x-symptom-diary")},
            data={"passphrase": "definitely wrong here"},
        )
        assert r.status_code == 401

        # correct passphrase → 201
        r = client_b.post(
            "/api/bundle/import",
            files={"file": ("snap.diary", export_bytes, "application/x-symptom-diary")},
            data={"passphrase": _PASS},
        )
        assert r.status_code == 201
        body = r.json()
        assert body["entries"] > 0

        # status now reflects an installed-but-locked diary
        s = client_b.get("/api/auth/status").json()
        assert s == {"setup": True, "unlocked": False}

        # original passphrase unlocks it
        r = client_b.post("/api/auth/unlock", json={"passphrase": _PASS})
        assert r.status_code == 200
        # entries are accessible
        entries = client_b.get("/api/entries").json()
        assert len(entries) > 0
    _store.lock()
