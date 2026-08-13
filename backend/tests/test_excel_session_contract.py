from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.services import excel_session_service as excel
from app.utils.helpers import utc_now


def _entry(tmp_path: Path) -> excel.ExcelSession:
    working_dir = tmp_path / "session"
    working_dir.mkdir()
    path = working_dir / "Depolama.xlsx"
    path.write_bytes(b"accepted")
    entry = excel.ExcelSession(
        session_id="session-1",
        bearer_token="token-1",
        kind="depolama",
        key="live",
        artifact_key="depolama.live",
        file_name=path.name,
        working_path=path,
        created_at=utc_now(),
        expires_at=utc_now() + timedelta(minutes=5),
        revision=3,
    )
    excel._remember_working_fingerprint(entry)
    return entry


def test_close_preserves_unsynced_excel_copy_until_explicit_discard(monkeypatch, tmp_path: Path) -> None:
    entry = _entry(tmp_path)
    monkeypatch.setattr(excel, "_active_session", entry)
    entry.working_path.write_bytes(b"unsynced edit")

    with pytest.raises(HTTPException) as raised:
        excel.close_excel_session(entry.session_id, entry.bearer_token)

    assert raised.value.status_code == 409
    assert entry.working_path.read_bytes() == b"unsynced edit"
    assert excel._active_session is entry

    result = excel.close_excel_session(entry.session_id, entry.bearer_token, discard=True)
    assert result.session_id == entry.session_id
    assert excel._active_session is None
    assert not entry.working_path.parent.exists()


def test_expired_session_preserves_changed_copy_for_recovery(monkeypatch, tmp_path: Path) -> None:
    entry = _entry(tmp_path)
    entry.expires_at = utc_now() - timedelta(seconds=1)
    entry.working_path.write_bytes(b"bridge wrote before callback")
    monkeypatch.setattr(excel, "_active_session", entry)
    (tmp_path / "working").mkdir()
    monkeypatch.setattr(excel, "_working_root", lambda: tmp_path / "working")

    excel._expire_if_needed()

    assert excel._active_session is None
    recovery = list((tmp_path / "working").glob("recovery-session-1-*"))
    assert recovery
    assert (recovery[0] / entry.working_path.name).read_bytes() == b"bridge wrote before callback"
