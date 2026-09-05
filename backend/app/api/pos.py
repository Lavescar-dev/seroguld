from __future__ import annotations

import json
import logging
import re
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from fastapi.responses import HTMLResponse
from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_admin
from app.database import AsyncSessionLocal, get_db
from app.models.enums import PosDocumentTypeEnum, PosSessionStatusEnum, ProductStatusEnum
from app.models.pos_document import PosDocument
from app.models.enums import PosTradeSideEnum, RoleEnum
from app.models.product import Product
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.models.pos_session import PosSession
from app.models.user import User
from app.schemas.pos import (
    PosConfirmRequest,
    PosConfirmResponse,
    PosDocumentDetailLineOut,
    PosDocumentDetailOut,
    PosDocumentListItemOut,
    PosManualRateUpdate,
    PosMetalRatesOut,
    PosQuoteUpdate,
    PosRealtimePreview,
    PosSessionLineBulkCreate,
    PosSessionLineCreate,
    PosSessionLineOut,
    PosSessionLineUpdate,
    PosSessionCreate,
    PosSessionDisplayOut,
    PosSessionOutClerk,
    PosTransactionLineOut,
    PosTransactionOut,
    PosWorkspaceFinalizeRequest,
    PosWorkspaceFinalizeResponse,
    PosWorkspaceMarketRates,
    PosWorkspaceOpenRequest,
    PosWorkspaceOut,
    PosWorkspaceSectionsUpdate,
    PosWorkspaceCustomerUpdate,
)
from app.services.pos_document_service import document_title_tr, format_document_number
from app.services.gold_price import GoldPriceService
from app.services.pos_service import (
    build_realtime_display_snapshot,
    build_purchase_workspace,
    build_pos_receipt_context,
    cancel_session,
    clerk_snapshot,
    confirm_session,
    create_pos_session,
    create_pos_session_lines_bulk,
    create_pos_session_line,
    delete_pos_session_line,
    display_snapshot,
    get_next_reference_number_preview,
    get_pos_session_by_display_token_or_404,
    get_pos_session_or_404,
    find_open_draft_pos_session,
    find_latest_draft_pos_session,
    finalize_purchase_workspace,
    extract_purchase_bank_info,
    extract_purchase_freeform_note,
    extract_purchase_invoice_gold_sheet,
    extract_purchase_invoice_misc_sheet,
    extract_purchase_market_rates,
    extract_purchase_numbering,
    extract_purchase_payment_method,
    list_pos_session_lines,
    replace_purchase_workspace_sections,
    render_pos_receipt_html,
    render_pos_receipt_pdf,
    set_manual_rate,
    sync_live_rate,
    update_purchase_workspace_customer,
    update_pos_session_line,
    update_quote,
    _workspace_customer_from_session,
)
from app.utils.security import mask_cpr, mask_last4
from app.services.realtime import realtime_hub
from app.services.sequence_service import preview_afregnings_number, preview_invoice_number, preview_product_number
from app.utils.helpers import quantize_2
from app.utils.security import TokenError, decode_access_token

router = APIRouter()

LOGGER = logging.getLogger(__name__)


def _document_kind_label(document_type: PosDocumentTypeEnum) -> str:
    if document_type == PosDocumentTypeEnum.SALE_INVOICE:
        return "faktura"
    return "afregningsbilag"


def _document_operation_state(status_counts: dict[str, int]) -> str:
    active_statuses = {status for status, count in status_counts.items() if count > 0}
    if not active_statuses:
        return "awaiting_decision"
    if active_statuses == {ProductStatusEnum.PURCHASED.value}:
        return "awaiting_decision"
    if len(active_statuses) > 1:
        return "mixed"
    return next(iter(active_statuses))


def _empty_document_product_meta() -> dict[str, object]:
    return {
        "product_ids": [],
        "product_numbers": [],
        "product_status_counts": {},
        "has_locked_products": False,
        "total_weight_grams": Decimal("0.00"),
        "total_pure_gold_grams": Decimal("0.00"),
    }


@router.post("/sessions", response_model=PosSessionOutClerk, deprecated=True)
async def post_pos_session(
    payload: PosSessionCreate,
    db: AsyncSession = Depends(get_db),
    clerk_user: User = Depends(require_admin),
) -> PosSessionOutClerk:
    return await create_pos_session(db, payload, clerk_user)


@router.get("/workspace/open-draft", response_model=PosWorkspaceOut | None, deprecated=True)
async def get_purchase_workspace_open_draft(
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
    return await build_purchase_workspace(db, pos_session=draft)


@router.post("/workspace/open", response_model=PosWorkspaceOut, deprecated=True)
async def post_purchase_workspace_open(
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
    return await build_purchase_workspace(db, pos_session=pos_session)


@router.get("/workspace/{session_id}", response_model=PosWorkspaceOut, deprecated=True)
async def get_purchase_workspace(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosWorkspaceOut:
    pos_session = await get_pos_session_or_404(db, session_id)
    return await build_purchase_workspace(db, pos_session=pos_session)


@router.put("/workspace/{session_id}/customer", response_model=PosWorkspaceOut, deprecated=True)
async def put_purchase_workspace_customer(
    session_id: UUID,
    payload: PosWorkspaceCustomerUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosWorkspaceOut:
    pos_session = await get_pos_session_or_404(db, session_id)
    return await update_purchase_workspace_customer(db, pos_session=pos_session, payload=payload)


@router.put("/workspace/{session_id}/sections", response_model=PosWorkspaceOut, deprecated=True)
async def put_purchase_workspace_sections(
    session_id: UUID,
    payload: PosWorkspaceSectionsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosWorkspaceOut:
    pos_session = await get_pos_session_or_404(db, session_id)
    return await replace_purchase_workspace_sections(db, pos_session=pos_session, payload=payload)


@router.post("/workspace/{session_id}/finalize", response_model=PosWorkspaceFinalizeResponse, deprecated=True)
async def post_purchase_workspace_finalize(
    session_id: UUID,
    payload: PosWorkspaceFinalizeRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosWorkspaceFinalizeResponse:
    pos_session = await get_pos_session_or_404(db, session_id)
    return await finalize_purchase_workspace(db, pos_session=pos_session, payload=payload)


@router.post("/workspace/{session_id}/cancel", response_model=PosSessionOutClerk, deprecated=True)
async def post_purchase_workspace_cancel(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosSessionOutClerk:
    pos_session = await get_pos_session_or_404(db, session_id)
    return await cancel_session(db, pos_session=pos_session)


@router.get("/sessions/open-draft", response_model=PosSessionOutClerk | None, deprecated=True)
async def get_open_draft_session(
    customer_id: UUID,
    trade_side: PosTradeSideEnum = Query(default=PosTradeSideEnum.BUY_FROM_CUSTOMER),
    db: AsyncSession = Depends(get_db),
    clerk_user: User = Depends(require_admin),
) -> PosSessionOutClerk | None:
    draft = await find_open_draft_pos_session(
        db,
        clerk_user_id=clerk_user.id,
        customer_id=customer_id,
        trade_side=trade_side,
    )
    if draft is None:
        return None
    return clerk_snapshot(draft)


@router.get("/sessions/{session_id}", response_model=PosSessionOutClerk, deprecated=True)
async def get_pos_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosSessionOutClerk:
    pos_session = await get_pos_session_or_404(db, session_id)
    return clerk_snapshot(pos_session)


@router.patch("/sessions/{session_id}/quote", response_model=PosSessionOutClerk, deprecated=True)
async def patch_quote(
    session_id: UUID,
    payload: PosQuoteUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosSessionOutClerk:
    pos_session = await get_pos_session_or_404(db, session_id)
    return await update_quote(db, pos_session=pos_session, payload=payload)


@router.get("/sessions/{session_id}/lines", response_model=list[PosSessionLineOut], deprecated=True)
async def get_pos_lines(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[PosSessionLineOut]:
    pos_session = await get_pos_session_or_404(db, session_id)
    return await list_pos_session_lines(db, pos_session=pos_session)


@router.post("/sessions/{session_id}/lines", response_model=PosSessionLineOut, deprecated=True)
async def post_pos_line(
    session_id: UUID,
    payload: PosSessionLineCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosSessionLineOut:
    pos_session = await get_pos_session_or_404(db, session_id)
    return await create_pos_session_line(db, pos_session=pos_session, payload=payload)


@router.post("/sessions/{session_id}/lines/bulk", response_model=list[PosSessionLineOut], deprecated=True)
async def post_pos_lines_bulk(
    session_id: UUID,
    payload: PosSessionLineBulkCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[PosSessionLineOut]:
    pos_session = await get_pos_session_or_404(db, session_id)
    return await create_pos_session_lines_bulk(db, pos_session=pos_session, payload=payload)


@router.patch("/sessions/{session_id}/lines/{line_id}", response_model=PosSessionLineOut, deprecated=True)
async def patch_pos_line(
    session_id: UUID,
    line_id: UUID,
    payload: PosSessionLineUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosSessionLineOut:
    pos_session = await get_pos_session_or_404(db, session_id)
    return await update_pos_session_line(db, pos_session=pos_session, line_id=line_id, payload=payload)


@router.delete("/sessions/{session_id}/lines/{line_id}", status_code=204, deprecated=True)
async def delete_pos_line(
    session_id: UUID,
    line_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    pos_session = await get_pos_session_or_404(db, session_id)
    await delete_pos_session_line(db, pos_session=pos_session, line_id=line_id)
    return Response(status_code=204)


@router.post("/sessions/{session_id}/rate/sync", response_model=PosSessionOutClerk, deprecated=True)
async def post_rate_sync(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosSessionOutClerk:
    pos_session = await get_pos_session_or_404(db, session_id)
    return await sync_live_rate(db, pos_session=pos_session)


@router.patch("/sessions/{session_id}/rate/manual", response_model=PosSessionOutClerk, deprecated=True)
async def patch_manual_rate(
    session_id: UUID,
    payload: PosManualRateUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosSessionOutClerk:
    pos_session = await get_pos_session_or_404(db, session_id)
    return await set_manual_rate(db, pos_session=pos_session, payload=payload)


@router.post("/sessions/{session_id}/confirm", response_model=PosConfirmResponse, deprecated=True)
async def post_confirm(
    session_id: UUID,
    payload: PosConfirmRequest,
    db: AsyncSession = Depends(get_db),
    clerk_user: User = Depends(require_admin),
) -> PosConfirmResponse:
    pos_session = await get_pos_session_or_404(db, session_id)
    return await confirm_session(db, pos_session=pos_session, payload=payload, clerk_user=clerk_user)


@router.get("/reference-next")
async def get_next_reference_number(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    return {"reference_number": await get_next_reference_number_preview(db)}


@router.get("/numbering/preview")
async def get_numbering_preview(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    reference_number = await get_next_reference_number_preview(db)
    afregnings_number = await preview_afregnings_number(
        db,
        start=9600,
        window=5000,
    )
    invoice_number = await preview_invoice_number(db)
    product_number = await preview_product_number(db)
    return {
        "product_number_next": product_number,
        "reference_number_next": reference_number,
        "afregnings_number_next": afregnings_number,
        "invoice_number_next": invoice_number,
    }


@router.get("/rates/live", response_model=PosMetalRatesOut)
async def get_live_metal_rates(
    _: User = Depends(require_admin),
) -> PosMetalRatesOut:
    price_service = GoldPriceService()
    rates = await price_service.get_rates()
    # Kaynak şeffaflığı: canlı besleme kapalıyken hard-coded fallback döner;
    # 'live metal rates' adıyla sabitleri live diye sunmamak için kaynak
    # etiketi yanıtla taşınır (UI 'sabit/bayat' rozeti bununla ayrılır).
    meta = GoldPriceService.cached_meta_or_fallback()
    sources = {
        str((meta.get(key) or {}).get("source") or "fallback")
        for key in ("gold", "silver", "platinum", "palladium")
    }
    source = sources.pop() if len(sources) == 1 else "mixed"
    gold = format(quantize_2(rates.get("gold", 0)), "f")
    return PosMetalRatesOut(
        yellow_gold=gold,
        white_gold=gold,
        silver=format(quantize_2(rates.get("silver", 0)), "f"),
        platinum=format(quantize_2(rates.get("platinum", 0)), "f"),
        palladium=format(quantize_2(rates.get("palladium", 0)), "f"),
        source=source,
    )


@router.get("/documents", response_model=list[PosDocumentListItemOut])
async def get_pos_documents(
    q: str | None = Query(default=None),
    kind: str | None = Query(default=None, pattern="^(afregningsbilag|faktura)$"),
    limit: int = Query(default=100, ge=1, le=300),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[PosDocumentListItemOut]:
    normalized_query = q.strip() if q else ""
    numeric_tokens = re.findall(r"\d+", normalized_query)
    sequence_no_filter = int(numeric_tokens[-1]) if numeric_tokens else None

    line_count_subquery = (
        select(
            Transaction.pos_document_sequence_no.label("sequence_no"),
            func.count(TransactionLine.id).label("line_count"),
        )
        .outerjoin(TransactionLine, TransactionLine.transaction_id == Transaction.id)
        .where(Transaction.pos_document_sequence_no.is_not(None))
        .group_by(Transaction.pos_document_sequence_no)
        .subquery()
    )

    stmt = (
        select(
            PosDocument,
            PosSession,
            Transaction,
            func.coalesce(line_count_subquery.c.line_count, 0),
        )
        .join(PosSession, PosSession.id == PosDocument.pos_session_id)
        .outerjoin(Transaction, Transaction.pos_document_sequence_no == PosDocument.sequence_no)
        .outerjoin(line_count_subquery, line_count_subquery.c.sequence_no == PosDocument.sequence_no)
        .order_by(PosDocument.issued_at.desc(), PosDocument.sequence_no.desc())
        .limit(limit)
    )

    if kind == "afregningsbilag":
        stmt = stmt.where(PosDocument.document_type == PosDocumentTypeEnum.PURCHASE_RECEIPT)
    elif kind == "faktura":
        stmt = stmt.where(PosDocument.document_type == PosDocumentTypeEnum.SALE_INVOICE)

    if normalized_query:
        like_query = f"%{normalized_query}%"
        filters = [
            PosDocument.customer_name.ilike(like_query),
            PosDocument.customer_email.ilike(like_query),
            PosDocument.customer_phone.ilike(like_query),
            PosSession.session_code.ilike(like_query),
        ]
        if sequence_no_filter is not None:
            filters.append(PosDocument.sequence_no == sequence_no_filter)
        stmt = stmt.where(
            or_(*filters)
        )

    rows = (await db.execute(stmt)).all()
    sequence_numbers = [document.sequence_no for document, _, _, _ in rows]
    related_products: dict[int, dict[str, object]] = {
        sequence_no: _empty_document_product_meta()
        for sequence_no in sequence_numbers
    }

    if sequence_numbers:
        product_rows = (
            await db.execute(
                select(
                    Transaction.pos_document_sequence_no,
                    Product.id,
                    Product.product_number,
                    Product.status,
                    Product.is_gdpr_locked,
                    TransactionLine.weight_grams,
                    TransactionLine.pure_gold_grams,
                )
                .join(TransactionLine, TransactionLine.transaction_id == Transaction.id)
                .outerjoin(Product, Product.id == TransactionLine.product_id)
                .where(Transaction.pos_document_sequence_no.in_(sequence_numbers))
                .order_by(Transaction.pos_document_sequence_no.asc(), TransactionLine.line_no.asc())
            )
        ).all()

        for sequence_no, product_id, product_number, product_status, is_gdpr_locked, weight_grams, pure_gold_grams in product_rows:
            if sequence_no is None:
                continue
            meta = related_products.setdefault(
                int(sequence_no),
                _empty_document_product_meta(),
            )
            product_ids = meta["product_ids"]
            if product_id is not None and product_id not in product_ids:
                product_ids.append(product_id)

            product_numbers = meta["product_numbers"]
            if product_number and product_number not in product_numbers:
                product_numbers.append(product_number)

            status_counts = meta["product_status_counts"]
            if product_status is not None:
                status_key = product_status.value if isinstance(product_status, ProductStatusEnum) else str(product_status)
                status_counts[status_key] = int(status_counts.get(status_key, 0)) + 1
            meta["has_locked_products"] = bool(meta["has_locked_products"] or bool(is_gdpr_locked))
            meta["total_weight_grams"] = Decimal(meta["total_weight_grams"]) + Decimal(weight_grams or 0)
            meta["total_pure_gold_grams"] = Decimal(meta["total_pure_gold_grams"]) + Decimal(pure_gold_grams or 0)

    return [
        PosDocumentListItemOut(
            sequence_no=document.sequence_no,
            session_id=pos_session.id,
            session_code=pos_session.session_code,
            trade_side=pos_session.trade_side.value,
            status=(transaction.status if transaction is not None else pos_session.status.value),
            document_type=document.document_type.value,
            document_kind=_document_kind_label(document.document_type),
            document_title=document_title_tr(document.document_type),
            document_number=format_document_number(document),
            customer_name=document.customer_name,
            customer_phone=document.customer_phone,
            customer_email=document.customer_email,
            currency_code=document.currency_code,
            gross_amount_dkk=document.gross_amount_dkk,
            net_amount_dkk=document.net_amount_dkk,
            vat_rate_percent=document.vat_rate_percent,
            vat_amount_dkk=document.vat_amount_dkk,
            line_count=int(line_count or 0),
            total_weight_grams=Decimal(related_products.get(document.sequence_no, {}).get("total_weight_grams", 0) or 0),
            total_pure_gold_grams=Decimal(related_products.get(document.sequence_no, {}).get("total_pure_gold_grams", 0) or 0),
            product_ids=list(related_products.get(document.sequence_no, {}).get("product_ids", [])),
            product_numbers=list(related_products.get(document.sequence_no, {}).get("product_numbers", [])),
            product_status_counts=dict(related_products.get(document.sequence_no, {}).get("product_status_counts", {})),
            operation_state=_document_operation_state(
                dict(related_products.get(document.sequence_no, {}).get("product_status_counts", {}))
            ),
            has_locked_products=bool(related_products.get(document.sequence_no, {}).get("has_locked_products", False)),
            issued_at=document.issued_at,
            confirmed_at=(transaction.confirmed_at if transaction is not None else pos_session.confirmed_at),
        )
        for document, pos_session, transaction, line_count in rows
    ]


@router.get("/documents/{sequence_no}", response_model=PosDocumentDetailOut)
async def get_pos_document_detail(
    sequence_no: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosDocumentDetailOut:
    row = (
        await db.execute(
            select(PosDocument, PosSession, Transaction)
            .join(PosSession, PosSession.id == PosDocument.pos_session_id)
            .outerjoin(Transaction, Transaction.pos_document_sequence_no == PosDocument.sequence_no)
            .options(selectinload(PosSession.customer))
            .where(PosDocument.sequence_no == sequence_no)
            .limit(1)
        )
    ).first()

    if row is None:
        raise HTTPException(status_code=404, detail="Belge bulunamadı")

    document, pos_session, transaction = row
    effective_customer = await _workspace_customer_from_session(db, pos_session)
    # NOT: ham customer_cpr / customer_identity_doc_number bu paylaşılan
    # fonksiyondan bilinçli olarak dönmeye devam eder — v2_alis artifact/
    # export hatları (build_afg_workbook_bytes_from_detail) ve Excel oturum
    # servisi aynı fonksiyonu iç çağrıyla kullanır ve AFG belgesi CPR doğum
    # bölümü + kimlik numarasını basmak ZORUNDAdır (AFG-P1 politikası).
    # Wire'da maskeleme ancak iç çağıranlara ?reveal= sözleşmesi verildikten
    # sonra uygulanabilir; o dosyalar bu dalganın kapsamı dışında.
    cpr_plain = effective_customer.cpr_number
    cpr_masked = mask_cpr(cpr_plain) if cpr_plain else None
    identity_number_plain = effective_customer.identity_doc_number
    identity_number_masked = mask_last4(identity_number_plain) if identity_number_plain else None

    line_rows = (
        await db.execute(
            select(TransactionLine, Product)
            .join(Transaction, Transaction.id == TransactionLine.transaction_id)
            .outerjoin(Product, Product.id == TransactionLine.product_id)
            .where(Transaction.pos_document_sequence_no == sequence_no)
            .order_by(TransactionLine.line_no.asc())
        )
    ).all()

    line_items: list[PosDocumentDetailLineOut] = []
    status_counts: dict[str, int] = {}
    product_ids: list[UUID] = []
    product_numbers: list[str] = []
    total_weight = Decimal("0.00")
    total_pure_gold = Decimal("0.00")
    has_locked_products = False

    for line, product in line_rows:
        if line.weight_grams is not None:
            total_weight += Decimal(line.weight_grams)
        if line.pure_gold_grams is not None:
            total_pure_gold += Decimal(line.pure_gold_grams)

        product_status = None
        product_notes = None
        is_gdpr_locked = False
        if product is not None:
            if product.id not in product_ids:
                product_ids.append(product.id)
            if product.product_number and product.product_number not in product_numbers:
                product_numbers.append(product.product_number)
            product_status = product.status.value
            product_notes = product.notes
            is_gdpr_locked = bool(product.is_gdpr_locked)
            has_locked_products = has_locked_products or is_gdpr_locked
            status_counts[product_status] = int(status_counts.get(product_status, 0)) + 1

        line_items.append(
            PosDocumentDetailLineOut(
                id=line.id,
                line_no=line.line_no,
                product_id=line.product_id,
                product_number=line.product_number,
                reference_number=line.reference_number,
                product_type=line.product_type,
                metal_type=line.metal_type,
                weight_grams=line.weight_grams,
                purity_karat=line.purity_karat,
                purity_percentage=line.purity_percentage,
                pure_gold_grams=line.pure_gold_grams,
                rate_dkk=line.rate_dkk,
                margin_percent=line.margin_percent,
                line_total_dkk=line.line_total_dkk,
                product_status=product_status,
                is_gdpr_locked=is_gdpr_locked,
                product_notes=product_notes,
                created_at=line.created_at,
            )
        )

    bank_reg_number, bank_account_number = extract_purchase_bank_info(document.notes or pos_session.notes)
    payment_method = extract_purchase_payment_method(document.notes or pos_session.notes)
    structured_note_source = document.notes or pos_session.notes
    line_gold_rate = max(
        (quantize_2(line.rate_dkk or 0) for line in line_items if str(line.metal_type or "").lower() != "silver"),
        default=Decimal("0.00"),
    )
    line_silver_rate = max(
        (quantize_2(line.rate_dkk or 0) for line in line_items if str(line.metal_type or "").lower() == "silver"),
        default=Decimal("0.00"),
    )
    market_rates = extract_purchase_market_rates(
        structured_note_source,
        default_gold_24k_dkk=line_gold_rate,
        default_silver_dkk=line_silver_rate,
    )
    numbering_preview = extract_purchase_numbering(
        structured_note_source,
        default_afregnings_number=str(1000 + document.sequence_no),
        default_invoice_number="",
    )
    invoice_gold = extract_purchase_invoice_gold_sheet(structured_note_source, market_rates=market_rates)
    invoice_misc = extract_purchase_invoice_misc_sheet(structured_note_source)
    customer_postal_code = document.customer_postal_code
    if customer_postal_code is None:
        customer_postal_code = effective_customer.postal_code
    customer_city = document.customer_city
    if customer_city is None:
        customer_city = effective_customer.city
    can_edit = (
        document.document_type == PosDocumentTypeEnum.PURCHASE_RECEIPT
        and pos_session.status != PosSessionStatusEnum.CANCELLED
        and (transaction is None or transaction.status != "cancelled")
    )
    can_delete = can_edit

    return PosDocumentDetailOut(
        sequence_no=document.sequence_no,
        session_id=pos_session.id,
        session_code=pos_session.session_code,
        trade_side=pos_session.trade_side.value,
        status=(transaction.status if transaction is not None else pos_session.status.value),
        document_type=document.document_type.value,
        document_kind=_document_kind_label(document.document_type),
        document_title=document_title_tr(document.document_type),
        document_number=format_document_number(document),
        customer_name=document.customer_name,
        customer_phone=document.customer_phone,
        customer_email=document.customer_email,
        customer_address=document.customer_address,
        customer_postal_code=customer_postal_code,
        customer_city=customer_city,
        customer_cpr=cpr_plain,
        customer_cpr_masked=cpr_masked,
        customer_identity_doc_number=identity_number_plain,
        customer_identity_doc_number_masked=identity_number_masked,
        bank_reg_number=bank_reg_number,
        bank_account_number=bank_account_number,
        currency_code=document.currency_code,
        gross_amount_dkk=document.gross_amount_dkk,
        net_amount_dkk=document.net_amount_dkk,
        vat_rate_percent=document.vat_rate_percent,
        vat_amount_dkk=document.vat_amount_dkk,
        line_count=len(line_items),
        total_weight_grams=total_weight,
        total_pure_gold_grams=total_pure_gold,
        product_ids=product_ids,
        product_numbers=product_numbers,
        product_status_counts=status_counts,
        operation_state=_document_operation_state(status_counts),
        has_locked_products=has_locked_products,
        notes=extract_purchase_freeform_note(document.notes),
        payment_method=payment_method,
        market_rates=market_rates,
        numbering_preview=numbering_preview,
        invoice_gold=invoice_gold,
        invoice_misc=invoice_misc,
        can_edit=can_edit,
        can_delete=can_delete,
        issued_at=document.issued_at,
        confirmed_at=(transaction.confirmed_at if transaction is not None else pos_session.confirmed_at),
        lines=line_items,
    )


@router.get("/sessions/{session_id}/transaction", response_model=PosTransactionOut | None)
async def get_pos_transaction(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosTransactionOut | None:
    tx = await db.scalar(
        select(Transaction)
        .where(Transaction.pos_session_id == session_id)
        .options(selectinload(Transaction.lines))
    )
    if tx is None:
        return None
    return PosTransactionOut(
        id=tx.id,
        pos_session_id=tx.pos_session_id,
        pos_document_sequence_no=tx.pos_document_sequence_no,
        trade_side=tx.trade_side,
        status=tx.status,
        customer_id=tx.customer_id,
        clerk_user_id=tx.clerk_user_id,
        currency_code=tx.currency_code,
        gross_amount_dkk=tx.gross_amount_dkk,
        net_amount_dkk=tx.net_amount_dkk,
        vat_rate_percent=tx.vat_rate_percent,
        vat_amount_dkk=tx.vat_amount_dkk,
        notes=tx.notes,
        created_at=tx.created_at,
        confirmed_at=tx.confirmed_at,
        lines=[
            PosTransactionLineOut(
                id=line.id,
                line_no=line.line_no,
                product_id=line.product_id,
                product_number=line.product_number,
                reference_number=line.reference_number,
                product_type=line.product_type,
                metal_type=line.metal_type,
                weight_grams=line.weight_grams,
                purity_karat=line.purity_karat,
                purity_percentage=line.purity_percentage,
                pure_gold_grams=line.pure_gold_grams,
                rate_dkk=line.rate_dkk,
                margin_percent=line.margin_percent,
                line_total_dkk=line.line_total_dkk,
                created_at=line.created_at,
            )
            for line in sorted(tx.lines, key=lambda item: item.line_no)
        ],
    )


@router.get("/sessions/{session_id}/receipt")
async def get_pos_receipt(
    session_id: UUID,
    audience: str = Query(default="customer", pattern="^(customer|admin)$"),
    format: str = Query(default="pdf", pattern="^(pdf|html)$"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    pos_session = await get_pos_session_or_404(db, session_id)
    context = await build_pos_receipt_context(db, pos_session=pos_session, audience=audience)

    if format == "html":
        # XSS için ikinci katman: escape'e rağmen belge kendi statik gömülü
        # script'ini çalıştırmasın (renderer zaten kullanıcı verisini kaçırıyor).
        return HTMLResponse(
            content=render_pos_receipt_html(context),
            headers={
                "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:"
            },
        )

    pdf_payload = render_pos_receipt_pdf(context)
    document_number = str(context.get("document_number") or pos_session.session_code).replace("/", "-").replace(" ", "")
    filename = f"seroguld-{document_number}-{audience}.pdf"
    return Response(
        content=pdf_payload,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/sessions/{session_id}/cancel", response_model=PosSessionOutClerk, deprecated=True)
async def post_cancel(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> PosSessionOutClerk:
    pos_session = await get_pos_session_or_404(db, session_id)
    return await cancel_session(db, pos_session=pos_session)


@router.get("/display/{display_token}", response_model=PosSessionDisplayOut)
async def get_display_snapshot(
    display_token: str,
    db: AsyncSession = Depends(get_db),
) -> PosSessionDisplayOut:
    pos_session = await get_pos_session_by_display_token_or_404(db, display_token)
    return await display_snapshot(db, pos_session)


async def _authenticate_admin_ws(token: str | None) -> User | None:
    if not token:
        return None
    try:
        claims = decode_access_token(token)
    except TokenError:
        return None

    user_id = claims.get("sub")
    if not user_id:
        return None
    try:
        user_uuid = UUID(str(user_id))
    except ValueError:
        return None

    async with AsyncSessionLocal() as session:
        user = await session.scalar(select(User).where(User.id == user_uuid, User.is_active.is_(True)))
        if not user or user.role != RoleEnum.ADMIN:
            return None
        return user


def _clerk_websocket_token(websocket: WebSocket) -> tuple[str | None, str | None]:
    """Read the clerk token without putting it in the request URL.

    Browsers cannot set arbitrary WebSocket headers.  They can, however,
    offer subprotocols.  The client offers a fixed protocol followed by the
    JWT; the server authenticates the JWT and echoes only the fixed protocol,
    so access logs and the negotiated response never contain the secret.
    """

    protocols = list(websocket.scope.get("subprotocols") or [])
    if len(protocols) >= 2 and protocols[0] == "seroguld-auth":
        return str(protocols[1] or "").strip() or None, "seroguld-auth"
    return None, None


@router.websocket("/display/{display_token}/ws")
async def display_socket(websocket: WebSocket, display_token: str):
    # 'Oturum yok' (4404) ile 'veritabanı/decrypt arızası' (1011) ayrıştırılır;
    # geniş sessiz close kiosk tarafında kök nedeni izsiz bırakıyordu.
    async with AsyncSessionLocal() as session:
        try:
            await get_pos_session_by_display_token_or_404(session, display_token)
        except HTTPException:
            await websocket.close(code=4404)
            return
        except Exception:
            LOGGER.exception("display ws token çözümlemesi başarısız (token=%s)", display_token)
            await websocket.close(code=1011)
            return

    await realtime_hub.connect_display(display_token, websocket)
    try:
        # Init gönderimi receive döngüsünden AYRI: kurulamayan init, hub'da
        # kopuk kayıt bırakmadan temizlenir.
        try:
            async with AsyncSessionLocal() as session:
                pos_session = await get_pos_session_by_display_token_or_404(session, display_token)
                snapshot = await display_snapshot(session, pos_session)
                await websocket.send_json({"type": "display:init", "data": jsonable_encoder(snapshot)})
        except WebSocketDisconnect:
            raise
        except Exception:
            LOGGER.exception("display ws init snapshot gönderilemedi (token=%s)", display_token)
            await websocket.close(code=1011)
            return

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        # disconnect garanti: her istisna yolunda hub kaydı temizlenir.
        await realtime_hub.disconnect_display(display_token, websocket)


@router.websocket("/sessions/{session_id}/ws")
async def clerk_socket(websocket: WebSocket, session_id: UUID):
    token, accepted_subprotocol = _clerk_websocket_token(websocket)
    user = await _authenticate_admin_ws(token)
    if user is None:
        await websocket.close(code=4401)
        return

    async with AsyncSessionLocal() as session:
        try:
            await get_pos_session_or_404(session, session_id)
        except HTTPException:
            await websocket.close(code=4404)
            return
        except Exception:
            LOGGER.exception("clerk ws oturum çözümlemesi başarısız (session=%s)", session_id)
            await websocket.close(code=1011)
            return

    await realtime_hub.connect_clerk(
        session_id,
        websocket,
        subprotocol=accepted_subprotocol,
    )
    try:
        try:
            async with AsyncSessionLocal() as session:
                pos_session = await get_pos_session_or_404(session, session_id)
                await websocket.send_json({"type": "clerk:init", "data": jsonable_encoder(clerk_snapshot(pos_session))})
        except WebSocketDisconnect:
            raise
        except Exception:
            LOGGER.exception("clerk ws init snapshot gönderilemedi (session=%s)", session_id)
            await websocket.close(code=1011)
            return

        while True:
            raw_message = await websocket.receive_text()
            try:
                event = json.loads(raw_message)
            except json.JSONDecodeError:
                continue

            if not isinstance(event, dict):
                continue
            if event.get("type") != "clerk:preview":
                continue

            payload_data = event.get("data") if isinstance(event.get("data"), dict) else {}
            try:
                preview_payload = PosRealtimePreview.model_validate(payload_data)
            except ValidationError:
                continue

            try:
                async with AsyncSessionLocal() as session:
                    pos_session = await get_pos_session_or_404(session, session_id)
                    display_payload = await build_realtime_display_snapshot(session, pos_session, preview_payload)
                    accepted_preview = realtime_hub.set_display_preview(pos_session.display_token, display_payload)
                    if accepted_preview is None:
                        continue
                    await realtime_hub.broadcast_display(
                        pos_session.display_token,
                        {"type": "display:preview", "data": accepted_preview.snapshot.model_dump(mode="json")},
                    )
            except WebSocketDisconnect:
                raise
            except Exception:
                # Tek bozuk preview mesajı soketi düşürmesin; ama sessiz de
                # kalmasın — ValidationError yutma sadece şema redsi için.
                LOGGER.exception("clerk preview işlenemedi (session=%s)", session_id)
    except WebSocketDisconnect:
        pass
    finally:
        # disconnect garanti: her istisna yolunda hub kaydı temizlenir.
        await realtime_hub.disconnect_clerk(session_id, websocket)
