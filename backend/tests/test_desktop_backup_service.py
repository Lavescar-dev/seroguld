from __future__ import annotations

import sqlite3
import zipfile
from pathlib import Path

import pytest

from app.services import desktop_backup_service as service


class _Settings:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.database_url = f"sqlite+aiosqlite:///{(root / 'data' / 'seroguld.db').as_posix()}"

    def backup_root_path(self) -> Path:
        return self.root / "data" / "backups"

    def document_root_path(self) -> Path:
        return self.root / "documents"

    def media_root_path(self) -> Path:
        return self.root / "data" / "uploads"

    def backup_restore_drill_path(self) -> Path:
        return self.root / "data" / "restore-drill"


@pytest.fixture
def backup_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> _Settings:
    settings = _Settings(tmp_path)
    database = tmp_path / "data" / "seroguld.db"
    database.parent.mkdir(parents=True)
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE alembic_version (version_num TEXT NOT NULL)")
        connection.execute("INSERT INTO alembic_version VALUES ('0034_market_rate_confirmation')")
        connection.execute("CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT)")
        connection.execute("INSERT INTO customers(name) VALUES ('Recai')")
        connection.commit()
    (tmp_path / "documents").mkdir()
    (tmp_path / "documents" / "sample.xlsm").write_bytes(b"xlsm-data")
    (tmp_path / "documents" / "working").mkdir()
    (tmp_path / "documents" / "working" / "skip.xlsm").write_bytes(b"temporary")
    (tmp_path / "data" / "uploads").mkdir()
    (tmp_path / "data" / "uploads" / "photo.jpg").write_bytes(b"jpeg-data")
    runtime_env = tmp_path / "config" / "runtime.env"
    runtime_env.parent.mkdir()
    runtime_env.write_text("FIELD_ENCRYPTION_KEY=secret\n", encoding="utf-8")
    monkeypatch.setattr(service, "get_settings", lambda: settings)
    monkeypatch.setattr(service, "ROOT_ENV_FILE", runtime_env)
    return settings


def test_snapshot_uses_online_sqlite_backup_and_verified_manifest(backup_env: _Settings) -> None:
    result = service.create_snapshot(reason="manual", actor="info@seroguld.dk")
    manifest = service.verify_snapshot(result.snapshot_path)

    assert manifest["migration_head"] == "0034_market_rate_confirmation"
    assert manifest["file_count"] == 4
    with zipfile.ZipFile(result.snapshot_path) as archive:
        names = set(archive.namelist())
        assert "database/seroguld.db" in names
        assert "documents/sample.xlsm" in names
        assert "documents/working/skip.xlsm" not in names
        assert "uploads/photo.jpg" in names
        assert "config/runtime.env" in names

    staged = service.stage_restore(result.snapshot_path)
    restored_db = Path(str(staged["restore_path"])) / "database" / "seroguld.db"
    with sqlite3.connect(restored_db) as connection:
        assert connection.execute("SELECT name FROM customers").fetchone() == ("Recai",)
    status = service.backup_status()
    assert status["restore_drill_due"] is False
    assert status["latest_restore_drill_at"] is not None


def test_snapshot_path_cannot_escape_staging(backup_env: _Settings, tmp_path: Path) -> None:
    outside = tmp_path / "outside.zip"
    outside.write_bytes(b"not-a-backup")
    with pytest.raises(service.BackupError, match="staging"):
        service.verify_snapshot(outside)


def test_status_reports_due_then_latest_encrypted_backup(backup_env: _Settings) -> None:
    initial = service.backup_status()
    assert initial["backup_due"] is True
    assert initial["restore_drill_due"] is True
    daily = backup_env.backup_root_path() / "daily"
    daily.mkdir(parents=True)
    (daily / "seroguld-20260813.sgbackup").write_bytes(b"encrypted")
    status = service.backup_status()
    assert status["backup_due"] is False
    assert status["local_backup_count"] == 1
    assert status["latest_local_backup_name"] == "seroguld-20260813.sgbackup"
