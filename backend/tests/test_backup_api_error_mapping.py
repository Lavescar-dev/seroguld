"""v2_backup endpoint'lerinin hata eşlemesi: BackupError → 422, geçici
kaynak çatışması (sqlite3.Error/OSError) → ham 500 değil 503."""

from __future__ import annotations

import asyncio
import sqlite3

import pytest
from fastapi import HTTPException

from app.api import v2_backup


def _run(operation, *args, **kwargs):
    return asyncio.run(v2_backup._run_backup_operation(operation, *args, **kwargs))


def test_backup_error_maps_to_422() -> None:
    def failing():
        raise v2_backup.BackupError("Snapshot yolu yedek staging alanının dışında.")

    with pytest.raises(HTTPException) as captured:
        _run(failing)
    assert captured.value.status_code == 422
    assert "staging" in captured.value.detail


def test_sqlite_error_maps_to_503() -> None:
    def locked_database():
        raise sqlite3.OperationalError("database is locked")

    with pytest.raises(HTTPException) as captured:
        _run(locked_database)
    assert captured.value.status_code == 503
    assert "meşgul" in captured.value.detail


def test_oserror_maps_to_503() -> None:
    def disk_full():
        raise OSError(28, "No space left on device")

    with pytest.raises(HTTPException) as captured:
        _run(disk_full)
    assert captured.value.status_code == 503


def test_successful_operation_passes_through() -> None:
    assert _run(lambda a, b: a + b, 2, b=3) == 5
