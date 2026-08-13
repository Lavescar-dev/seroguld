from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.database import get_db
from app.models.user import User
from app.schemas.document_artifact import (
    ExcelSessionCloseOut,
    ExcelSessionCreateIn,
    ExcelSessionOut,
    ExcelSessionSyncOut,
)
from app.services.excel_session_service import (
    _session_lock,
    close_excel_session,
    create_excel_session,
    excel_session_status,
    sync_excel_session,
)
from app.services.document_artifact_edit import artifact_mutation_lock


router = APIRouter()


def _bearer_token(request: Request) -> str | None:
    value = request.headers.get("authorization", "")
    if value.lower().startswith("bearer "):
        return value[7:].strip() or None
    return None


@router.post("/excel-sessions", response_model=ExcelSessionOut)
async def post_excel_session_v2(
    payload: ExcelSessionCreateIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ExcelSessionOut:
    return await create_excel_session(db, kind=payload.kind, key=payload.key, admin=admin)


@router.get("/excel-sessions/{session_id}", response_model=ExcelSessionOut)
async def get_excel_session_v2(
    session_id: str,
    request: Request,
) -> ExcelSessionOut:
    async with _session_lock:
        return excel_session_status(session_id, _bearer_token(request))


@router.post("/excel-sessions/{session_id}/sync", response_model=ExcelSessionSyncOut)
async def post_excel_session_sync_v2(
    session_id: str,
    request: Request,
    workbook: UploadFile = File(...),
    base_revision: int | None = Query(default=None, ge=0),
    last_modified_at: datetime | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
) -> ExcelSessionSyncOut:
    if base_revision is None:
        header_revision = request.headers.get("x-sero-base-revision")
        if header_revision is None or not header_revision.isdigit():
            raise HTTPException(status_code=422, detail="base_revision gerekli")
        base_revision = int(header_revision)
    content = await workbook.read()
    # Serialize sync against close/create.  Excel may emit a final save and a
    # close event nearly simultaneously; without this lock close could delete
    # the working copy while the sync is still applying its DB transaction.
    async with _session_lock:
        token = _bearer_token(request)
        # Resolve the session before entering the artifact lock so an invalid
        # token cannot hold a lock for an arbitrary client-supplied key.
        from app.services.excel_session_service import get_excel_session

        entry = get_excel_session(session_id, token)
        async with artifact_mutation_lock(entry.kind, entry.key):
            return await sync_excel_session(
                db,
                session_id=session_id,
                bearer_token=token,
                workbook_bytes=content,
                base_revision=base_revision,
                last_modified_at=last_modified_at,
            )


@router.delete("/excel-sessions/{session_id}", response_model=ExcelSessionCloseOut)
async def delete_excel_session_v2(
    session_id: str,
    request: Request,
    discard: bool = Query(default=False),
) -> ExcelSessionCloseOut:
    async with _session_lock:
        token = _bearer_token(request)
        from app.services.excel_session_service import get_excel_session

        entry = get_excel_session(session_id, token)
        async with artifact_mutation_lock(entry.kind, entry.key):
            return close_excel_session(session_id, token, discard=discard)
