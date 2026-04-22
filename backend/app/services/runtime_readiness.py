from __future__ import annotations

import os
import tempfile
from pathlib import Path

from sqlalchemy import text

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.schemas.runtime import RuntimeReadinessCheckOut, RuntimeReadinessOut
from app.services.dashboard_helpers import (
    age_hours,
    age_minutes,
    find_last_offsite_sync,
    find_latest_hourly_backup,
    find_latest_restore_drill,
)
from app.services.office_host_service import office_host_service
from app.utils.helpers import utc_now


def _probe_writable_directory(path: Path) -> RuntimeReadinessCheckOut:
    try:
        path.mkdir(parents=True, exist_ok=True)
        fd, probe_path = tempfile.mkstemp(prefix=".readiness-", dir=path)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write("ok")
        os.unlink(probe_path)
        return RuntimeReadinessCheckOut(name=path.name or str(path), ok=True, detail=str(path))
    except Exception as exc:  # pragma: no cover - exercised by integration/runtime
        return RuntimeReadinessCheckOut(name=path.name or str(path), ok=False, detail=f"{path}: {exc}")


async def collect_runtime_readiness() -> RuntimeReadinessOut:
    settings = get_settings()
    checks: list[RuntimeReadinessCheckOut] = []
    now = utc_now()

    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        checks.append(RuntimeReadinessCheckOut(name="database", ok=True, detail="SELECT 1"))
    except Exception as exc:
        checks.append(RuntimeReadinessCheckOut(name="database", ok=False, detail=str(exc)))

    checks.append(_probe_writable_directory(settings.media_root_path()))
    checks.append(_probe_writable_directory(settings.document_root_path()))
    checks.append(_probe_writable_directory(settings.backup_root_path()))
    checks.append(_probe_writable_directory(settings.backup_restore_drill_path()))

    latest_backup = find_latest_hourly_backup(settings.backup_root_path())
    backup_age = age_minutes(now, latest_backup)
    checks.append(
        RuntimeReadinessCheckOut(
            name="backup_freshness",
            ok=bool(backup_age is not None and backup_age <= settings.backup_health_max_age_minutes),
            detail="missing"
            if backup_age is None
            else f"{backup_age} min ago (limit {settings.backup_health_max_age_minutes})",
        )
    )

    latest_restore_drill = find_latest_restore_drill(settings.backup_restore_drill_path())
    restore_age = age_hours(now, latest_restore_drill)
    checks.append(
        RuntimeReadinessCheckOut(
            name="restore_drill",
            ok=bool(restore_age is not None and restore_age <= settings.backup_restore_drill_max_age_hours),
            detail="missing"
            if restore_age is None
            else f"{restore_age} h ago (limit {settings.backup_restore_drill_max_age_hours})",
        )
    )

    if settings.backup_offsite_enabled:
        last_offsite = find_last_offsite_sync(settings.backup_offsite_status_path())
        offsite_age = age_minutes(now, last_offsite)
        checks.append(
            RuntimeReadinessCheckOut(
                name="offsite_sync",
                ok=bool(offsite_age is not None and offsite_age <= settings.backup_offsite_max_age_minutes),
                detail="missing"
                if offsite_age is None
                else f"{offsite_age} min ago (limit {settings.backup_offsite_max_age_minutes})",
            )
        )
    else:
        checks.append(RuntimeReadinessCheckOut(name="offsite_sync", ok=True, detail="disabled"))

    for kind, name in (
        ("alis-workspace", "office_afg"),
        ("depolama", "office_depolama"),
        ("log", "office_log"),
    ):
        try:
            status = await office_host_service.runtime_status(kind)
            checks.append(
                RuntimeReadinessCheckOut(
                    name=name,
                    ok=status.runtime_available,
                    detail=status.reason or f"{status.provider_label} @ {status.runtime_url}",
                )
            )
        except Exception as exc:  # pragma: no cover - exercised by integration/runtime
            checks.append(RuntimeReadinessCheckOut(name=name, ok=False, detail=str(exc)))

    return RuntimeReadinessOut(
        app_name=settings.app_name,
        env=settings.env,
        checked_at=now,
        ready=all(item.ok for item in checks),
        checks=checks,
    )
