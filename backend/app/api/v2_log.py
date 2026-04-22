from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.afg import (
    apply_afg_route_requests,
    build_log_workspace,
    create_afg_melt_lot,
    post_afg_lines_route as legacy_post_afg_lines_route,
    update_afg_melt_lot,
)
from app.api.deps import require_admin
from app.api.pos import get_pos_documents as get_legacy_pos_documents
from app.api.v2 import _apply_log_workbook_artifact_inputs, _default_artifact_year, _ensure_log_artifact
from app.api.v2_support import artifact_file_response
from app.database import get_db
from app.models.transaction_line import TransactionLine
from app.models.user import User
from app.schemas.afg import (
    AfgLogWorkspaceOut,
    AfgMeltLotCreateRequest,
    AfgMeltLotOut,
    AfgMeltLotUpdateRequest,
    AfgRouteBatchApplyRequest,
    AfgRouteRequest,
    AfgRouteResponse,
)
from app.schemas.document_artifact import DocumentArtifactRecordOut
from app.schemas.pos import PosDocumentListItemOut
from app.services.document_artifact_service import list_artifact_records, sync_log_workbook_artifact

router = APIRouter()


@router.get("/log/recent", response_model=list[PosDocumentListItemOut])
async def get_log_recent_v2(
    q: str | None = None,
    kind: str | None = "afregningsbilag",
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
    clerk_user: User = Depends(require_admin),
) -> list[PosDocumentListItemOut]:
    return await get_legacy_pos_documents(
        q=q,
        kind=kind,
        limit=limit,
        db=db,
        _=clerk_user,
    )


@router.get("/log/workspace", response_model=AfgLogWorkspaceOut)
async def get_log_workspace_v2(
    q: str | None = None,
    limit: int = 200,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> AfgLogWorkspaceOut:
    workspace = await build_log_workspace(db, q=q, limit=limit)
    if not q:
        await _ensure_log_artifact(
            db,
            workspace,
            year=_default_artifact_year(None),
            create_snapshot=False,
            force_sync=False,
        )
    return workspace


@router.post("/log/lines/route", response_model=AfgRouteResponse)
async def post_log_lines_route_v2(
    payload: AfgRouteRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> AfgRouteResponse:
    response = await legacy_post_afg_lines_route(payload=payload, db=db, admin=admin)
    workspace = await build_log_workspace(db, q=None, limit=200)
    await _ensure_log_artifact(
        db,
        workspace,
        year=_default_artifact_year(None),
        create_snapshot=True,
        force_sync=True,
    )
    return response


@router.post("/log/routes/batch-apply", response_model=AfgLogWorkspaceOut)
async def post_log_routes_batch_apply_v2(
    payload: AfgRouteBatchApplyRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> AfgLogWorkspaceOut:
    line_ids = [decision.line_id for decision in payload.line_decisions]
    if len(set(line_ids)) != len(line_ids):
        raise HTTPException(status_code=400, detail="Aynı satır birden fazla kez gönderilemez")

    existing_line_ids = set(
        (
            await db.execute(
                select(TransactionLine.id).where(TransactionLine.id.in_(line_ids))
            )
        ).scalars()
    )
    missing_line_ids = [str(line_id) for line_id in line_ids if line_id not in existing_line_ids]
    if missing_line_ids:
        raise HTTPException(
            status_code=404,
            detail=f"Bir veya daha fazla log satırı bulunamadı: {', '.join(missing_line_ids)}",
        )

    route_requests = [
        AfgRouteRequest(
            line_ids=[decision.line_id],
            destination=decision.destination,
            classification=decision.classification,
            note=(decision.note.strip() if decision.note else None),
        )
        for decision in payload.line_decisions
    ]
    await apply_afg_route_requests(
        db=db,
        route_requests=route_requests,
        actor_id=admin.id,
    )

    workspace = await build_log_workspace(db, q=None, limit=200)
    await _ensure_log_artifact(
        db,
        workspace,
        year=_default_artifact_year(None),
        create_snapshot=True,
        force_sync=True,
    )
    return workspace


@router.post("/log/melt-lots", response_model=AfgMeltLotOut)
async def post_log_melt_lot_v2(
    payload: AfgMeltLotCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> AfgMeltLotOut:
    lot = await create_afg_melt_lot(db, payload=payload)
    workspace = await build_log_workspace(db, q=None, limit=200)
    await _ensure_log_artifact(
        db,
        workspace,
        year=_default_artifact_year(None),
        create_snapshot=True,
        force_sync=True,
    )
    return lot


@router.put("/log/melt-lots/{lot_id}", response_model=AfgMeltLotOut)
async def put_log_melt_lot_v2(
    lot_id: UUID,
    payload: AfgMeltLotUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> AfgMeltLotOut:
    lot = await update_afg_melt_lot(db, lot_id=lot_id, payload=payload)
    workspace = await build_log_workspace(db, q=None, limit=200)
    await _ensure_log_artifact(
        db,
        workspace,
        year=_default_artifact_year(None),
        create_snapshot=True,
        force_sync=True,
    )
    return lot


@router.get("/log/workbook")
async def get_log_workbook_v2(
    year: int | None = Query(default=None, ge=2000, le=2100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    resolved_year = _default_artifact_year(year)
    workspace = await build_log_workspace(db, q=None, limit=200)
    bundle = await sync_log_workbook_artifact(db, workspace, year=resolved_year, create_snapshot=False)
    await db.commit()
    return artifact_file_response(bundle.artifact, content=bundle.content)


@router.post("/log/workbook/import", response_model=AfgLogWorkspaceOut)
async def post_log_workbook_import_v2(
    year: int | None = Query(default=None, ge=2000, le=2100),
    workbook: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> AfgLogWorkspaceOut:
    content = await workbook.read()
    workspace = await _apply_log_workbook_artifact_inputs(
        db,
        year=_default_artifact_year(year),
        workbook_bytes=content,
        create_snapshot=True,
    )
    await db.commit()
    return workspace


@router.get("/log/workbook/snapshots", response_model=list[DocumentArtifactRecordOut])
async def get_log_workbook_snapshots_v2(
    year: int | None = Query(default=None, ge=2000, le=2100),
    limit: int = Query(default=20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[DocumentArtifactRecordOut]:
    return await list_artifact_records(
        db,
        module_name="log",
        document_type="log_workbook",
        business_key=str(_default_artifact_year(year)),
        version_kind="snapshot",
        limit=limit,
    )
