from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.database import get_db
from app.models.afg_melt_lot import AfgMeltLot
from app.models.afg_melt_lot_history import AfgMeltLotHistory
from app.models.enums import MetalTypeEnum, PosDocumentTypeEnum, ProductStatusEnum, ProductTypeEnum
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.product import Product
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.models.user import User
from app.schemas.afg import (
    AfgClassification,
    AfgLogBucketOut,
    AfgLogBucketSummaryOut,
    AfgLogSplitGroupOut,
    AfgLogWorkspaceOut,
    AfgMeltLotCreateRequest,
    AfgMeltLotOut,
    AfgMeltLotUpdateRequest,
    AfgMeltQueueOut,
    AfgRouteRequest,
    AfgRouteResponse,
    AfgWorkspaceDocumentOut,
    AfgWorkspaceLineOut,
    AfgWorkspaceOut,
    AfgWorkspaceSummaryOut,
)
from app.schemas.product import ProductCreate, ProductStatusUpdate, ProductUpdate
from app.services.pos_document_service import document_title_tr, format_document_number
from app.services.pos_value_helpers import display_metal_type, display_product_type
from app.services.product_service import create_product as create_product_service
from app.services.product_service import get_product_or_404, update_product, update_status
from app.utils.helpers import quantize_2, to_decimal, utc_now

router = APIRouter()

SPLIT_GROUPS: list[tuple[AfgClassification, str]] = [
    ("jewelry_cleaning", "Takı / Cleaning"),
    ("white_gold", "Beyaz Altın"),
    ("separate_storage", "Ayrı Depo"),
]


def _document_kind_label(document_type: PosDocumentTypeEnum) -> str:
    if document_type == PosDocumentTypeEnum.SALE_INVOICE:
        return "faktura"
    return "afregningsbilag"


def _map_destination_to_state(destination: str | None, fallback_status: str | None) -> str:
    if destination == "inventory":
        return "in_inventory"
    if destination == "undecided":
        return "undecided"
    if destination == "melt":
        return "melted"
    if fallback_status == ProductStatusEnum.PURCHASED.value:
        return "awaiting_decision"
    return fallback_status or "awaiting_decision"


def _document_operation_state(lines: list[AfgWorkspaceLineOut]) -> str:
    states = {_map_destination_to_state(line.operation_destination, line.product_status) for line in lines}
    states.discard("")
    if not states:
        return "awaiting_decision"
    if len(states) == 1:
        return next(iter(states))
    return "mixed"


def _line_metal_bucket(line: AfgWorkspaceLineOut) -> str:
    if line.metal_type == MetalTypeEnum.SILVER.value:
        return "silver"
    return "gold"


def _default_classification(line: TransactionLine) -> AfgClassification:
    if line.metal_type == MetalTypeEnum.WHITE_GOLD.value:
        return "white_gold"
    return "standard"


def _default_inventory_category(line: TransactionLine, classification: AfgClassification) -> tuple[str | None, str | None]:
    if line.metal_type == MetalTypeEnum.SILVER.value:
        if line.product_type == ProductTypeEnum.BAR.value:
            return "gumus", "barrer"
        return "gumus", "smykker"
    if line.metal_type == MetalTypeEnum.PLATINUM.value:
        return "platin_pd", "platin"
    if line.metal_type == MetalTypeEnum.PALLADIUM.value:
        return "platin_pd", "palladyum"
    if line.product_type == ProductTypeEnum.BAR.value:
        return "kulce", None
    if classification == "white_gold":
        return "taki", None
    if classification == "jewelry_cleaning":
        return "taki", None
    return "taki" if line.product_type else "kulce", None


def _display_name(line: TransactionLine) -> str:
    return f"{display_product_type(line.product_type)} · {display_metal_type(line.metal_type)}"


def _parse_product_type(value: str | None) -> ProductTypeEnum:
    if value:
        try:
            return ProductTypeEnum(value)
        except ValueError:
            pass
    return ProductTypeEnum.JEWELRY


def _parse_metal_type(value: str | None) -> MetalTypeEnum:
    if value:
        try:
            return MetalTypeEnum(value)
        except ValueError:
            pass
    return MetalTypeEnum.YELLOW_GOLD


def _is_locked_purchase(purchase_date) -> bool:
    return utc_now() < purchase_date + timedelta(days=14)


def _line_out(
    *,
    document: PosDocument,
    session: PosSession,
    transaction: Transaction,
    line: TransactionLine,
    product: Product | None,
) -> AfgWorkspaceLineOut:
    return AfgWorkspaceLineOut(
        id=line.id,
        transaction_id=transaction.id,
        document_sequence_no=document.sequence_no,
        document_number=format_document_number(document),
        session_id=session.id,
        session_code=session.session_code,
        line_no=line.line_no,
        customer_name=document.customer_name,
        customer_phone=document.customer_phone,
        customer_email=document.customer_email,
        issued_at=document.issued_at,
        product_id=(product.id if product is not None else line.product_id),
        product_number=(product.product_number if product is not None else line.product_number),
        reference_number=(product.reference_number if product is not None else line.reference_number),
        product_type=line.product_type,
        metal_type=line.metal_type,
        weight_grams=line.weight_grams,
        purity_karat=line.purity_karat,
        purity_percentage=line.purity_percentage,
        pure_gold_grams=line.pure_gold_grams,
        rate_dkk=line.rate_dkk,
        margin_percent=line.margin_percent,
        line_total_dkk=line.line_total_dkk,
        product_status=(product.status.value if product is not None else None),
        operation_destination=(product.operation_destination if product is not None else None),
        operation_classification=(product.operation_classification if product is not None else None),
        is_gdpr_locked=bool(product.is_gdpr_locked if product is not None else False),
        product_notes=(product.notes if product is not None else None),
        created_at=line.created_at,
    )


async def _fetch_document_bundle(
    db: AsyncSession,
    *,
    q: str | None = None,
    sequence_no: int | None = None,
    limit: int = 200,
) -> list[tuple[PosDocument, PosSession, Transaction, list[AfgWorkspaceLineOut]]]:
    normalized_query = q.strip() if q else ""
    numeric_tokens = re.findall(r"\d+", normalized_query)
    sequence_no_filter = sequence_no if sequence_no is not None else (int(numeric_tokens[-1]) if numeric_tokens else None)

    stmt = (
        select(PosDocument, PosSession, Transaction)
        .join(PosSession, PosSession.id == PosDocument.pos_session_id)
        .join(Transaction, Transaction.pos_document_sequence_no == PosDocument.sequence_no)
        .where(PosDocument.document_type == PosDocumentTypeEnum.PURCHASE_RECEIPT)
        .order_by(PosDocument.issued_at.desc(), PosDocument.sequence_no.desc())
        .limit(limit)
    )
    if sequence_no is not None:
        stmt = stmt.where(PosDocument.sequence_no == sequence_no)
    elif normalized_query:
        like_query = f"%{normalized_query}%"
        filters = [
            PosDocument.customer_name.ilike(like_query),
            PosDocument.customer_email.ilike(like_query),
            PosDocument.customer_phone.ilike(like_query),
            PosSession.session_code.ilike(like_query),
        ]
        if sequence_no_filter is not None:
            filters.append(PosDocument.sequence_no == sequence_no_filter)
        stmt = stmt.where(or_(*filters))

    bundles = (await db.execute(stmt)).all()
    if not bundles:
        return []

    sequence_numbers = [document.sequence_no for document, _, _ in bundles]
    line_rows = (
        await db.execute(
            select(PosDocument, PosSession, Transaction, TransactionLine, Product)
            .join(PosSession, PosSession.id == PosDocument.pos_session_id)
            .join(Transaction, Transaction.pos_document_sequence_no == PosDocument.sequence_no)
            .join(TransactionLine, TransactionLine.transaction_id == Transaction.id)
            .outerjoin(Product, Product.id == TransactionLine.product_id)
            .where(PosDocument.sequence_no.in_(sequence_numbers))
            .order_by(PosDocument.sequence_no.desc(), TransactionLine.line_no.asc())
        )
    ).all()

    line_map: dict[int, list[AfgWorkspaceLineOut]] = {seq: [] for seq in sequence_numbers}
    for document, session, transaction, line, product in line_rows:
        line_map.setdefault(document.sequence_no, []).append(
            _line_out(document=document, session=session, transaction=transaction, line=line, product=product)
        )

    return [(document, session, transaction, line_map.get(document.sequence_no, [])) for document, session, transaction in bundles]


def _workspace_document(
    document: PosDocument,
    session: PosSession,
    transaction: Transaction,
    lines: list[AfgWorkspaceLineOut],
) -> AfgWorkspaceDocumentOut:
    total_weight = quantize_2(sum((to_decimal(line.weight_grams or 0) for line in lines), Decimal("0.00")))
    total_pure = quantize_2(sum((to_decimal(line.pure_gold_grams or 0) for line in lines), Decimal("0.00")))
    return AfgWorkspaceDocumentOut(
        sequence_no=document.sequence_no,
        document_number=format_document_number(document),
        session_id=session.id,
        document_kind=_document_kind_label(document.document_type),
        document_title=document_title_tr(document.document_type),
        status=transaction.status,
        trade_side=session.trade_side.value,
        customer_name=document.customer_name,
        customer_phone=document.customer_phone,
        customer_email=document.customer_email,
        customer_address=document.customer_address,
        issued_at=document.issued_at,
        confirmed_at=transaction.confirmed_at,
        gross_amount_dkk=document.gross_amount_dkk,
        net_amount_dkk=document.net_amount_dkk,
        total_weight_grams=total_weight,
        total_pure_gold_grams=total_pure,
        line_count=len(lines),
        operation_state=_document_operation_state(lines),
        has_locked_products=any(line.is_gdpr_locked for line in lines),
        lines=lines,
    )


def _summary(documents: list[AfgWorkspaceDocumentOut]) -> AfgWorkspaceSummaryOut:
    return AfgWorkspaceSummaryOut(
        total_documents=len(documents),
        awaiting_documents=sum(1 for item in documents if item.operation_state == "awaiting_decision"),
        inventory_documents=sum(1 for item in documents if item.operation_state == "in_inventory"),
        undecided_documents=sum(1 for item in documents if item.operation_state == "undecided"),
        melted_documents=sum(1 for item in documents if item.operation_state == "melted"),
        total_amount_dkk=quantize_2(sum((to_decimal(item.net_amount_dkk) for item in documents), Decimal("0.00"))),
        total_pure_gold_grams=quantize_2(
            sum((to_decimal(item.total_pure_gold_grams or 0) for item in documents), Decimal("0.00"))
        ),
    )


def _line_classification(line: AfgWorkspaceLineOut) -> AfgClassification:
    classification = line.operation_classification
    if classification in {"jewelry_cleaning", "white_gold", "separate_storage"}:
        return classification
    if line.metal_type == MetalTypeEnum.WHITE_GOLD.value:
        return "white_gold"
    return "standard"


def _inventory_split_group_key(classification: str | None, metal_type: str | None = None) -> AfgClassification:
    if classification == "white_gold" or metal_type == MetalTypeEnum.WHITE_GOLD.value:
        return "white_gold"
    if classification == "separate_storage":
        return "separate_storage"
    return "jewelry_cleaning"


def _line_split_group_key(line: AfgWorkspaceLineOut) -> AfgClassification | None:
    if _map_destination_to_state(line.operation_destination, line.product_status) != "in_inventory":
        return None
    return _inventory_split_group_key(line.operation_classification, line.metal_type)


def _sum_line_metrics(lines: list[AfgWorkspaceLineOut]) -> tuple[Decimal, Decimal, Decimal]:
    return (
        quantize_2(sum((to_decimal(line.weight_grams or 0) for line in lines), Decimal("0.00"))),
        quantize_2(sum((to_decimal(line.pure_gold_grams or 0) for line in lines), Decimal("0.00"))),
        quantize_2(sum((to_decimal(line.line_total_dkk or 0) for line in lines), Decimal("0.00"))),
    )


def _split_groups(lines: list[AfgWorkspaceLineOut]) -> list[AfgLogSplitGroupOut]:
    groups: list[AfgLogSplitGroupOut] = []
    for key, label in SPLIT_GROUPS:
        matching = [line for line in lines if _line_split_group_key(line) == key]
        total_weight, total_pure, total_amount = _sum_line_metrics(matching)
        groups.append(
            AfgLogSplitGroupOut(
                key=key,
                label=label,
                line_count=len(matching),
                total_weight_grams=total_weight,
                total_pure_gold_grams=total_pure,
                total_amount_dkk=total_amount,
                document_numbers=sorted({line.document_number for line in matching}),
            )
        )
    return groups


def _melt_queue(lines: list[AfgWorkspaceLineOut]) -> AfgMeltQueueOut:
    melt_lines = [line for line in lines if _map_destination_to_state(line.operation_destination, line.product_status) == "melted"]
    total_weight, total_pure, total_amount = _sum_line_metrics(melt_lines)
    purchase_dates = sorted({line.issued_at.date() for line in melt_lines})
    return AfgMeltQueueOut(
        line_count=len(melt_lines),
        total_weight_grams=total_weight,
        total_pure_gold_grams=total_pure,
        total_amount_dkk=total_amount,
        earliest_purchase_date=(purchase_dates[0] if purchase_dates else None),
        latest_purchase_date=(purchase_dates[-1] if purchase_dates else None),
        document_numbers=sorted({line.document_number for line in melt_lines}),
    )


def _melt_lot_out(lot: AfgMeltLot, line_count: int = 0) -> AfgMeltLotOut:
    cost_total = quantize_2(to_decimal(lot.insurance_dkk) + to_decimal(lot.shipping_dkk) + to_decimal(lot.refining_dkk))
    estimated_sale_value = None
    if lot.quote_eur is not None:
        estimated_sale_value = quantize_2(to_decimal(lot.after_pure_gold_grams) * to_decimal(lot.quote_eur) * to_decimal(lot.exchange_rate_dkk))

    net_after_costs = None
    if lot.payout_total_dkk is not None:
        net_after_costs = quantize_2(to_decimal(lot.payout_total_dkk) - cost_total)
    elif estimated_sale_value is not None:
        net_after_costs = quantize_2(estimated_sale_value - cost_total)

    bridge_difference = None
    advance_per_gram = None
    if net_after_costs is not None:
        bridge_difference = quantize_2(net_after_costs - to_decimal(lot.before_amount_dkk))
        if to_decimal(lot.before_pure_gold_grams) > Decimal("0"):
            advance_per_gram = quantize_2(bridge_difference / to_decimal(lot.before_pure_gold_grams))

    return AfgMeltLotOut(
        id=lot.id,
        metal_bucket=lot.metal_bucket,
        sent_date=lot.sent_date,
        purchased_from_date=lot.purchased_from_date,
        before_weight_grams=quantize_2(lot.before_weight_grams),
        before_amount_dkk=quantize_2(lot.before_amount_dkk),
        before_pure_gold_grams=quantize_2(lot.before_pure_gold_grams),
        after_pure_gold_grams=quantize_2(lot.after_pure_gold_grams),
        insurance_dkk=quantize_2(lot.insurance_dkk),
        shipping_dkk=quantize_2(lot.shipping_dkk),
        refining_dkk=quantize_2(lot.refining_dkk),
        sale_date=lot.sale_date,
        quote_eur=(quantize_2(lot.quote_eur) if lot.quote_eur is not None else None),
        exchange_rate_dkk=lot.exchange_rate_dkk,
        payout_total_dkk=(quantize_2(lot.payout_total_dkk) if lot.payout_total_dkk is not None else None),
        notes=lot.notes,
        cost_total_dkk=cost_total,
        estimated_sale_value_dkk=estimated_sale_value,
        net_after_costs_dkk=net_after_costs,
        bridge_difference_dkk=bridge_difference,
        advance_per_gram_dkk=advance_per_gram,
        status=getattr(lot, "status", "draft") or "draft",
        finalized_at=getattr(lot, "finalized_at", None),
        finalized_by_user_id=getattr(lot, "finalized_by_user_id", None),
        line_count=line_count,
        created_at=lot.created_at,
        updated_at=lot.updated_at,
    )


async def _log_lot_history(
    db: AsyncSession,
    *,
    lot_id: UUID,
    action: str,
    actor: User | None = None,
    old_value: dict | None = None,
    new_value: dict | None = None,
    notes: str | None = None,
) -> None:
    entry = AfgMeltLotHistory(
        lot_id=lot_id,
        action=action,
        old_value=old_value,
        new_value=new_value,
        performed_by=(actor.id if actor else None),
        performed_by_email=(actor.email if actor else None),
        notes=notes,
    )
    db.add(entry)


async def _load_melt_lots(db: AsyncSession, metal_bucket: str) -> list[AfgMeltLotOut]:
    from sqlalchemy import func as sa_func

    lots = (
        await db.execute(
            select(AfgMeltLot)
            .where(AfgMeltLot.metal_bucket == metal_bucket)
            .order_by(AfgMeltLot.sent_date.desc(), AfgMeltLot.created_at.desc())
        )
    ).scalars().all()
    if not lots:
        return []
    counts_stmt = (
        select(TransactionLine.melt_lot_id, sa_func.count(TransactionLine.id))
        .where(TransactionLine.melt_lot_id.in_([lot.id for lot in lots]))
        .group_by(TransactionLine.melt_lot_id)
    )
    counts: dict[UUID, int] = {row[0]: int(row[1]) for row in (await db.execute(counts_stmt)).all() if row[0]}
    return [_melt_lot_out(lot, line_count=counts.get(lot.id, 0)) for lot in lots]


def _bucket_documents(documents: list[AfgWorkspaceDocumentOut], metal_bucket: str) -> list[AfgWorkspaceDocumentOut]:
    filtered_documents: list[AfgWorkspaceDocumentOut] = []
    for item in documents:
        lines = [line for line in item.lines if _line_metal_bucket(line) == metal_bucket]
        if not lines:
            continue
        total_weight, total_pure, _ = _sum_line_metrics(lines)
        filtered_documents.append(
            item.model_copy(
                update={
                    "lines": lines,
                    "line_count": len(lines),
                    "total_weight_grams": total_weight,
                    "total_pure_gold_grams": total_pure,
                    "operation_state": _document_operation_state(lines),
                    "has_locked_products": any(line.is_gdpr_locked for line in lines),
                }
            )
        )
    return filtered_documents


def _bucket_summary(
    documents: list[AfgWorkspaceDocumentOut],
    split_groups: list[AfgLogSplitGroupOut],
    melt_queue: AfgMeltQueueOut,
    melt_lot_count: int,
) -> AfgLogBucketSummaryOut:
    lines = [line for document in documents for line in document.lines]
    total_weight, total_pure, total_amount = _sum_line_metrics(lines)
    routed_lines = [
        line
        for line in lines
        if line.operation_destination is not None
        or (line.product_status is not None and line.product_status != ProductStatusEnum.PURCHASED.value)
    ]
    split_line_count = sum(group.line_count for group in split_groups)
    return AfgLogBucketSummaryOut(
        total_documents=len(documents),
        total_lines=len(lines),
        awaiting_lines=max(len(lines) - len(routed_lines), 0),
        routed_lines=len(routed_lines),
        split_line_count=split_line_count,
        melt_line_count=melt_queue.line_count,
        melt_lot_count=melt_lot_count,
        total_weight_grams=total_weight,
        total_pure_gold_grams=total_pure,
        total_amount_dkk=total_amount,
    )


async def build_log_workspace(
    db: AsyncSession,
    *,
    q: str | None = None,
    year: int | None = None,
    limit: int = 200,
) -> AfgLogWorkspaceOut:
    bundles = await _fetch_document_bundle(db, q=q, limit=limit)
    documents = [_workspace_document(document, session, transaction, lines) for document, session, transaction, lines in bundles]

    if year is not None:
        documents = [d for d in documents if d.issued_at and d.issued_at.year == year]

    gold_documents = _bucket_documents(documents, "gold")
    silver_documents = _bucket_documents(documents, "silver")

    gold_splits = _split_groups([line for document in gold_documents for line in document.lines])
    silver_splits = _split_groups([line for document in silver_documents for line in document.lines])

    gold_melt_queue = _melt_queue([line for document in gold_documents for line in document.lines])
    silver_melt_queue = _melt_queue([line for document in silver_documents for line in document.lines])

    gold_lots = await _load_melt_lots(db, "gold")
    silver_lots = await _load_melt_lots(db, "silver")

    return AfgLogWorkspaceOut(
        summary=_summary(documents),
        gold=AfgLogBucketOut(
            metal_bucket="gold",
            summary=_bucket_summary(gold_documents, gold_splits, gold_melt_queue, len(gold_lots)),
            documents=gold_documents,
            split_groups=gold_splits,
            melt_queue=gold_melt_queue,
            melt_lots=gold_lots,
        ),
        silver=AfgLogBucketOut(
            metal_bucket="silver",
            summary=_bucket_summary(silver_documents, silver_splits, silver_melt_queue, len(silver_lots)),
            documents=silver_documents,
            split_groups=silver_splits,
            melt_queue=silver_melt_queue,
            melt_lots=silver_lots,
        ),
    )


async def create_afg_melt_lot(
    db: AsyncSession,
    *,
    payload: AfgMeltLotCreateRequest,
    actor: User | None = None,
) -> AfgMeltLotOut:
    workspace = await build_log_workspace(db, limit=400)
    bucket = workspace.gold if payload.metal_bucket == "gold" else workspace.silver
    if bucket.melt_queue.line_count == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bu metal havuzunda eritme kuyruğu boş")

    lot = AfgMeltLot(
        metal_bucket=payload.metal_bucket,
        sent_date=payload.sent_date or utc_now().date(),
        purchased_from_date=payload.purchased_from_date or bucket.melt_queue.earliest_purchase_date,
        before_weight_grams=bucket.melt_queue.total_weight_grams,
        before_amount_dkk=bucket.melt_queue.total_amount_dkk,
        before_pure_gold_grams=bucket.melt_queue.total_pure_gold_grams,
        after_pure_gold_grams=bucket.melt_queue.total_pure_gold_grams,
        notes=(payload.notes.strip() if payload.notes else None),
    )
    db.add(lot)
    await db.flush()

    # Eritme kuyruğundaki bağlanmamış transaction line'ları bu lot'a otomatik bağla
    attach_stmt = (
        select(TransactionLine.id)
        .join(Product, Product.id == TransactionLine.product_id)
        .where(
            Product.status == ProductStatusEnum.MELTED,
            TransactionLine.melt_lot_id.is_(None),
            (Product.metal_type == MetalTypeEnum.SILVER)
            if payload.metal_bucket == "silver"
            else (Product.metal_type != MetalTypeEnum.SILVER),
        )
    )
    line_ids = list((await db.execute(attach_stmt)).scalars().all())
    if line_ids:
        await db.execute(
            TransactionLine.__table__.update()
            .where(TransactionLine.id.in_(line_ids))
            .values(melt_lot_id=lot.id)
        )

    await _log_lot_history(
        db,
        lot_id=lot.id,
        action="created",
        actor=actor,
        new_value={
            "metal_bucket": lot.metal_bucket,
            "sent_date": lot.sent_date.isoformat(),
            "before_pure_gold_grams": str(lot.before_pure_gold_grams),
            "attached_line_count": len(line_ids),
        },
    )
    await db.commit()
    await db.refresh(lot)
    return _melt_lot_out(lot, line_count=len(line_ids))


def _serialize_lot_snapshot(lot: AfgMeltLot) -> dict:
    return {
        "sent_date": lot.sent_date.isoformat() if lot.sent_date else None,
        "purchased_from_date": (
            lot.purchased_from_date.isoformat() if lot.purchased_from_date else None
        ),
        "after_pure_gold_grams": str(lot.after_pure_gold_grams or 0),
        "insurance_dkk": str(lot.insurance_dkk or 0),
        "shipping_dkk": str(lot.shipping_dkk or 0),
        "refining_dkk": str(lot.refining_dkk or 0),
        "sale_date": lot.sale_date.isoformat() if lot.sale_date else None,
        "quote_eur": (str(lot.quote_eur) if lot.quote_eur is not None else None),
        "exchange_rate_dkk": str(lot.exchange_rate_dkk or 0),
        "payout_total_dkk": (
            str(lot.payout_total_dkk) if lot.payout_total_dkk is not None else None
        ),
        "notes": lot.notes,
        "status": getattr(lot, "status", "draft"),
    }


async def update_afg_melt_lot(
    db: AsyncSession,
    *,
    lot_id: UUID,
    payload: AfgMeltLotUpdateRequest,
    actor: User | None = None,
) -> AfgMeltLotOut:
    lot = await db.get(AfgMeltLot, lot_id)
    if lot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Eritme lotu bulunamadı")

    if getattr(lot, "status", "draft") == "finalized":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kesinleştirilmiş lot düzenlenemez. Önce lotu yeniden açın.",
        )

    if payload.expected_updated_at is not None and lot.updated_at is not None:
        expected = payload.expected_updated_at
        current = lot.updated_at
        try:
            if expected.tzinfo is None:
                expected = expected.replace(tzinfo=current.tzinfo)
            diff = abs((current - expected).total_seconds())
        except Exception:  # noqa: BLE001
            diff = None
        if diff is None or diff > 1.0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "stale_lot",
                    "message": "Bu lot başka bir kullanıcı tarafından güncellenmiş.",
                    "current_updated_at": current.isoformat(),
                },
            )

    old_snapshot = _serialize_lot_snapshot(lot)

    for field_name, value in payload.model_dump(exclude_unset=True).items():
        if field_name == "expected_updated_at":
            continue
        if value is None and field_name in {"sent_date", "exchange_rate_dkk"}:
            continue
        setattr(lot, field_name, value)

    await _log_lot_history(
        db,
        lot_id=lot.id,
        action="updated",
        actor=actor,
        old_value=old_snapshot,
        new_value=_serialize_lot_snapshot(lot),
    )
    await db.commit()
    await db.refresh(lot)

    from sqlalchemy import func as sa_func

    line_count = int(
        (
            await db.execute(
                select(sa_func.count(TransactionLine.id)).where(
                    TransactionLine.melt_lot_id == lot.id
                )
            )
        ).scalar_one()
        or 0
    )
    return _melt_lot_out(lot, line_count=line_count)


async def finalize_afg_melt_lot(
    db: AsyncSession,
    *,
    lot_id: UUID,
    actor: User | None = None,
    reverse: bool = False,
) -> AfgMeltLotOut:
    lot = await db.get(AfgMeltLot, lot_id)
    if lot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Eritme lotu bulunamadı")

    current_status = getattr(lot, "status", "draft") or "draft"
    if reverse:
        if current_status != "finalized":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Lot zaten taslak durumda. Geri alma uygulanmadı.",
            )
        lot.status = "draft"
        lot.finalized_at = None
        lot.finalized_by_user_id = None
        action = "reopened"
    else:
        if current_status == "finalized":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Lot zaten kesinleştirilmiş.",
            )
        # Sale_date + payout_total + quote alanları dolu olmalı
        if lot.payout_total_dkk is None or lot.sale_date is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Kesinleştirme için ödeme toplamı ve satış tarihi zorunludur.",
            )
        lot.status = "finalized"
        lot.finalized_at = utc_now()
        lot.finalized_by_user_id = actor.id if actor else None
        action = "finalized"

    await _log_lot_history(
        db,
        lot_id=lot.id,
        action=action,
        actor=actor,
        new_value={"status": lot.status},
    )
    await db.commit()
    await db.refresh(lot)

    from sqlalchemy import func as sa_func

    line_count = int(
        (
            await db.execute(
                select(sa_func.count(TransactionLine.id)).where(
                    TransactionLine.melt_lot_id == lot.id
                )
            )
        ).scalar_one()
        or 0
    )
    return _melt_lot_out(lot, line_count=line_count)


async def delete_afg_melt_lot(
    db: AsyncSession,
    *,
    lot_id: UUID,
    actor: User | None = None,
) -> None:
    lot = await db.get(AfgMeltLot, lot_id)
    if lot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Eritme lotu bulunamadı")
    if getattr(lot, "status", "draft") == "finalized":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kesinleştirilmiş lot silinemez. Önce lotu yeniden açın.",
        )

    # Bağlı satırlarda lot referansını temizle
    await db.execute(
        TransactionLine.__table__.update()
        .where(TransactionLine.melt_lot_id == lot.id)
        .values(melt_lot_id=None)
    )

    # History log (silmeden önce, FK temiz)
    await _log_lot_history(
        db,
        lot_id=lot.id,
        action="deleted",
        actor=actor,
        old_value=_serialize_lot_snapshot(lot),
    )
    await db.flush()

    await db.delete(lot)
    await db.commit()


async def list_afg_melt_lot_history(
    db: AsyncSession,
    *,
    lot_id: UUID,
    limit: int = 50,
):
    from app.schemas.afg import AfgMeltLotHistoryOut

    stmt = (
        select(AfgMeltLotHistory)
        .where(AfgMeltLotHistory.lot_id == lot_id)
        .order_by(AfgMeltLotHistory.created_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [
        AfgMeltLotHistoryOut(
            id=entry.id,
            lot_id=entry.lot_id,
            action=entry.action,
            old_value=entry.old_value if isinstance(entry.old_value, dict) else None,
            new_value=entry.new_value if isinstance(entry.new_value, dict) else None,
            performed_by=entry.performed_by,
            performed_by_email=entry.performed_by_email,
            notes=entry.notes,
            created_at=entry.created_at,
        )
        for entry in rows
    ]


async def list_afg_melt_lot_lines(
    db: AsyncSession,
    *,
    lot_id: UUID,
):
    from app.schemas.afg import AfgMeltLotLineOut

    stmt = (
        select(TransactionLine, Transaction, PosDocument, PosSession, User)
        .join(Transaction, Transaction.id == TransactionLine.transaction_id)
        .join(PosDocument, PosDocument.sequence_no == Transaction.pos_document_sequence_no)
        .join(PosSession, PosSession.id == PosDocument.pos_session_id)
        .outerjoin(User, User.id == PosSession.customer_id)
        .where(TransactionLine.melt_lot_id == lot_id)
        .order_by(PosDocument.sequence_no.asc(), TransactionLine.line_no.asc())
    )
    rows = (await db.execute(stmt)).all()
    return [
        AfgMeltLotLineOut(
            line_id=line.id,
            document_sequence_no=doc.sequence_no,
            document_number=getattr(doc, "document_number", "") or "",
            line_no=line.line_no,
            weight_grams=line.weight_grams,
            pure_gold_grams=line.pure_gold_grams,
            line_total_dkk=line.line_total_dkk,
            customer_name=getattr(customer, "name", None) if customer else None,
            product_number=line.product_number,
            reference_number=line.reference_number,
        )
        for line, _tx, doc, _sess, customer in rows
    ]


@router.get("/workspace", response_model=AfgWorkspaceOut)
async def get_afg_workspace(
    q: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=400),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> AfgWorkspaceOut:
    bundles = await _fetch_document_bundle(db, q=q, limit=limit)
    documents = [_workspace_document(document, session, transaction, lines) for document, session, transaction, lines in bundles]

    gold_documents: list[AfgWorkspaceDocumentOut] = []
    silver_documents: list[AfgWorkspaceDocumentOut] = []
    for item in documents:
        gold_lines = [line for line in item.lines if _line_metal_bucket(line) == "gold"]
        silver_lines = [line for line in item.lines if _line_metal_bucket(line) == "silver"]
        if gold_lines:
            gold_documents.append(item.model_copy(update={
                "lines": gold_lines,
                "line_count": len(gold_lines),
                "total_weight_grams": quantize_2(sum((to_decimal(line.weight_grams or 0) for line in gold_lines), Decimal("0.00"))),
                "total_pure_gold_grams": quantize_2(sum((to_decimal(line.pure_gold_grams or 0) for line in gold_lines), Decimal("0.00"))),
                "operation_state": _document_operation_state(gold_lines),
                "has_locked_products": any(line.is_gdpr_locked for line in gold_lines),
            }))
        if silver_lines:
            silver_documents.append(item.model_copy(update={
                "lines": silver_lines,
                "line_count": len(silver_lines),
                "total_weight_grams": quantize_2(sum((to_decimal(line.weight_grams or 0) for line in silver_lines), Decimal("0.00"))),
                "total_pure_gold_grams": quantize_2(sum((to_decimal(line.pure_gold_grams or 0) for line in silver_lines), Decimal("0.00"))),
                "operation_state": _document_operation_state(silver_lines),
                "has_locked_products": any(line.is_gdpr_locked for line in silver_lines),
            }))

    return AfgWorkspaceOut(
        summary=_summary(documents),
        gold_documents=gold_documents,
        silver_documents=silver_documents,
    )


@router.get("/documents/{sequence_no}", response_model=AfgWorkspaceDocumentOut)
async def get_afg_document_detail(
    sequence_no: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> AfgWorkspaceDocumentOut:
    bundles = await _fetch_document_bundle(db, sequence_no=sequence_no, limit=1)
    if not bundles:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Belge bulunamadı")
    document, session, transaction, lines = bundles[0]
    return _workspace_document(document, session, transaction, lines)


async def _get_route_product_or_404(db: AsyncSession, product_id: UUID) -> Product:
    product = await db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ürün bulunamadı")
    return product


async def apply_afg_route_requests_safe(
    *,
    db: AsyncSession,
    route_requests: list[AfgRouteRequest],
    actor_id,
) -> tuple[AfgRouteResponse, list[tuple[UUID, str]]]:
    """`apply_afg_route_requests`'in partial-failure raporlayan varyantı.

    Tek bir savepoint açar; her satır hatasında savepoint'e rollback edip
    failure listesine ekler. Başarılı satırlar persist olur. AtomicAll-or-Nothing
    isteyen çağıranlar `apply_afg_route_requests` kullanmaya devam etmeli.
    """
    failures: list[tuple[UUID, str]] = []

    if not route_requests:
        return AfgRouteResponse(), failures

    successes: list[AfgRouteRequest] = []
    for req in route_requests:
        try:
            async with db.begin_nested():
                resp = await apply_afg_route_requests(
                    db=db,
                    route_requests=[req],
                    actor_id=actor_id,
                )
                successes.extend(req for _ in resp.processed_line_ids)
        except HTTPException as exc:  # noqa: PERF203
            for line_id in req.line_ids:
                detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
                failures.append((line_id, detail))
        except Exception as exc:  # noqa: BLE001
            for line_id in req.line_ids:
                failures.append((line_id, str(exc)))

    # build aggregate AfgRouteResponse
    processed: list[UUID] = []
    product_ids: list[UUID] = []
    statuses: dict[str, int] = {}
    if successes:
        # Tüm başarılı satırlar zaten persist; sayım için son state'i sorgula
        from sqlalchemy import func as sa_func

        all_ids: list[UUID] = []
        for req in successes:
            all_ids.extend(req.line_ids)
        processed = list({lid for lid in all_ids})

        rows = (
            await db.execute(
                select(TransactionLine.product_id, Product.status)
                .join(Product, Product.id == TransactionLine.product_id)
                .where(TransactionLine.id.in_(processed))
            )
        ).all()
        for pid, status_enum in rows:
            if pid is not None:
                product_ids.append(pid)
            key = status_enum.value if hasattr(status_enum, "value") else str(status_enum)
            statuses[key] = statuses.get(key, 0) + 1
        _ = sa_func  # unused

    return (
        AfgRouteResponse(
            processed_line_ids=processed,
            product_ids=list({pid for pid in product_ids}),
            statuses=statuses,
        ),
        failures,
    )


async def apply_afg_route_requests(
    *,
    db: AsyncSession,
    route_requests: list[AfgRouteRequest],
    actor_id,
) -> AfgRouteResponse:
    if not route_requests:
        return AfgRouteResponse()

    line_request_map: dict[UUID, AfgRouteRequest] = {}
    for request in route_requests:
        for line_id in request.line_ids:
            if line_id in line_request_map:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Aynı satır birden fazla kez gönderilemez")
            line_request_map[line_id] = request

    line_rows = (
        await db.execute(
            select(TransactionLine, Transaction, PosDocument, PosSession, Product)
            .join(Transaction, Transaction.id == TransactionLine.transaction_id)
            .join(PosDocument, PosDocument.sequence_no == Transaction.pos_document_sequence_no)
            .join(PosSession, PosSession.id == PosDocument.pos_session_id)
            .outerjoin(Product, Product.id == TransactionLine.product_id)
            .where(TransactionLine.id.in_(tuple(line_request_map.keys())))
            .order_by(PosDocument.sequence_no.asc(), TransactionLine.line_no.asc())
        )
    ).all()

    if len(line_rows) != len(line_request_map):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bir veya daha fazla AFG satırı bulunamadı")

    processed_line_ids: list[UUID] = []
    product_ids: list[UUID] = []
    status_counts: dict[str, int] = {}

    try:
        for line, transaction, document, pos_session, linked_product in line_rows:
            payload = line_request_map[line.id]
            purchase_date = transaction.confirmed_at or document.issued_at
            # GDPR 14 gün penceresi eritme dahil hiçbir rotayı engellemez
            # (0.3.8: yalnız bilgi rozetleri kalır).

            classification = payload.classification or _default_classification(line)
            category, subcategory = _default_inventory_category(line, classification)
            inventory_category = payload.inventory_category or category
            inventory_subcategory = payload.inventory_subcategory or subcategory
            route_note = payload.note.strip() if payload.note else None

            if linked_product is None:
                created = await create_product_service(
                    db,
                    ProductCreate(
                        reference_number=line.reference_number,
                        display_name=_display_name(line),
                        product_type=_parse_product_type(line.product_type),
                        metal_type=_parse_metal_type(line.metal_type),
                        weight_grams=to_decimal(line.weight_grams or 0),
                        purity_karat=line.purity_karat,
                        purity_percentage=(to_decimal(line.purity_percentage) if line.purity_percentage is not None else None),
                        unit_count=1,
                        total_weight_grams=(to_decimal(line.weight_grams) if line.weight_grams is not None else None),
                        purchase_date=purchase_date,
                        purchase_price_dkk=to_decimal(line.line_total_dkk),
                        gold_rate_at_purchase=(to_decimal(line.rate_dkk) if line.rate_dkk is not None else None),
                        commission=to_decimal(line.margin_percent or 0),
                        seller_customer_id=transaction.customer_id,
                        notes=route_note,
                        storage_location=payload.storage_location,
                        needs_cleaning=(classification == "jewelry_cleaning"),
                        producer=payload.producer,
                        inventory_category=inventory_category,
                        inventory_subcategory=inventory_subcategory,
                        operation_destination=payload.destination,
                        operation_classification=classification,
                    ),
                    actor_id,
                    commit=False,
                )
                linked_product = await _get_route_product_or_404(db, created.id)
            else:
                linked_product = await _get_route_product_or_404(db, linked_product.id)
                linked_product_out = await update_product(
                    db,
                    linked_product,
                    ProductUpdate(
                        display_name=linked_product.display_name or _display_name(line),
                        notes=route_note,
                        clear_notes=route_note is None,
                        storage_location=payload.storage_location if payload.storage_location is not None else linked_product.storage_location,
                        needs_cleaning=(classification == "jewelry_cleaning"),
                        producer=payload.producer if payload.producer is not None else linked_product.producer,
                        inventory_category=inventory_category,
                        inventory_subcategory=inventory_subcategory,
                        operation_destination=payload.destination,
                        operation_classification=classification,
                    ),
                    actor_id,
                    commit=False,
                )
                linked_product = await _get_route_product_or_404(db, linked_product_out.id)

            if payload.destination == "inventory" and linked_product.status != ProductStatusEnum.IN_INVENTORY:
                updated = await update_status(
                    db,
                    linked_product,
                    ProductStatusUpdate(status=ProductStatusEnum.IN_INVENTORY),
                    actor_id,
                    commit=False,
                )
                linked_product = await _get_route_product_or_404(db, updated.id)
            elif payload.destination == "undecided" and linked_product.status != ProductStatusEnum.UNDECIDED:
                updated = await update_status(
                    db,
                    linked_product,
                    ProductStatusUpdate(status=ProductStatusEnum.UNDECIDED),
                    actor_id,
                    commit=False,
                )
                linked_product = await _get_route_product_or_404(db, updated.id)
            elif payload.destination == "melt" and linked_product.status != ProductStatusEnum.MELTED:
                updated = await update_status(
                    db,
                    linked_product,
                    ProductStatusUpdate(
                        status=ProductStatusEnum.MELTED,
                        melt_reason=route_note or "AFG operasyon merkezinden eritmeye ayrildi",
                    ),
                    actor_id,
                    commit=False,
                )
                linked_product = await _get_route_product_or_404(db, updated.id)

            line.product_id = linked_product.id
            line.product_number = linked_product.product_number
            line.reference_number = linked_product.reference_number

            # M3 — Eğer satır eritmeye gidiyorsa ve aynı metal bucket için açık bir
            # draft lot varsa otomatik bağla. Yoksa orphan kalır (sonraki create_afg_melt_lot
            # bunu zaten yakalar).
            if payload.destination == "melt":
                metal_bucket = "silver" if linked_product.metal_type == MetalTypeEnum.SILVER else "gold"
                draft_lot_id = (
                    await db.execute(
                        select(AfgMeltLot.id)
                        .where(
                            AfgMeltLot.metal_bucket == metal_bucket,
                            AfgMeltLot.status == "draft",
                        )
                        .order_by(AfgMeltLot.created_at.desc())
                        .limit(1)
                    )
                ).scalar_one_or_none()
                if draft_lot_id is not None and line.melt_lot_id is None:
                    line.melt_lot_id = draft_lot_id

            await db.flush()

            processed_line_ids.append(line.id)
            product_ids.append(linked_product.id)
            status_key = linked_product.status.value
            status_counts[status_key] = int(status_counts.get(status_key, 0)) + 1
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    return AfgRouteResponse(
        processed_line_ids=processed_line_ids,
        product_ids=product_ids,
        statuses=status_counts,
    )


@router.post("/lines/route", response_model=AfgRouteResponse)
async def post_afg_lines_route(
    payload: AfgRouteRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> AfgRouteResponse:
    return await apply_afg_route_requests(
        db=db,
        route_requests=[payload],
        actor_id=admin.id,
    )
