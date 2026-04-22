from __future__ import annotations

import json

from app.api.dashboard import (
    _find_last_offsite_sync,
    _find_latest_hourly_backup,
    _find_latest_restore_drill,
)


def test_find_latest_hourly_backup_reads_latest_timestamp(tmp_path):
    hourly = tmp_path / "hourly"
    hourly.mkdir(parents=True)
    (hourly / "seroguld-backup-20260227-230000.tar.gz").write_text("a", encoding="utf-8")
    (hourly / "seroguld-backup-20260228-010000.tar.gz").write_text("b", encoding="utf-8")

    latest = _find_latest_hourly_backup(tmp_path)
    assert latest is not None
    assert latest.isoformat().startswith("2026-02-28T01:00:00")


def test_find_last_offsite_sync_parses_status_file(tmp_path):
    status_file = tmp_path / "backup-offsite-last-sync.json"
    status_file.write_text(
        json.dumps(
            {
                "timestamp_utc": "2026-02-28T07:52:00Z",
                "source": "/tmp/source",
                "target": "remote:target",
                "mode": "sync",
            }
        ),
        encoding="utf-8",
    )

    parsed = _find_last_offsite_sync(status_file)
    assert parsed is not None
    assert parsed.isoformat().startswith("2026-02-28T07:52:00")


def test_find_latest_restore_drill_reads_latest_directory(tmp_path):
    (tmp_path / "restore-20260227-120000").mkdir(parents=True)
    (tmp_path / "restore-20260228-080000").mkdir(parents=True)

    latest = _find_latest_restore_drill(tmp_path)
    assert latest is not None
    assert latest.isoformat().startswith("2026-02-28T08:00:00")
