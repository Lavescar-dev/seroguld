from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.database import get_db
from app.models.legacy_migration import LegacyMigrationRecord
from app.models.user import User
from app.services.legacy_migration_service import (
    PHASES,
    apply_phase,
    create_run,
    get_run,
    list_records,
    run_analysis_job,
    serialize_run,
    store_file,
)


router = APIRouter(prefix="/legacy-migrations", tags=["legacy-migrations"])


class MigrationRunCreate(BaseModel):
    log_year: int = Field(default_factory=lambda: datetime.now().year, ge=1990, le=2100)


class ConflictResolution(BaseModel):
    action: str = Field(pattern="^(skip|keep_existing|retry)$")
    note: str | None = Field(default=None, max_length=500)


def _phase(value: str) -> str:
    if value not in PHASES:
        raise HTTPException(status_code=422, detail="Geçersiz taşıma adımı.")
    return value


@router.post("/runs")
async def post_migration_run(
    payload: MigrationRunCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    run = await create_run(db, admin, log_year=payload.log_year)
    await db.commit()
    return await serialize_run(db, run)


@router.get("/runs/{run_id}")
async def get_migration_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    return await serialize_run(db, await get_run(db, run_id))


@router.post("/runs/{run_id}/{phase}/files")
async def post_migration_files(
    run_id: uuid.UUID,
    phase: str,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    run = await get_run(db, run_id)
    resolved_phase = _phase(phase)
    if len(files) > 500:
        raise HTTPException(status_code=422, detail="Tek yüklemede en fazla 500 dosya seçilebilir.")
    for upload in files:
        content = await upload.read()
        if not content:
            raise HTTPException(status_code=422, detail=f"Boş dosya: {upload.filename}")
        if len(content) > 50 * 1024 * 1024:
            raise HTTPException(status_code=413, detail=f"Dosya 50 MB sınırını aşıyor: {upload.filename}")
        await store_file(db, run=run, phase=resolved_phase, file_name=upload.filename or "upload.xlsx", content=content)
    await db.commit()
    return await serialize_run(db, run)


@router.post("/runs/{run_id}/{phase}/analyze", status_code=202)
async def post_migration_analyze(
    run_id: uuid.UUID,
    phase: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    run = await get_run(db, run_id)
    resolved_phase = _phase(phase)
    if resolved_phase != run.current_phase:
        raise HTTPException(status_code=409, detail=f"Önce {run.current_phase} adımı tamamlanmalı.")
    if run.status == "analyzing":
        raise HTTPException(status_code=409, detail="Bir analiz işi zaten çalışıyor.")
    run.status = "analyzing"
    await db.commit()
    background_tasks.add_task(run_analysis_job, run.id, resolved_phase)
    return await serialize_run(db, run)


@router.get("/runs/{run_id}/{phase}/records")
async def get_migration_records(
    run_id: uuid.UUID,
    phase: str,
    offset: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    await get_run(db, run_id)
    return await list_records(db, run_id, _phase(phase), offset=max(0, offset), limit=max(1, min(limit, 500)))


@router.patch("/runs/{run_id}/conflicts/{record_id}")
async def patch_migration_conflict(
    run_id: uuid.UUID,
    record_id: uuid.UUID,
    payload: ConflictResolution,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    await get_run(db, run_id)
    record = await db.get(LegacyMigrationRecord, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Taşıma kaydı bulunamadı.")
    record.resolution_json = payload.model_dump(mode="json")
    if payload.action in {"skip", "keep_existing"}:
        record.status = "skipped"
    else:
        record.status = "blocked"
    await db.commit()
    return {"id": str(record.id), "status": record.status, "resolution": record.resolution_json}


@router.post("/runs/{run_id}/{phase}/apply")
async def post_migration_apply(
    run_id: uuid.UUID,
    phase: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    run = await get_run(db, run_id)
    try:
        await apply_phase(db, run, _phase(phase), admin)
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await serialize_run(db, run)
