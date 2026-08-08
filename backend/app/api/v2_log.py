from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.afg import (
    apply_afg_route_requests_safe,
    build_log_workspace,
    create_afg_melt_lot,
    delete_afg_melt_lot,
    finalize_afg_melt_lot,
    list_afg_melt_lot_history,
    list_afg_melt_lot_lines,
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
    AfgMeltLotHistoryOut,
    AfgMeltLotLineOut,
    AfgMeltLotOut,
    AfgMeltLotUpdateRequest,
    AfgRouteBatchApplyRequest,
    AfgRouteBatchApplyResponse,
    AfgRouteBatchPartialFailure,
    AfgRouteRequest,
    AfgRouteResponse,
)
from app.schemas.document_artifact import DocumentArtifactReconcilePreviewOut, DocumentArtifactRecordOut
from app.schemas.pos import PosDocumentListItemOut
from app.services.document_artifact_log import build_log_reconcile_preview
from app.services.document_artifact_service import (
    get_artifact_record,
    list_artifact_records,
    parse_log_workbook_inputs_from_workbook,
    resolve_artifact_conflict_state,
    sync_log_workbook_artifact,
)

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
    year: int | None = Query(default=None, ge=2000, le=2100),
    limit: int = 200,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> AfgLogWorkspaceOut:
    workspace = await build_log_workspace(db, q=q, year=year, limit=limit)
    if not q and year is None:
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


@router.post("/log/routes/batch-apply", response_model=AfgRouteBatchApplyResponse)
async def post_log_routes_batch_apply_v2(
    payload: AfgRouteBatchApplyRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> AfgRouteBatchApplyResponse:
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
    response, failures = await apply_afg_route_requests_safe(
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
    return AfgRouteBatchApplyResponse(
        workspace=workspace,
        succeeded=len(response.processed_line_ids),
        failed=len(failures),
        failures=[
            AfgRouteBatchPartialFailure(line_id=lid, error=err)
            for lid, err in failures
        ],
    )


@router.post("/log/melt-lots", response_model=AfgMeltLotOut)
async def post_log_melt_lot_v2(
    payload: AfgMeltLotCreateRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> AfgMeltLotOut:
    lot = await create_afg_melt_lot(db, payload=payload, actor=admin)
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
    admin: User = Depends(require_admin),
) -> AfgMeltLotOut:
    lot = await update_afg_melt_lot(db, lot_id=lot_id, payload=payload, actor=admin)
    workspace = await build_log_workspace(db, q=None, limit=200)
    await _ensure_log_artifact(
        db,
        workspace,
        year=_default_artifact_year(None),
        create_snapshot=True,
        force_sync=True,
    )
    return lot


@router.post("/log/melt-lots/{lot_id}/finalize", response_model=AfgMeltLotOut)
async def post_log_melt_lot_finalize_v2(
    lot_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> AfgMeltLotOut:
    lot = await finalize_afg_melt_lot(db, lot_id=lot_id, actor=admin, reverse=False)
    workspace = await build_log_workspace(db, q=None, limit=200)
    await _ensure_log_artifact(
        db,
        workspace,
        year=_default_artifact_year(None),
        create_snapshot=True,
        force_sync=True,
    )
    return lot


@router.post("/log/melt-lots/{lot_id}/reopen", response_model=AfgMeltLotOut)
async def post_log_melt_lot_reopen_v2(
    lot_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> AfgMeltLotOut:
    return await finalize_afg_melt_lot(db, lot_id=lot_id, actor=admin, reverse=True)


@router.delete("/log/melt-lots/{lot_id}", status_code=204, response_class=Response)
async def delete_log_melt_lot_v2(
    lot_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Response:
    await delete_afg_melt_lot(db, lot_id=lot_id, actor=admin)
    return Response(status_code=204)


@router.get("/log/melt-lots/{lot_id}/history", response_model=list[AfgMeltLotHistoryOut])
async def get_log_melt_lot_history_v2(
    lot_id: UUID,
    limit: int = Query(default=50, ge=1, le=300),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[AfgMeltLotHistoryOut]:
    return await list_afg_melt_lot_history(db, lot_id=lot_id, limit=limit)


@router.get("/log/melt-lots/{lot_id}/lines", response_model=list[AfgMeltLotLineOut])
async def get_log_melt_lot_lines_v2(
    lot_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[AfgMeltLotLineOut]:
    return await list_afg_melt_lot_lines(db, lot_id=lot_id)


@router.get("/log/melt-lots/{lot_id}/pdf")
async def get_log_melt_lot_pdf_v2(
    lot_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    """Eritme lot kartı PDF — vergi muhasebesi için."""
    from app.api.afg import _melt_lot_out
    from app.models.afg_melt_lot import AfgMeltLot
    from app.services.lot_card_pdf import build_lot_card_pdf

    lot = await db.get(AfgMeltLot, lot_id)
    if lot is None:
        raise HTTPException(status_code=404, detail="Eritme lotu bulunamadı")
    lot_out = _melt_lot_out(lot)
    lines = await list_afg_melt_lot_lines(db, lot_id=lot_id)
    pdf_bytes = build_lot_card_pdf(lot_out, lines)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="lot-{lot_id}.pdf"',
            "Cache-Control": "no-store",
        },
    )


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


@router.post("/log/workbook/reconcile-preview", response_model=DocumentArtifactReconcilePreviewOut)
async def post_log_workbook_reconcile_preview_v2(
    year: int | None = Query(default=None, ge=2000, le=2100),
    workbook: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> DocumentArtifactReconcilePreviewOut:
    resolved_year = _default_artifact_year(year)
    current_workspace = await build_log_workspace(db, q=None, limit=200)
    content = await workbook.read()
    try:
        parsed = parse_log_workbook_inputs_from_workbook(
            content,
            year=resolved_year,
            current_workspace=current_workspace,
        )
    except (ValidationError, ValueError) as exc:
        return DocumentArtifactReconcilePreviewOut(
            editable=False,
            changes=[],
            warnings=["Dry-run tamamlanmadı; hiçbir mutasyon yapılmadı."],
            blocking_errors=[str(exc)],
        )

    preview = build_log_reconcile_preview(current_workspace, parsed)
    if parsed.base_version:
        record = await get_artifact_record(db, f"log.live.{resolved_year}")
        if record is None:
            preview.editable = False
            preview.blocking_errors.append("Log workbook sync artifact bulunamadı; önce güncel export alın.")
        else:
            conflict_state = resolve_artifact_conflict_state(
                current_revision=getattr(record, "revision", 1),
                incoming_revision=parsed.base_version,
            )
            if conflict_state != "clean":
                preview.editable = False
                preview.blocking_errors.append(
                    f"Log artifact conflict_state={conflict_state}; önce yenileyin; apply yapılmadı."
                )
    return preview


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
