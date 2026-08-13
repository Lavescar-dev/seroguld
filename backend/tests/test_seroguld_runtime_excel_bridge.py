from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from seroguld_runtime import _excel_last_modified_at, _sync_excel_workbook


def test_excel_bridge_sends_iso8601_utc_mtime_for_fastapi_datetime_form(monkeypatch, tmp_path: Path) -> None:
    workbook_path = tmp_path / "Depolama.xlsx"
    workbook_path.write_bytes(b"managed workbook")
    captured: dict[str, object] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"status": "applied", "revision": 4}

    def fake_post(url, *, headers, params, data, files, timeout):
        captured.update({"url": url, "headers": headers, "params": params, "data": data})
        return FakeResponse()

    import httpx

    monkeypatch.setattr(httpx, "post", fake_post)
    config = {
        "sync_url": "http://127.0.0.1:8100/api/v2/excel-sessions/session-1/sync",
        "session_token": "token",
        "base_revision": 3,
    }

    result = _sync_excel_workbook(config, workbook_path)

    submitted = str(captured["data"]["last_modified_at"])
    parsed = datetime.fromisoformat(submitted)
    assert parsed.tzinfo == timezone.utc
    assert parsed == datetime.fromisoformat(_excel_last_modified_at(workbook_path))
    assert len(submitted) > 20
    assert str(int(workbook_path.stat().st_mtime_ns // 1_000_000)) != submitted
    assert result["status"] == "applied"
    assert config["base_revision"] == 4
