from __future__ import annotations

import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.models.pos_document_audit import PosDocumentAudit


_AUDIT_LOGGER = logging.getLogger("seroguld.audit.pos")


async def _log_pos_audit(
    db: AsyncSession,
    *,
    action: str,
    actor: User,
    sequence_no: int | None = None,
    pos_session_id: UUID | None = None,
    payload: dict | None = None,
    note: str | None = None,
    request: Request | None = None,
) -> None:
    entry = PosDocumentAudit(
        sequence_no=sequence_no,
        pos_session_id=pos_session_id,
        action=action,
        actor_user_id=getattr(actor, "id", None),
        actor_email=getattr(actor, "email", None),
        payload_json=json.dumps(payload, default=str, ensure_ascii=False) if payload else None,
        note=note,
        request_ip=(request.client.host if request and request.client else None),
    )
    db.add(entry)
    try:
        _AUDIT_LOGGER.info(
            "pos.audit action=%s seq=%s actor=%s ip=%s",
            action,
            sequence_no,
            getattr(actor, "email", None),
            entry.request_ip,
        )
    except Exception:  # noqa: BLE001
        pass
from app.api.pos import get_pos_document_detail as get_legacy_pos_document_detail
from app.api.pos import get_pos_receipt as get_legacy_pos_receipt
from app.api.v2 import (
    _apply_afg_workspace_artifact_inputs,
    _build_alis_document_xlsx,
    _build_alis_list_xlsx,
    _build_alis_saved_purchase_items,
    _ensure_alis_workspace_artifact,
    _lookup_danish_postal_code,
)
from app.api.v2_support import artifact_file_response
from app.database import get_db
from app.models.enums import PosTradeSideEnum
from app.models.user import User
from app.schemas.document_artifact import DocumentArtifactReconcilePreviewOut
from app.schemas.pos import (
    PosDocumentDetailOut,
    PosPostalLookupOut,
    PosSavedPurchaseListItemOut,
    PosSessionOutClerk,
    PosWorkspaceCustomerSelectRequest,
    PosWorkspaceCustomerUpdate,
    PosWorkspaceFinalizeRequest,
    PosWorkspaceFinalizeResponse,
    PosWorkspaceOpenRequest,
    PosWorkspaceOut,
    PosWorkspaceSectionsUpdate,
)
from app.services.document_artifact_service import (
    build_afg_workspace_reconcile_preview,
    parse_afg_workspace_inputs_from_workbook,
    sync_afg_document_artifact,
    sync_afg_workspace_artifact,
)
from app.services.pos_service import (
    build_purchase_workspace,
    build_purchase_workspace_csv_export,
    build_purchase_workspace_print_html,
    build_purchase_workspace_xlsx_export,
    cancel_session,
    create_pos_session,
    delete_purchase_document,
    find_latest_draft_pos_session,
    finalize_purchase_workspace,
    get_next_reference_number_preview,
    get_pos_session_or_404,
    open_purchase_document_for_edit,
    replace_purchase_workspace_sections,
    select_purchase_workspace_customer,
    store_purchase_workspace_preferences,
    update_purchase_workspace_customer,
    update_purchase_workspace_draft_customer,
)
from app.services.sequence_service import preview_afregnings_number, preview_invoice_number, preview_product_number
from app.schemas.pos import PosSessionCreate

router = APIRouter()


@router.get("/alis/workspace/open-draft", response_model=PosWorkspaceOut | None)
async def get_alis_workspace_open_draft_v2(
    db: AsyncSession = Depends(get_db),
    clerk_user: User = Depends(require_admin),
) -> PosWorkspaceOut | None:
    draft = await find_latest_draft_pos_session(
        db,
        clerk_user_id=clerk_user.id,
        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
    )
    if draft is None:
        return None
    workspace = await build_purchase_workspace(db, pos_session=draft)
    await _ensure_alis_workspace_artifact(db, workspace, force_sync=False)
    return workspace


@router.get("/alis/workspace/{session_id}", response_model=PosWorkspaceOut)
async def get_alis_workspace_v2(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosWorkspaceOut:
    pos_session = await get_pos_session_or_404(db, session_id)
    workspace = await build_purchase_workspace(db, pos_session=pos_session)
    await _ensure_alis_workspace_artifact(db, workspace, force_sync=False)
    return workspace


@router.post("/alis/workspace", response_model=PosWorkspaceOut)
async def post_alis_workspace_open_v2(
    payload: PosWorkspaceOpenRequest,
    db: AsyncSession = Depends(get_db),
    clerk_user: User = Depends(require_admin),
) -> PosWorkspaceOut:
    session_out = await create_pos_session(
        db,
        PosSessionCreate(
            customer_id=payload.customer_id,
            customer_new=payload.customer_new,
            trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
            force_new_session=payload.force_new_session,
        ),
        clerk_user,
    )
    pos_session = await get_pos_session_or_404(db, session_out.id)
    await store_purchase_workspace_preferences(
        db,
        pos_session=pos_session,
        bank_info=payload.bank_info,
        payment_method=payload.payment_method,
    )
    await db.commit()
    await db.refresh(pos_session)
    workspace = await build_purchase_workspace(db, pos_session=pos_session)
    await _ensure_alis_workspace_artifact(db, workspace, force_sync=True)
    return workspace


@router.get("/alis/list", response_model=list[PosSavedPurchaseListItemOut])
async def get_alis_list_v2(
    q: str | None = None,
    date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    limit: int = Query(default=100, ge=1, le=300),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[PosSavedPurchaseListItemOut]:
    return await _build_alis_saved_purchase_items(
        db,
        admin=admin,
        q=q,
        date=date,
        limit=limit,
    )


@router.get("/alis/list/export")
async def get_alis_list_export_v2(
    q: str | None = None,
    date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    format: str = Query(default="xlsx", pattern="^(xlsx)$"),
    limit: int = Query(default=300, ge=1, le=300),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Response:
    items = await _build_alis_saved_purchase_items(
        db,
        admin=admin,
        q=q,
        date=date,
        limit=limit,
    )
    content = _build_alis_list_xlsx(items)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="alis-kayitli-alislar.xlsx"'},
    )


@router.get("/alis/numbering/preview", response_model=dict[str, str])
async def get_alis_numbering_preview_v2(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict[str, str]:
    reference_number = await get_next_reference_number_preview(db)
    afregnings_number = await preview_afregnings_number(db, start=9600, window=5000)
    invoice_number = await preview_invoice_number(db)
    product_number = await preview_product_number(db)
    return {
        "product_number_next": product_number,
        "reference_number_next": reference_number,
        "afregnings_number_next": afregnings_number,
        "invoice_number_next": invoice_number,
    }


@router.get("/alis/postal-lookup/{postal_code}", response_model=PosPostalLookupOut)
async def get_alis_postal_lookup_v2(
    postal_code: str,
    _: User = Depends(require_admin),
) -> PosPostalLookupOut:
    return await _lookup_danish_postal_code(postal_code)


@router.post("/alis/workspace/{session_id}/customer/select", response_model=PosWorkspaceOut)
async def post_alis_workspace_customer_select_v2(
    session_id: UUID,
    payload: PosWorkspaceCustomerSelectRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosWorkspaceOut:
    pos_session = await get_pos_session_or_404(db, session_id)
    workspace = await select_purchase_workspace_customer(db, pos_session=pos_session, payload=payload)
    await _ensure_alis_workspace_artifact(db, workspace, force_sync=True)
    return workspace


@router.put("/alis/workspace/{session_id}/customer", response_model=PosWorkspaceOut)
async def put_alis_workspace_customer_v2(
    session_id: UUID,
    payload: PosWorkspaceCustomerUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosWorkspaceOut:
    pos_session = await get_pos_session_or_404(db, session_id)
    workspace = await update_purchase_workspace_customer(db, pos_session=pos_session, payload=payload)
    await _ensure_alis_workspace_artifact(db, workspace, force_sync=True)
    return workspace


@router.put("/alis/workspace/{session_id}/draft-customer", response_model=PosWorkspaceOut)
async def put_alis_workspace_draft_customer_v2(
    session_id: UUID,
    payload: PosWorkspaceCustomerUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosWorkspaceOut:
    pos_session = await get_pos_session_or_404(db, session_id)
    workspace = await update_purchase_workspace_draft_customer(db, pos_session=pos_session, payload=payload)
    await _ensure_alis_workspace_artifact(db, workspace, force_sync=True)
    return workspace


@router.put("/alis/workspace/{session_id}/rows", response_model=PosWorkspaceOut)
async def put_alis_workspace_rows_v2(
    session_id: UUID,
    payload: PosWorkspaceSectionsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosWorkspaceOut:
    pos_session = await get_pos_session_or_404(db, session_id)
    workspace = await replace_purchase_workspace_sections(db, pos_session=pos_session, payload=payload)
    await _ensure_alis_workspace_artifact(db, workspace, force_sync=True)
    return workspace


@router.post("/alis/workspace/{session_id}/finalize", response_model=PosWorkspaceFinalizeResponse)
async def post_alis_workspace_finalize_v2(
    session_id: UUID,
    payload: PosWorkspaceFinalizeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> PosWorkspaceFinalizeResponse:
    pos_session = await get_pos_session_or_404(db, session_id)
    response = await finalize_purchase_workspace(db, pos_session=pos_session, payload=payload)
    detail = await get_legacy_pos_document_detail(sequence_no=response.document_sequence_no, db=db, _=admin)
    await sync_afg_document_artifact(db, detail)
    await _log_pos_audit(
        db,
        action="finalize",
        actor=admin,
        sequence_no=response.document_sequence_no,
        pos_session_id=session_id,
        payload={
            "document_number": response.document_number,
            "uniconta_sync_status": getattr(response, "uniconta_sync_status", None),
        },
        request=request,
    )
    await db.commit()
    return response


@router.get("/alis/workspace/{session_id}/export")
async def get_alis_workspace_export_v2(
    session_id: UUID,
    format: str = Query(default="xlsx", pattern="^(csv|xlsx)$"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    pos_session = await get_pos_session_or_404(db, session_id)
    if format == "xlsx":
        filename, xlsx_payload = await build_purchase_workspace_xlsx_export(db, pos_session=pos_session)
        return Response(
            content=xlsx_payload,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    filename, csv_payload = await build_purchase_workspace_csv_export(db, pos_session=pos_session)
    return Response(
        content=csv_payload.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/alis/workspace/{session_id}/artifact")
async def get_alis_workspace_artifact_v2(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    pos_session = await get_pos_session_or_404(db, session_id)
    workspace = await build_purchase_workspace(db, pos_session=pos_session)
    bundle = await sync_afg_workspace_artifact(db, workspace)
    await db.commit()
    return artifact_file_response(bundle.artifact, content=bundle.content)


@router.post("/alis/workspace/{session_id}/artifact/reconcile-preview", response_model=DocumentArtifactReconcilePreviewOut)
async def post_alis_workspace_artifact_reconcile_preview_v2(
    session_id: UUID,
    workbook: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> DocumentArtifactReconcilePreviewOut:
    pos_session = await get_pos_session_or_404(db, session_id)
    workspace = await build_purchase_workspace(db, pos_session=pos_session)
    content = await workbook.read()
    parsed = parse_afg_workspace_inputs_from_workbook(content)
    return build_afg_workspace_reconcile_preview(workspace, parsed)


@router.post("/alis/workspace/{session_id}/artifact/reconcile-apply", response_model=PosWorkspaceOut)
async def post_alis_workspace_artifact_reconcile_apply_v2(
    session_id: UUID,
    workbook: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosWorkspaceOut:
    pos_session = await get_pos_session_or_404(db, session_id)
    content = await workbook.read()
    workspace = await _apply_afg_workspace_artifact_inputs(db, pos_session=pos_session, workbook_bytes=content)
    await db.commit()
    return workspace


@router.post("/alis/workspace/{session_id}/artifact/import", response_model=PosWorkspaceOut)
async def post_alis_workspace_artifact_import_v2(
    session_id: UUID,
    workbook: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosWorkspaceOut:
    pos_session = await get_pos_session_or_404(db, session_id)
    content = await workbook.read()
    workspace = await _apply_afg_workspace_artifact_inputs(db, pos_session=pos_session, workbook_bytes=content)
    await db.commit()
    return workspace


@router.get("/alis/workspace/{session_id}/print")
async def get_alis_workspace_print_v2(
    session_id: UUID,
    format: str = Query(default="html", pattern="^(html)$"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    pos_session = await get_pos_session_or_404(db, session_id)
    html_payload = await build_purchase_workspace_print_html(db, pos_session=pos_session, auto_print=True)
    return Response(content=html_payload, media_type="text/html; charset=utf-8")


@router.get("/alis/documents/{sequence_no}", response_model=PosDocumentDetailOut)
async def get_alis_document_detail_v2(
    sequence_no: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> PosDocumentDetailOut:
    return await get_legacy_pos_document_detail(sequence_no=sequence_no, db=db, _=admin)


@router.get("/alis/documents/{sequence_no}/export")
async def get_alis_document_export_v2(
    sequence_no: int,
    format: str = Query(default="xlsx", pattern="^(xlsx)$"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Response:
    detail = await get_legacy_pos_document_detail(sequence_no=sequence_no, db=db, _=admin)
    content = _build_alis_document_xlsx(detail)
    filename = f'AFG-{detail.document_number.replace("/", "-")}.xlsx'
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/alis/documents/{sequence_no}/artifact")
async def get_alis_document_artifact_v2(
    sequence_no: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Response:
    detail = await get_legacy_pos_document_detail(sequence_no=sequence_no, db=db, _=admin)
    bundle = await sync_afg_document_artifact(db, detail)
    await db.commit()
    return artifact_file_response(bundle.artifact, content=bundle.content)


@router.get("/alis/documents/{sequence_no}/print")
async def get_alis_document_print_v2(
    sequence_no: int,
    format: str = Query(default="html", pattern="^(html)$"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Response:
    detail = await get_legacy_pos_document_detail(sequence_no=sequence_no, db=db, _=admin)
    return await get_legacy_pos_receipt(
        session_id=detail.session_id,
        audience="admin",
        format="html",
        db=db,
        _=admin,
    )


@router.get("/alis/documents/{sequence_no}/receipt-thermal")
async def get_alis_document_receipt_thermal_v2(
    sequence_no: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Response:
    """ESC/POS 80mm thermal printer için raw bytes.

    Frontend bunu blob olarak indirir; Tauri host tarafı veya operatörün
    PC'sindeki yazıcı yazılımı (Star/Epson driver) raw bytes'ı /dev/usb/lp0
    veya COM porta gönderir.
    """
    from app.services.thermal_receipt import build_thermal_receipt_from_detail

    detail = await get_legacy_pos_document_detail(sequence_no=sequence_no, db=db, _=admin)
    payload = build_thermal_receipt_from_detail(detail)
    return Response(
        content=payload,
        media_type="application/vnd.escpos+raw",
        headers={
            "Content-Disposition": f'attachment; filename="afg-{sequence_no}-thermal.escpos"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/alis/documents/{sequence_no}/edit", response_model=PosWorkspaceOut)
async def post_alis_document_edit_v2(
    sequence_no: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    clerk_user: User = Depends(require_admin),
) -> PosWorkspaceOut:
    workspace = await open_purchase_document_for_edit(
        db,
        sequence_no=sequence_no,
        clerk_user=clerk_user,
    )
    await _log_pos_audit(
        db,
        action="edit",
        actor=clerk_user,
        sequence_no=sequence_no,
        pos_session_id=workspace.session.id if workspace and workspace.session else None,
        request=request,
    )
    await db.commit()
    return workspace


@router.delete("/alis/documents/{sequence_no}", response_class=Response, status_code=204)
async def delete_alis_document_v2(
    sequence_no: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Response:
    await delete_purchase_document(
        db,
        sequence_no=sequence_no,
    )
    await _log_pos_audit(
        db,
        action="delete",
        actor=admin,
        sequence_no=sequence_no,
        request=request,
    )
    await db.commit()
    return Response(status_code=204)


@router.post("/alis/workspace/{session_id}/cancel", response_model=PosSessionOutClerk)
async def post_alis_workspace_cancel_v2(
    session_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> PosSessionOutClerk:
    pos_session = await get_pos_session_or_404(db, session_id)
    result = await cancel_session(db, pos_session=pos_session)
    await _log_pos_audit(
        db,
        action="cancel",
        actor=admin,
        pos_session_id=session_id,
        request=request,
    )
    await db.commit()
    return result

