from __future__ import annotations

from pathlib import Path

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


router = APIRouter()


class BackupSnapshotIn(BaseModel):
    reason: str = Field(default="manual", max_length=80)


class BackupSnapshotPathIn(BaseModel):
    snapshot_path: str = Field(min_length=1, max_length=1024)


@router.get("/status")
async def get_backup_status(_: User = Depends(require_admin)) -> dict[str, object]:
    return await run_in_threadpool(backup_status)


@router.post("/snapshots")
async def create_backup_snapshot(
    payload: BackupSnapshotIn,
    current_user: User = Depends(require_admin),
) -> dict[str, object]:
    try:
        await run_in_threadpool(cleanup_staging)
        result = await run_in_threadpool(
            create_snapshot,
            reason=payload.reason.strip() or "manual",
            actor=current_user.email,
        )
    except BackupError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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
    try:
        manifest = await run_in_threadpool(verify_snapshot, Path(payload.snapshot_path))
    except BackupError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "status": "verified",
        "created_at": manifest.get("created_at"),
        "file_count": manifest.get("file_count"),
        "total_bytes": manifest.get("total_bytes"),
        "migration_head": manifest.get("migration_head"),
    }


@router.delete("/snapshots")
async def discard_backup_snapshot(
    payload: BackupSnapshotPathIn,
    _: User = Depends(require_admin),
) -> dict[str, str]:
    try:
        await run_in_threadpool(delete_snapshot, Path(payload.snapshot_path))
    except BackupError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"status": "deleted"}


@router.post("/restore/stage")
async def stage_backup_restore(
    payload: BackupSnapshotPathIn,
    _: User = Depends(require_admin),
) -> dict[str, object]:
    try:
        return await run_in_threadpool(stage_restore, Path(payload.snapshot_path))
    except BackupError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
