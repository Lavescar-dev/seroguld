from __future__ import annotations

from math import ceil
import re
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import and_, case, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.database import get_db
from app.models.ai_usage_log import AIUsageLog
from app.models.customer_activity import CustomerActivityEvent
from app.models.customer_identity import CustomerIdentityDocument
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.pos_session_product_link import PosSessionProductLink
from app.models.product import Product
from app.models.product_history import ProductHistory
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.models.enums import PosDocumentTypeEnum, ProductStatusEnum, RoleEnum
from app.models.user import User
from app.schemas.customer import (
    CustomerCreate,
    CustomerDetailOut,
    CustomerListResponse,
    CustomerOut,
    CustomerWooImportRequest,
    CustomerWooImportResponse,
    CustomerUpdate,
)
from app.schemas.pos import PosDocumentListItemOut
from app.services.customer_service import create_customer, get_customer_detail, to_customer_out, update_customer
from app.services.pos_document_service import document_title_tr, format_document_number
from app.services.woocommerce import WooCommerceService
from app.utils.security import hash_cpr, hash_sensitive_value

router = APIRouter()


def _env_value(key: str) -> str:
    env_path = Path(__file__).resolve().parents[3] / ".env"
    if not env_path.exists():
        return ""
    try:
        content = env_path.read_text(encoding="utf-8")
    except Exception:
        return ""
    match = re.search(rf"^{re.escape(key)}=(.*)$", content, flags=re.MULTILINE)
    if not match:
        return ""
    return match.group(1).strip().strip("\"").strip("'")


def _wc_customer_name(payload: dict[str, Any]) -> str:
    first_name = str(payload.get("first_name") or "").strip()
    last_name = str(payload.get("last_name") or "").strip()
    billing = payload.get("billing") if isinstance(payload.get("billing"), dict) else {}
    billing_first = str((billing or {}).get("first_name") or "").strip()
    billing_last = str((billing or {}).get("last_name") or "").strip()

    base = " ".join(part for part in [first_name or billing_first, last_name or billing_last] if part).strip()
    if base:
        return base

    username = str(payload.get("username") or "").strip()
    if username:
        return username

    email = str(payload.get("email") or "").strip()
    if email:
        return email.split("@")[0]

    wc_id = int(payload.get("id") or 0)
    return f"Woo Customer {wc_id}"


def _wc_customer_phone(payload: dict[str, Any]) -> str | None:
    billing = payload.get("billing") if isinstance(payload.get("billing"), dict) else {}
    phone = str((billing or {}).get("phone") or "").strip()
    return phone or None


def _wc_customer_address(payload: dict[str, Any]) -> str | None:
    billing = payload.get("billing") if isinstance(payload.get("billing"), dict) else {}
    if not billing:
        return None
    parts = [
        str(billing.get("address_1") or "").strip(),
        str(billing.get("address_2") or "").strip(),
        str(billing.get("city") or "").strip(),
        str(billing.get("state") or "").strip(),
        str(billing.get("postcode") or "").strip(),
        str(billing.get("country") or "").strip(),
    ]
    address = ", ".join(part for part in parts if part)
    return address or None


def _wc_customer_email(payload: dict[str, Any]) -> str:
    email = str(payload.get("email") or "").strip().lower()
    if email:
        return email
    wc_id = int(payload.get("id") or 0)
    return f"woo-customer-{wc_id}@import.seroguld"


def _is_mock_customer(user: User) -> bool:
    name = (user.name or "").lower()
    email = (user.email or "").lower()
    return (
        name.startswith("mock muster")
        or name.startswith("receipt test")
        or email.startswith("mock.customer.")
        or email.endswith("@local.seroguld")
    )


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


async def _delete_mock_customers(db: AsyncSession) -> int:
    rows = await db.scalars(select(User).where(User.role == RoleEnum.CUSTOMER))
    candidates = [user for user in rows.all() if _is_mock_customer(user)]
    candidate_ids = [user.id for user in candidates]
    if not candidate_ids:
        return 0

    await db.execute(update(Product).where(Product.seller_customer_id.in_(candidate_ids)).values(seller_customer_id=None))
    await db.execute(update(Product).where(Product.buyer_customer_id.in_(candidate_ids)).values(buyer_customer_id=None))
    await db.execute(update(ProductHistory).where(ProductHistory.performed_by.in_(candidate_ids)).values(performed_by=None))
    await db.execute(update(AIUsageLog).where(AIUsageLog.performed_by.in_(candidate_ids)).values(performed_by=None))

    session_ids = list((await db.scalars(select(PosSession.id).where(PosSession.customer_id.in_(candidate_ids)))).all())
    if session_ids:
        await db.execute(delete(PosSessionProductLink).where(PosSessionProductLink.pos_session_id.in_(session_ids)))
        await db.execute(delete(PosSession).where(PosSession.id.in_(session_ids)))

    await db.execute(delete(CustomerActivityEvent).where(CustomerActivityEvent.customer_id.in_(candidate_ids)))
    await db.execute(delete(CustomerIdentityDocument).where(CustomerIdentityDocument.user_id.in_(candidate_ids)))
    await db.execute(delete(User).where(User.id.in_(candidate_ids)))
    await db.commit()
    return len(candidate_ids)


@router.get("", response_model=CustomerListResponse)
async def get_customers(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    sort_by: Literal["created_at", "recent_activity"] = Query(default="created_at"),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> CustomerListResponse:
    base = select(User).where(User.role == RoleEnum.CUSTOMER, User.is_active.is_(True))
    total = await db.scalar(
        select(func.count(User.id)).where(User.role == RoleEnum.CUSTOMER, User.is_active.is_(True))
    )

    if sort_by == "recent_activity":
        last_activity_subquery = (
            select(
                CustomerActivityEvent.customer_id.label("customer_id"),
                func.max(CustomerActivityEvent.created_at).label("last_activity_at"),
            )
            .group_by(CustomerActivityEvent.customer_id)
            .subquery()
        )
        base = (
            select(User)
            .outerjoin(last_activity_subquery, last_activity_subquery.c.customer_id == User.id)
            .where(User.role == RoleEnum.CUSTOMER, User.is_active.is_(True))
            .order_by(last_activity_subquery.c.last_activity_at.desc().nullslast(), User.created_at.desc())
        )
    else:
        base = base.order_by(User.created_at.desc())

    rows = await db.scalars(base.offset((page - 1) * page_size).limit(page_size))

    items = [await to_customer_out(db, user) for user in rows.all()]
    total_int = int(total or 0)
    return CustomerListResponse(
        items=items,
        page=page,
        page_size=page_size,
        total=total_int,
        total_pages=max(1, ceil(total_int / page_size)),
    )


@router.post("", response_model=CustomerOut, status_code=status.HTTP_201_CREATED)
async def post_customer(
    payload: CustomerCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> CustomerOut:
    customer = await create_customer(db, payload)
    await db.commit()
    await db.refresh(customer)
    return await to_customer_out(db, customer)


@router.get("/search", response_model=list[CustomerOut])
async def search_customers(
    q: str = Query(min_length=2),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> list[CustomerOut]:
    query_text = q.strip()
    if not query_text:
        return []
    pattern = f"%{query_text}%"
    lowered = query_text.lower()
    predicates = [
        User.role == RoleEnum.CUSTOMER,
        User.is_active.is_(True),
        or_(
            User.name.ilike(pattern),
            User.phone.ilike(pattern),
            User.email.ilike(pattern),
            User.postal_code.ilike(pattern),
        ),
    ]

    digits = "".join(ch for ch in q if ch.isdigit())
    if digits:
        predicates = [
            User.role == RoleEnum.CUSTOMER,
            User.is_active.is_(True),
            or_(
                User.name.ilike(pattern),
                User.phone.ilike(pattern),
                User.email.ilike(pattern),
                User.postal_code.ilike(pattern),
                User.cpr_hash == hash_cpr(digits),
            ),
        ]
    else:
        doc_hash = hash_sensitive_value(q.strip())
        if doc_hash:
            predicates = [
                User.role == RoleEnum.CUSTOMER,
                User.is_active.is_(True),
                or_(
                    User.name.ilike(pattern),
                    User.phone.ilike(pattern),
                    User.email.ilike(pattern),
                    User.postal_code.ilike(pattern),
                    User.id.in_(
                        select(CustomerIdentityDocument.user_id).where(
                            CustomerIdentityDocument.identity_doc_number_hash == doc_hash
                        )
                    ),
                ),
            ]

    relevance = case(
        (func.lower(User.name) == lowered, 0),
        (func.lower(User.phone) == lowered, 1),
        (func.lower(User.email) == lowered, 2),
        (func.lower(User.name).like(f"{lowered}%"), 3),
        (func.lower(User.phone).like(f"{lowered}%"), 4),
        (func.lower(User.email).like(f"{lowered}%"), 5),
        else_=10,
    )

    rows = await db.scalars(
        select(User).where(and_(*predicates)).order_by(relevance.asc(), User.created_at.desc()).limit(25)
    )
    return [await to_customer_out(db, item) for item in rows.all()]


@router.post("/import/woocommerce-live", response_model=CustomerWooImportResponse)
async def import_woocommerce_customers(
    payload: CustomerWooImportRequest,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> CustomerWooImportResponse:
    if payload.replace_mock_seed:
        deleted_mock_seed = await _delete_mock_customers(db)
    else:
        deleted_mock_seed = 0

    wc_service = WooCommerceService()
    wc_customers = await wc_service.fetch_customers(limit=payload.limit)

    created = 0
    updated = 0
    skipped = 0
    imported_customer_ids: list[str] = []
    errors: list[str] = []
    default_password = _env_value("CUSTOMER_IMPORT_DEFAULT_PASSWORD") or "WooImport123!"

    for wc_customer in wc_customers:
        wc_id = int(wc_customer.get("id") or 0)
        try:
            role = str(wc_customer.get("role") or "").strip().lower()
            if role and role != "customer":
                skipped += 1
                continue

            email = _wc_customer_email(wc_customer)
            name = _wc_customer_name(wc_customer)
            phone = _wc_customer_phone(wc_customer)
            address = _wc_customer_address(wc_customer)

            existing = await db.scalar(select(User).where(User.role == RoleEnum.CUSTOMER, User.email == email))
            if not existing and phone:
                existing = await db.scalar(
                    select(User).where(User.role == RoleEnum.CUSTOMER, User.phone == phone, User.name == name).limit(1)
                )

            if existing:
                update_payload = CustomerUpdate(
                    name=name,
                    email=email,
                    phone=phone,
                    address=address,
                    is_active=True,
                )
                updated_user = await update_customer(db, existing, update_payload)
                updated_user.woocommerce_customer_id = str(wc_id) if wc_id > 0 else updated_user.woocommerce_customer_id
                await db.commit()
                await db.refresh(updated_user)
                updated += 1
                imported_customer_ids.append(str(updated_user.id))
                continue

            create_payload = CustomerCreate(
                name=name,
                email=email,
                phone=phone,
                address=address,
                password=default_password,
            )
            created_user = await create_customer(db, create_payload)
            created_user.woocommerce_customer_id = str(wc_id) if wc_id > 0 else None
            await db.commit()
            await db.refresh(created_user)
            created += 1
            imported_customer_ids.append(str(created_user.id))
        except Exception as exc:
            await db.rollback()
            if wc_id <= 0:
                skipped += 1
            else:
                errors.append(f"wc_customer_id={wc_id}: {exc}")

    return CustomerWooImportResponse(
        fetched=len(wc_customers),
        created=created,
        updated=updated,
        skipped=skipped,
        deleted_mock_seed=deleted_mock_seed,
        imported_customer_ids=imported_customer_ids,
        errors=errors[:50],
    )


@router.get("/{customer_id}", response_model=CustomerDetailOut)
async def get_customer(
    customer_id: UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> CustomerDetailOut:
    customer = await db.get(User, customer_id)
    if not customer or customer.role != RoleEnum.CUSTOMER:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Müşteri bulunamadı")
    return await get_customer_detail(db, customer)


@router.get("/{customer_id}/history", response_model=list[PosDocumentListItemOut])
async def get_customer_history(
    customer_id: UUID,
    limit: int = Query(default=100, ge=1, le=300),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> list[PosDocumentListItemOut]:
    customer = await db.get(User, customer_id)
    if not customer or customer.role != RoleEnum.CUSTOMER:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Müşteri bulunamadı")

    line_count_subquery = (
        select(
            Transaction.pos_document_sequence_no.label("sequence_no"),
            func.count(TransactionLine.id).label("line_count"),
        )
        .outerjoin(TransactionLine, TransactionLine.transaction_id == Transaction.id)
        .where(Transaction.pos_document_sequence_no.is_not(None), Transaction.customer_id == customer_id)
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
        .join(Transaction, Transaction.pos_document_sequence_no == PosDocument.sequence_no)
        .outerjoin(line_count_subquery, line_count_subquery.c.sequence_no == PosDocument.sequence_no)
        .where(Transaction.customer_id == customer_id)
        .order_by(PosDocument.issued_at.desc(), PosDocument.sequence_no.desc())
        .limit(limit)
    )

    rows = (await db.execute(stmt)).all()
    sequence_numbers = [document.sequence_no for document, _, _, _ in rows]
    related_products: dict[int, dict[str, object]] = {
        sequence_no: _empty_document_product_meta() for sequence_no in sequence_numbers
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
            meta = related_products.setdefault(int(sequence_no), _empty_document_product_meta())
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


@router.put("/{customer_id}", response_model=CustomerOut)
async def put_customer(
    customer_id: UUID,
    payload: CustomerUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> CustomerOut:
    customer = await db.get(User, customer_id)
    if not customer or customer.role != RoleEnum.CUSTOMER:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Müşteri bulunamadı")
    customer = await update_customer(db, customer, payload)
    await db.commit()
    await db.refresh(customer)
    return await to_customer_out(db, customer)


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_customer(
    customer_id: UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> Response:
    customer = await db.get(User, customer_id)
    if not customer or customer.role != RoleEnum.CUSTOMER:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Müşteri bulunamadı")
    customer.is_active = False
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
