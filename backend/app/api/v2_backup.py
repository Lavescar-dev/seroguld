from __future__ import annotations

import logging
import sqlite3
from pathlib import Path
from typing import Callable, TypeVar

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.api.deps import require_admin
from app.models.user import User
from app.services.desktop_backup_service import (
    BackupError,
    backup_status,
    cleanup_staging,
    create_snapshot,
    delete_snapshot,
    stage_restore,
    verify_snapshot,
)


logger = logging.getLogger(__name__)

router = APIRouter()

T = TypeVar("T")


async def _run_backup_operation(
    operation: Callable[..., T], /, *args: object, **kwargs: object
) -> T:
    """Yedek işlemleri için tek hata çeviri noktası.

    BackupError → 422 (iş kuralı: bozuk snapshot, staging dışı yol vb.).
    sqlite3.Error/OSError ise BackupError'a dönüştürülmediği için buraya
    düşer: kilitli/bozuk veritabanı ya da disk/izin hatası global middleware
    yerine 503 ile raporlanır — geçici kaynak çatışması 500/DoS semantiği
    taşımamalı.
    """

    try:
        return await run_in_threadpool(operation, *args, **kwargs)
    except BackupError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except sqlite3.Error as exc:
        logger.warning("Backup işleminde SQLite hatası: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Veritabanı meşgul veya bozuk; yedek işlemi tamamlanamadı. Kısa süre sonra tekrar deneyin.",
        ) from exc
    except OSError as exc:
        logger.warning("Backup işleminde dosya sistemi hatası: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Yedek depolama alanına erişilemedi (disk/izin hatası); işlem tamamlanamadı.",
        ) from exc


class BackupSnapshotIn(BaseModel):
    reason: str = Field(default="manual", max_length=80)


class BackupSnapshotPathIn(BaseModel):
    snapshot_path: str = Field(min_length=1, max_length=1024)


@router.get("/status")
async def get_backup_status(_: User = Depends(require_admin)) -> dict[str, object]:
    return await _run_backup_operation(backup_status)


@router.post("/snapshots")
async def create_backup_snapshot(
    payload: BackupSnapshotIn,
    current_user: User = Depends(require_admin),
) -> dict[str, object]:
    await _run_backup_operation(cleanup_staging)
    result = await _run_backup_operation(
        create_snapshot,
        reason=payload.reason.strip() or "manual",
        actor=current_user.email,
    )
    return {
        "snapshot_path": str(result.snapshot_path),
        "created_at": result.created_at.isoformat(),
        "file_count": result.file_count,
        "total_bytes": result.total_bytes,
        "sha256": result.sha256,
    }


@router.post("/snapshots/verify")
async def verify_backup_snapshot(
    payload: BackupSnapshotPathIn,
    _: User = Depends(require_admin),
) -> dict[str, object]:
    manifest = await _run_backup_operation(verify_snapshot, Path(payload.snapshot_path))
    return {
        "status": "verified",
        "created_at": manifest.get("created_at"),
        "file_count": manifest.get("file_count"),
        "total_bytes": manifest.get("total_bytes"),
        "migration_head": manifest.get("migration_head"),
        # FIELD_ENCRYPTION_KEY yedeğe giremediyse false: UI "yapılandırma yok"
        # etiketiyle bu yedeğin tek başına şifreli alanları kurtaramayacağını gösterir.
        "config_included": manifest.get("config_included"),
    }


@router.delete("/snapshots")
async def discard_backup_snapshot(
    payload: BackupSnapshotPathIn,
    _: User = Depends(require_admin),
) -> dict[str, str]:
    await _run_backup_operation(delete_snapshot, Path(payload.snapshot_path))
    return {"status": "deleted"}


@router.post("/restore/stage")
async def stage_backup_restore(
    payload: BackupSnapshotPathIn,
    _: User = Depends(require_admin),
) -> dict[str, object]:
    return await _run_backup_operation(stage_restore, Path(payload.snapshot_path))
