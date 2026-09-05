from __future__ import annotations

import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.models.pos_document import PosDocument
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
    request: Request,
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
from app.schemas.base import AppBaseModel
from app.schemas.document_artifact import DocumentArtifactReconcilePreviewOut
from app.schemas.historical_afg_import import HistoricalAfgImportApplyOut, HistoricalAfgImportPreviewOut
from app.schemas.address import CustomerMatchOut, CustomerMatchRequest, KdsAddressResolveOut, KdsAddressSearchOut
from app.schemas.pos import (
    PosDocumentDetailOut,
    PosPostalLookupOut,
    PosSavedPurchaseListItemOut,
    PosSessionOutClerk,
    PosWorkspaceCustomerDetachRequest,
    PosWorkspaceCustomerSelectRequest,
    PosWorkspaceCustomerUpdate,
    PosWorkspaceFinalizeRequest,
    PosWorkspaceFinalizeResponse,
    PosWorkspaceOpenRequest,
    PosWorkspaceOut,
    PosWorkspaceSectionsUpdate,
)
from app.services.document_artifact_service import (
    artifact_absolute_path,
    build_afg_workspace_reconcile_preview,
    get_artifact_record,
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
    detach_purchase_workspace_customer,
    get_pos_session_or_404,
    open_purchase_document_for_edit,
    replace_purchase_workspace_sections,
    select_purchase_workspace_customer,
    store_purchase_workspace_preferences,
    update_purchase_workspace_customer,
    update_purchase_workspace_draft_customer,
)
from app.services.sequence_service import preview_afregnings_number, preview_invoice_number, preview_product_number
from app.services.customer_service import customer_identity_match
from app.services.historical_afg_import import (
    HistoricalAfgUpload,
    apply_historical_afg_import,
    preview_historical_afg_import,
)
from app.services.kds_address_service import KdsAddressError, kds_address_service
from app.schemas.pos import PosSessionCreate

router = APIRouter()

_HISTORICAL_AFG_ALLOWED_EXTENSIONS = {".xlsx", ".xlsm"}
_HISTORICAL_AFG_MAX_FILES = 100
_HISTORICAL_AFG_MAX_FILE_BYTES = 25 * 1024 * 1024
_HISTORICAL_AFG_MAX_TOTAL_BYTES = 250 * 1024 * 1024


async def _read_historical_afg_uploads(files: list[UploadFile]) -> list[HistoricalAfgUpload]:
    if not files:
        raise HTTPException(status_code=422, detail="En az bir AFG Excel dosyası seçin.")
    if len(files) > _HISTORICAL_AFG_MAX_FILES:
        raise HTTPException(status_code=422, detail=f"En fazla {_HISTORICAL_AFG_MAX_FILES} dosya seçilebilir.")
    uploads: list[HistoricalAfgUpload] = []
    total_size = 0
    for file in files:
        filename = (file.filename or "afg.xlsx").strip() or "afg.xlsx"
        if not any(filename.lower().endswith(extension) for extension in _HISTORICAL_AFG_ALLOWED_EXTENSIONS):
            raise HTTPException(status_code=422, detail=f"{filename}: yalnız .xlsx ve .xlsm dosyaları desteklenir.")
        content = await file.read()
        if not content:
            raise HTTPException(status_code=422, detail=f"{filename}: dosya boş.")
        if len(content) > _HISTORICAL_AFG_MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail=f"{filename}: dosya 25 MB sınırını aşıyor.")
        total_size += len(content)
        if total_size > _HISTORICAL_AFG_MAX_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail="Seçilen dosyaların toplamı 250 MB sınırını aşıyor.")
        uploads.append(HistoricalAfgUpload.from_content(filename=filename, content=content))
    return uploads


@router.post("/alis/historical-import/preview", response_model=HistoricalAfgImportPreviewOut)
async def post_historical_afg_import_preview_v2(
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> HistoricalAfgImportPreviewOut:
    uploads = await _read_historical_afg_uploads(files)
    return await preview_historical_afg_import(db, uploads=uploads)


@router.post("/alis/historical-import/apply", response_model=HistoricalAfgImportApplyOut)
async def post_historical_afg_import_apply_v2(
    request: Request,
    files: list[UploadFile] = File(...),
    selected_hashes_json: str = Form(...),
    selected_customer_keys_json: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> HistoricalAfgImportApplyOut:
    try:
        selected_hashes = json.loads(selected_hashes_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="Seçilen dosya listesi geçersiz.") from exc
    if not isinstance(selected_hashes, list) or not all(isinstance(item, str) for item in selected_hashes):
        raise HTTPException(status_code=422, detail="Seçilen dosya listesi geçersiz.")

    # None gönderilmezse tüm yeni müşteriler oluşturulur (geriye dönük).
    selected_customer_keys: list[str] | None = None
    if selected_customer_keys_json is not None:
        try:
            parsed_keys = json.loads(selected_customer_keys_json)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail="Seçilen müşteri listesi geçersiz.") from exc
        if not isinstance(parsed_keys, list) or not all(isinstance(item, str) for item in parsed_keys):
            raise HTTPException(status_code=422, detail="Seçilen müşteri listesi geçersiz.")
        selected_customer_keys = parsed_keys

    result = await apply_historical_afg_import(
        db,
        uploads=await _read_historical_afg_uploads(files),
        selected_hashes=selected_hashes,
        actor=admin,
        selected_customer_keys=selected_customer_keys,
    )
    for item in result.items:
        if item.status == "imported" and item.sequence_no is not None:
            await _log_pos_audit(
                db,
                action="historical_afg_import",
                actor=admin,
                sequence_no=item.sequence_no,
                payload={
                    "source_hash": item.source_hash,
                    "file_name": item.file_name,
                    "legacy_document_number": item.legacy_document_number,
                    "external_effects": "disabled",
                },
                request=request,
            )
    await db.commit()
    return result


def _address_lookup_http_error(exc: KdsAddressError) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code,
        detail={"code": exc.code, "message": exc.message},
    )


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
    return workspace


@router.get("/alis/workspace/{session_id}", response_model=PosWorkspaceOut)
async def get_alis_workspace_v2(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosWorkspaceOut:
    pos_session = await get_pos_session_or_404(db, session_id)
    workspace = await build_purchase_workspace(db, pos_session=pos_session)
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


@router.get("/alis/address-search", response_model=KdsAddressSearchOut)
async def get_alis_address_search_v2(
    q: str = Query(min_length=1, max_length=73),
    postal_code: str | None = Query(default=None, pattern=r"^\d{4}$"),
    limit: int = Query(default=8, ge=1, le=10),
    _: User = Depends(require_admin),
) -> KdsAddressSearchOut:
    try:
        return await kds_address_service.search(q, postal_code=postal_code, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except KdsAddressError as exc:
        raise _address_lookup_http_error(exc) from exc


@router.get("/alis/address-resolve/{address_id}", response_model=KdsAddressResolveOut)
async def get_alis_address_resolve_v2(
    address_id: str,
    postal_code: str | None = Query(default=None, pattern=r"^\d{4}$"),
    _: User = Depends(require_admin),
) -> KdsAddressResolveOut:
    try:
        return await kds_address_service.resolve(address_id, postal_code=postal_code)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except KdsAddressError as exc:
        raise _address_lookup_http_error(exc) from exc


@router.post("/alis/customer-match", response_model=CustomerMatchOut)
async def post_alis_customer_match_v2(
    payload: CustomerMatchRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> CustomerMatchOut:
    return await customer_identity_match(
        db,
        cpr_number=payload.cpr_number,
        identity_doc_number=payload.identity_doc_number,
    )


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


@router.post("/alis/workspace/{session_id}/customer/detach", response_model=PosWorkspaceOut)
async def post_alis_workspace_customer_detach_v2(
    session_id: UUID,
    payload: PosWorkspaceCustomerDetachRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosWorkspaceOut:
    pos_session = await get_pos_session_or_404(db, session_id)
    workspace = await detach_purchase_workspace_customer(db, pos_session=pos_session, payload=payload)
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
    # finalize_purchase_workspace belgeyi KENDİ commit'iyle kalıcılaştırır;
    # bu noktadan sonra istemciye 500 dönerse retry 409 'zaten kesinleşmiş'
    # verir. Bu yüzden finalize audit kaydı belge commit'inden HEMEN sonra
    # yazılır (Bogføringslovgivning izi artifact/render arızasına kurban
    # edilemez), Office artifact senkronu ise best-effort'a alınır.
    response = await finalize_purchase_workspace(db, pos_session=pos_session, payload=payload)
    try:
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
    except Exception:  # noqa: BLE001 — audit başarısızlığı finalize yanıtını düşürmesin
        logging.getLogger(__name__).exception(
            "finalize audit kaydı yazılamadı (seq=%s, session=%s)",
            response.document_sequence_no,
            session_id,
        )
        await db.rollback()

    try:
        detail = await get_legacy_pos_document_detail(sequence_no=response.document_sequence_no, db=db, _=admin)
        await sync_afg_document_artifact(db, detail)
        await db.commit()
    except Exception:  # noqa: BLE001 — belge kesinleşti; xlsm projeksiyonu retry edilebilir
        logging.getLogger(__name__).exception(
            "finalize artifact senkronu başarısız — belge kalıcı, projeksiyon "
            "artifact/retry ucuyla yenilenebilir (seq=%s)",
            response.document_sequence_no,
        )
        await db.rollback()
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
    artifact = await get_artifact_record(db, f"alis.workspace.{session_id}")
    if artifact is None or not artifact_absolute_path(artifact).exists():
        workspace = await build_purchase_workspace(db, pos_session=pos_session)
        bundle = await sync_afg_workspace_artifact(db, workspace)
        await db.commit()
        artifact = bundle.artifact
        return artifact_file_response(artifact, content=bundle.content)
    return artifact_file_response(artifact)


@router.post("/alis/workspace/{session_id}/artifact/sync", response_model=PosWorkspaceOut)
async def post_alis_workspace_artifact_sync_v2(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosWorkspaceOut:
    """Retry only the Office projection after the core workspace is saved."""
    pos_session = await get_pos_session_or_404(db, session_id)
    workspace = await build_purchase_workspace(db, pos_session=pos_session)
    await _ensure_alis_workspace_artifact(db, workspace, force_sync=True)
    return workspace


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
    allow_full_clear: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosWorkspaceOut:
    pos_session = await get_pos_session_or_404(db, session_id)
    content = await workbook.read()
    workspace = await _apply_afg_workspace_artifact_inputs(
        db,
        pos_session=pos_session,
        workbook_bytes=content,
        allow_full_clear=allow_full_clear,
    )
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


class AlisDocumentLinkCustomerIn(AppBaseModel):
    customer_id: UUID


@router.post("/alis/documents/auto-link-customers")
async def post_alis_documents_auto_link_customers_v2(
    limit: int = Query(default=500, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    """B5/R2-17 — bağlantısız TARİHSEL belgeleri toplu ön eşleştir.

    Belge snapshot'ında CPR tutulmaz (PII kararı); CPR eşleşmesi yalnız import
    anında yapılır. Bu araç sonradan eklenen müşteriler için e-posta (birebir)
    → ad+telefon (normalize) sırasıyla yeniden dener. TEK aday varsa bağlar;
    birden çok aday = belirsiz, hiç aday = eşleşmedi — ikisi de elle bırakılır.

    Performans: transactions ve pos_sessions eşleşen belgeler için TEKER
    sorguda (in_) toplanır — eski belge-başına 2N+2 sorgu deseni ve uzun
    yazım penceresi kalktı. Yanıt eşlenen (sequence_no, customer_id)
    listesini de taşır; operatör denetimi kolaylaşır.
    """
    from sqlalchemy import select as _select

    from app.models.enums import RoleEnum as _RoleEnum
    from app.models.pos_session import PosSession as _PosSession
    from app.models.transaction import Transaction as _Transaction
    from app.services.historical_afg_import import _normalise_phone

    documents = (
        await db.scalars(
            _select(PosDocument)
            .join(_PosSession, _PosSession.id == PosDocument.pos_session_id)
            .where(PosDocument.uniconta_sync_status == "historical")
            .where(_PosSession.customer_id.is_(None))
            .order_by(PosDocument.sequence_no.asc())
            .limit(limit)
        )
    ).all()
    customers = (await db.scalars(_select(User).where(User.role == _RoleEnum.CUSTOMER))).all()
    by_email: dict[str, list[User]] = {}
    by_name_phone: dict[tuple[str, str], list[User]] = {}
    for customer in customers:
        email = (customer.email or "").strip().lower()
        if email:
            by_email.setdefault(email, []).append(customer)
        name = " ".join((customer.name or "").split()).casefold()
        phone = _normalise_phone(getattr(customer, "phone", None))
        if name and phone:
            by_name_phone.setdefault((name, phone), []).append(customer)

    ambiguous = sum(
        1
        for document in documents
        if _auto_link_candidate_count(document, by_email, by_name_phone, _normalise_phone) > 1
    )
    # Tek adaylı belgeler önce toplanır; DB işi toplu yapılır.
    single_matches: list[tuple[PosDocument, User]] = []
    unmatched = 0
    for document in documents:
        candidate_count = _auto_link_candidate_count(document, by_email, by_name_phone, _normalise_phone)
        if candidate_count == 0:
            unmatched += 1
            continue
        if candidate_count > 1:
            continue
        email = (document.customer_email or "").strip().lower()
        if email and email in by_email:
            customer = by_email[email][0]
        else:
            name = " ".join((document.customer_name or "").split()).casefold()
            phone = _normalise_phone(document.customer_phone)
            customer = by_name_phone[(name, phone)][0]
        single_matches.append((document, customer))

    transactions_map: dict[int, list[_Transaction]] = {}
    sessions_map: dict[UUID, _PosSession] = {}
    if single_matches:
        matched_sequence_numbers = [document.sequence_no for document, _ in single_matches]
        matched_session_ids = {document.pos_session_id for document, _ in single_matches}
        matched_transactions = (
            await db.scalars(
                _select(_Transaction).where(_Transaction.pos_document_sequence_no.in_(matched_sequence_numbers))
            )
        ).all()
        for txn in matched_transactions:
            if txn.pos_document_sequence_no is not None:
                transactions_map.setdefault(txn.pos_document_sequence_no, []).append(txn)
        matched_sessions = (
            await db.scalars(_select(_PosSession).where(_PosSession.id.in_(matched_session_ids)))
        ).all()
        sessions_map = {session.id: session for session in matched_sessions}

    linked = 0
    matches: list[dict[str, str]] = []
    for document, customer in single_matches:
        for txn in transactions_map.get(document.sequence_no, []):
            txn.customer_id = customer.id
        pos_session = sessions_map.get(document.pos_session_id)
        if pos_session is not None:
            pos_session.customer_id = customer.id
        db.add(
            PosDocumentAudit(
                sequence_no=document.sequence_no,
                pos_session_id=document.pos_session_id,
                action="historical_autolink_customer",
                actor_user_id=admin.id,
                actor_email=admin.email,
                payload_json=json.dumps({"new_customer_id": str(customer.id)}, ensure_ascii=False),
                note=f"Toplu ön eşleştirme: {customer.name}",
            )
        )
        matches.append({"sequence_no": str(document.sequence_no), "customer_id": str(customer.id)})
        linked += 1
    await db.commit()
    return {
        "ok": True,
        "scanned": len(documents),
        "linked": linked,
        "ambiguous": ambiguous,
        "unmatched": unmatched,
        "matches": matches,
    }


def _auto_link_candidate_count(
    document: PosDocument,
    by_email: dict[str, list[User]],
    by_name_phone: dict[tuple[str, str], list[User]],
    normalise_phone,
) -> int:
    """Belgenin otomatik eşleştirme aday sayısı (0 = eşleşmedi, 1 = bağlanır, >1 = belirsiz)."""
    email = (document.customer_email or "").strip().lower()
    if email and email in by_email:
        return len(by_email[email])
    name = " ".join((document.customer_name or "").split()).casefold()
    phone = normalise_phone(document.customer_phone)
    if name and phone:
        return len(by_name_phone.get((name, phone), []))
    return 0


@router.post("/alis/documents/{sequence_no}/link-customer")
async def post_alis_document_link_customer_v2(
    sequence_no: int,
    payload: AlisDocumentLinkCustomerIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    """R2-17 — tarihsel (içe aktarılmış) belgeyi doğru müşteriye ELLE bağla.

    Otomatik eşleşme (CPR → e-posta → ad+telefon) yanlış/duplike müşteriye
    düştüyse operatör buradan düzeltir. Yalnız 'historical' belgelerde izinli —
    canlı finalize edilmiş belgelerin müşterisi değiştirilemez. Belgenin donmuş
    müşteri SNAPSHOT alanlarına (ad/adres) dokunulmaz; yalnız bağ güncellenir.
    """
    from sqlalchemy import select as _select

    from app.models.enums import RoleEnum as _RoleEnum
    from app.models.pos_session import PosSession as _PosSession
    from app.models.transaction import Transaction as _Transaction

    document = await db.scalar(_select(PosDocument).where(PosDocument.sequence_no == sequence_no))
    if document is None:
        raise HTTPException(status_code=404, detail="Belge bulunamadı.")
    if document.uniconta_sync_status != "historical":
        raise HTTPException(
            status_code=422,
            detail="Yalnız tarihsel içe aktarılmış belgeler yeniden bağlanabilir.",
        )
    customer = await db.get(User, payload.customer_id)
    if customer is None or customer.role != _RoleEnum.CUSTOMER:
        raise HTTPException(status_code=404, detail="Müşteri bulunamadı.")

    transactions = (
        await db.scalars(_select(_Transaction).where(_Transaction.pos_document_sequence_no == sequence_no))
    ).all()
    previous_ids = sorted({str(txn.customer_id) for txn in transactions if txn.customer_id})
    for txn in transactions:
        txn.customer_id = customer.id
    pos_session = await db.get(_PosSession, document.pos_session_id)
    if pos_session is not None:
        pos_session.customer_id = customer.id

    db.add(
        PosDocumentAudit(
            sequence_no=document.sequence_no,
            pos_session_id=document.pos_session_id,
            action="historical_relink_customer",
            actor_user_id=admin.id,
            actor_email=admin.email,
            payload_json=json.dumps(
                {"previous_customer_ids": previous_ids, "new_customer_id": str(customer.id)},
                ensure_ascii=False,
            ),
            note=f"Tarihsel belge müşterisi elle bağlandı: {customer.name}",
        )
    )
    await db.commit()
    return {
        "ok": True,
        "sequence_no": document.sequence_no,
        "customer_id": str(customer.id),
        "customer_name": customer.name,
        "transaction_count": len(transactions),
    }


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
    document = await db.get(PosDocument, sequence_no)
    if document is not None and document.historical_import_hash:
        raise HTTPException(status_code=409, detail="Tarihsel AFG kayıtları eski dosya izi korunarak düzenlenemez.")
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
    document = await db.get(PosDocument, sequence_no)
    if document is not None and document.historical_import_hash:
        raise HTTPException(status_code=409, detail="Tarihsel AFG kayıtları silinemez.")
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
