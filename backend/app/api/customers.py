from __future__ import annotations

import asyncio
from math import ceil
import re
import secrets
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, case, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.database import get_db
from app.models.ai_usage_log import AIUsageLog
from app.models.customer_activity import CustomerActivityEvent
from app.models.customer_identity import CustomerIdentityDocument
from app.models.customer_note import CustomerNote, CustomerNoteRevision
from app.models.pos_document import PosDocument
from app.models.pos_document_audit import PosDocumentAudit
from app.models.pos_session import PosSession
from app.models.pos_session_line import PosSessionLine
from app.models.pos_session_product_link import PosSessionProductLink
from app.models.product import Product
from app.models.product_history import ProductHistory
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.models.enums import MetalTypeEnum, PosDocumentTypeEnum, PosSessionStatusEnum, ProductStatusEnum, RoleEnum
from app.models.user import User
from app.schemas.customer import (
    CustomerCreate,
    CustomerDetailOut,
    CustomerListResponse,
    CustomerNoteCreate,
    CustomerNoteListOut,
    CustomerNoteOut,
    CustomerNoteRevisionOut,
    CustomerNoteUpdate,
    CustomerOut,
    CustomerTransactionListOut,
    CustomerTransactionOut,
    CustomerWorkspaceOut,
    CustomerWooImportRequest,
    CustomerWooImportResponse,
    CustomerUpdate,
)
from app.schemas.pos import PosDocumentListItemOut
from app.services.customer_service import (
    create_customer,
    get_customer_detail,
    to_customer_out,
    to_customer_out_list,
    update_customer,
)
from app.services.customer_statement_renderer import render_customer_statement_pdf
from app.services.pos_document_service import document_title_tr, format_document_number
from app.services.pos_workspace_state import _parse_workspace_note_payload, _workspace_calculators_from_note
from app.services.woocommerce import WooCommerceService
from app.utils.security import get_password_hash, hash_cpr, hash_sensitive_value

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

    # M2: silme sırası FK'lara saygılı — ondelete tanımsız referanslar
    # (transactions.pos_session_id, transactions.customer_id, pos_documents,
    # pos_session_lines, pos_document_audits, customer_activity_events)
    # oturum/kullanıcı silinmeden temizlenir; aksi halde IntegrityError → 500.
    # Mock temizliği artık commit atmadan çağıranın transaction'ında kalır:
    # Woo verisi başarıyla çekilmeden veri silinmez.
    transaction_filters = [Transaction.customer_id.in_(candidate_ids)]
    if session_ids:
        transaction_filters.append(Transaction.pos_session_id.in_(session_ids))
    transaction_ids = list(
        (await db.scalars(select(Transaction.id).where(or_(*transaction_filters)))).all()
    )
    if transaction_ids:
        await db.execute(delete(TransactionLine).where(TransactionLine.transaction_id.in_(transaction_ids)))
        await db.execute(delete(Transaction).where(Transaction.id.in_(transaction_ids)))

    if session_ids:
        await db.execute(delete(PosDocumentAudit).where(PosDocumentAudit.pos_session_id.in_(session_ids)))
        await db.execute(delete(PosSessionLine).where(PosSessionLine.pos_session_id.in_(session_ids)))

    activity_filters = [CustomerActivityEvent.customer_id.in_(candidate_ids)]
    if session_ids:
        activity_filters.append(CustomerActivityEvent.pos_session_id.in_(session_ids))
    await db.execute(delete(CustomerActivityEvent).where(or_(*activity_filters)))

    if session_ids:
        await db.execute(delete(PosDocument).where(PosDocument.pos_session_id.in_(session_ids)))
        await db.execute(delete(PosSessionProductLink).where(PosSessionProductLink.pos_session_id.in_(session_ids)))
        await db.execute(delete(PosSession).where(PosSession.id.in_(session_ids)))

    # Nullable kullanıcı referansları (denetçi bulgusu): mock kullanıcıya
    # işaret eden audit kolonları silmeden NULL'a çekilir.
    await db.execute(update(PosDocumentAudit).where(PosDocumentAudit.actor_user_id.in_(candidate_ids)).values(actor_user_id=None))
    await db.execute(update(Transaction).where(Transaction.clerk_user_id.in_(candidate_ids)).values(clerk_user_id=None))

    await db.execute(delete(CustomerIdentityDocument).where(CustomerIdentityDocument.user_id.in_(candidate_ids)))
    await db.execute(delete(User).where(User.id.in_(candidate_ids)))
    return len(candidate_ids)


@router.get("", response_model=CustomerListResponse)
async def get_customers(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    sort_by: Literal["created_at", "recent_activity"] = Query(default="created_at"),
    customer_status: Literal["active", "inactive", "all"] = Query(default="active", alias="status"),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> CustomerListResponse:
    status_filters = [User.role == RoleEnum.CUSTOMER]
    if customer_status == "active":
        status_filters.append(User.is_active.is_(True))
    elif customer_status == "inactive":
        status_filters.append(User.is_active.is_(False))
    base = select(User).where(*status_filters)
    total = await db.scalar(select(func.count(User.id)).where(*status_filters))

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
            .where(*status_filters)
            .order_by(last_activity_subquery.c.last_activity_at.desc().nullslast(), User.created_at.desc())
        )
    else:
        base = base.order_by(User.created_at.desc())

    rows = await db.scalars(base.offset((page - 1) * page_size).limit(page_size))

    # M2: liste yüzeyi maskeli + tek toplu identity sorgusu (plaintext CPR
    # ifşası ve N+1 decrypt sorgu maliyeti birlikte giderilir).
    items = await to_customer_out_list(db, rows.all(), masked=True)
    total_int = int(total or 0)
    return CustomerListResponse(
        items=items,
        page=page,
        page_size=page_size,
        total=total_int,
        total_pages=max(1, ceil(total_int / page_size)),
    )


async def _inactive_email_conflict_or_original(db: AsyncSession, email: str | None, exc: HTTPException) -> HTTPException:
    """A6-3: 409 e-posta çakışmasını pasif kayıt ipucuyla zenginleştir.

    Pasife alınan müşteriye aynı e-postayla yeni kayıt açılamaz (unique e-posta);
    mesaj bunun pasif bir kayıt olduğunu ve yeniden aktifleştirme yolunu gösterir.
    """
    if exc.status_code != status.HTTP_409_CONFLICT:
        return exc
    normalized = (email or "").strip().lower()
    if not normalized:
        return exc
    await db.rollback()
    existing = await db.scalar(select(User).where(User.role == RoleEnum.CUSTOMER, User.email == normalized))
    if existing is not None and not existing.is_active:
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Bu e-posta pasife alınmış bir müşteri kaydında kayıtlı. Yeni kayıt açmak yerine "
                "müşteriyi 'Pasif' filtresinden bulup 'Yeniden aktifleştir' ile geri açabilirsiniz."
            ),
        )
    return exc


@router.post("", response_model=CustomerOut, status_code=status.HTTP_201_CREATED)
async def post_customer(
    payload: CustomerCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> CustomerOut:
    try:
        customer = await create_customer(db, payload)
    except HTTPException as exc:
        raise await _inactive_email_conflict_or_original(db, str(payload.email) if payload.email else None, exc) from exc
    await db.commit()
    await db.refresh(customer)
    return await to_customer_out(db, customer)


@router.get("/search", response_model=list[CustomerOut])
async def search_customers(
    q: str = Query(min_length=2),
    customer_status: Literal["active", "inactive", "all"] = Query(default="active", alias="status"),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> list[CustomerOut]:
    query_text = q.strip()
    if not query_text:
        return []
    pattern = f"%{query_text}%"
    lowered = query_text.lower()
    status_predicates = [User.role == RoleEnum.CUSTOMER]
    if customer_status == "active":
        status_predicates.append(User.is_active.is_(True))
    elif customer_status == "inactive":
        status_predicates.append(User.is_active.is_(False))
    predicates = [
        *status_predicates,
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
            *status_predicates,
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
                *status_predicates,
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
    # M2: arama yüzeyi de maskeli + toplu identity eşlemesi.
    return await to_customer_out_list(db, rows.all(), masked=True)


@router.post("/import/woocommerce-live", response_model=CustomerWooImportResponse)
async def import_woocommerce_customers(
    payload: CustomerWooImportRequest,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> CustomerWooImportResponse:
    wc_service = WooCommerceService()
    wc_customers = await wc_service.fetch_customers(limit=payload.limit)

    # M2: mock temizliği Woo verisi başarıyla çekildikten SONRA yapılır ve
    # commit atmadan içe aktarım transaction'ında kalır — fetch 502 dönerse
    # mock veri silinmiş ama import'suz kalmış durum oluşmaz.
    if payload.replace_mock_seed:
        deleted_mock_seed = await _delete_mock_customers(db)
    else:
        deleted_mock_seed = 0

    created = 0
    updated = 0
    skipped = 0
    imported_customer_ids: list[str] = []
    errors: list[str] = []
    # A6-1: kod içine gömülü "WooImport123!" fallback'i kaldırıldı. .env okunamazsa
    # içe aktarım sessizce bilinen bir şifreye düşemez — tek seferlik rastgele şifre
    # üretilir ve içe aktarılan müşteri must_change_password ile ilk girişte
    # değiştirmeye zorlanır.
    env_password = _env_value("CUSTOMER_IMPORT_DEFAULT_PASSWORD")
    import_password = env_password or secrets.token_urlsafe(16)
    # M2: bcrypt yüzlerce ms sürer — hash İÇE AKTARIM BAŞINA BİR KEZ üretilir,
    # her satırda senkron olarak yeniden hesaplanmaz.
    import_password_hash = await asyncio.to_thread(get_password_hash, import_password)

    import_commit_batch = 100
    pending_import_rows = 0

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

            # M2: satır başına savepoint — hatalı satır yalnız kendisini geri
            # alır; parça bekleyen satırlar korunur ve sayaçlar doğru kalır.
            # Per-row commit/refresh yerine 100'lük partilerde tek commit:
            # istek süresi kısalır, bağlantı koparsa en fazla bir parti kayıptır.
            async with db.begin_nested():
                existing = await db.scalar(select(User).where(User.role == RoleEnum.CUSTOMER, User.email == email))
                if not existing and phone:
                    existing = await db.scalar(
                        select(User).where(User.role == RoleEnum.CUSTOMER, User.phone == phone, User.name == name).limit(1)
                    )

                if existing:
                    # A6-2: güncelleme payload'ı yalnız Woo'dan GELEN dolu alanlarla
                    # kurulur — eksik Woo alanı (None) yerel değeri NULL'a çekmez,
                    # is_active üzerine yazılmaz (pasif müşteri sessizce açılmaz).
                    # Kaynaktan zorla eşitleme ancak açık bayrakla (force_source_values).
                    update_fields: dict[str, Any] = {"name": name, "email": email}
                    if payload.force_source_values:
                        update_fields["phone"] = phone
                        update_fields["address"] = address
                        update_fields["is_active"] = True
                    else:
                        if phone is not None:
                            update_fields["phone"] = phone
                        if address is not None:
                            update_fields["address"] = address
                    update_payload = CustomerUpdate(**update_fields)
                    updated_user = await update_customer(db, existing, update_payload)
                    updated_user.woocommerce_customer_id = str(wc_id) if wc_id > 0 else updated_user.woocommerce_customer_id
                    row_user_id = updated_user.id
                    updated += 1
                else:
                    create_payload = CustomerCreate(
                        name=name,
                        email=email,
                        phone=phone,
                        address=address,
                        password=import_password,
                    )
                    created_user = await create_customer(db, create_payload, password_hash=import_password_hash)
                    created_user.woocommerce_customer_id = str(wc_id) if wc_id > 0 else None
                    created_user.must_change_password = True
                    row_user_id = created_user.id
                    created += 1

            imported_customer_ids.append(str(row_user_id))
            pending_import_rows += 1
            if pending_import_rows >= import_commit_batch:
                await db.commit()
                pending_import_rows = 0
        except Exception as exc:
            # Savepoint hatalı satırı zaten geri aldı; parça commit'i bozulmaz.
            if wc_id <= 0:
                skipped += 1
            else:
                errors.append(f"wc_customer_id={wc_id}: {exc}")

    if pending_import_rows or deleted_mock_seed:
        await db.commit()

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
            historical_imported_at=document.historical_imported_at,
            uniconta_sync_status=document.uniconta_sync_status,
            uniconta_invoice_number=document.uniconta_invoice_number,
            uniconta_account=document.uniconta_account,
            uniconta_pdf_available=bool(document.uniconta_pdf_path),
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
    try:
        customer = await update_customer(db, customer, payload)
    except HTTPException as exc:
        raise await _inactive_email_conflict_or_original(db, str(payload.email) if payload.email else None, exc) from exc
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


async def _customer_record(db: AsyncSession, customer_id: UUID) -> User:
    customer = await db.get(User, customer_id)
    if not customer or customer.role != RoleEnum.CUSTOMER:
        raise HTTPException(status_code=404, detail="Müşteri bulunamadı")
    return customer


async def _note_payloads(db: AsyncSession, notes: list[CustomerNote]) -> list[CustomerNoteOut]:
    actor_ids = {note.author_user_id for note in notes if note.author_user_id}
    actors = {user.id: user.name for user in (await db.scalars(select(User).where(User.id.in_(actor_ids)))).all()} if actor_ids else {}
    return [CustomerNoteOut(
        id=note.id,
        customer_id=note.customer_id,
        author_user_id=note.author_user_id,
        author_name=actors.get(note.author_user_id, "Sistem"),
        body=note.body,
        version=note.version,
        created_at=note.created_at,
        updated_at=note.updated_at,
        deleted_at=note.deleted_at,
    ) for note in notes]


@router.get("/{customer_id}/workspace", response_model=CustomerWorkspaceOut)
async def get_customer_workspace(customer_id: UUID, db: AsyncSession = Depends(get_db), _=Depends(require_admin)) -> CustomerWorkspaceOut:
    customer = await _customer_record(db, customer_id)
    detail = await get_customer_detail(db, customer)
    visible = Product.deleted_at.is_(None)
    purchase_count, purchase_amount, gold_grams, silver_grams, platinum_grams, palladium_grams = (await db.execute(select(
        func.count(Product.id),
        func.coalesce(func.sum(Product.purchase_price_dkk), Decimal("0")),
        func.coalesce(func.sum(case((Product.metal_type.in_((MetalTypeEnum.YELLOW_GOLD, MetalTypeEnum.WHITE_GOLD)), Product.weight_grams), else_=0)), Decimal("0")),
        func.coalesce(func.sum(case((Product.metal_type == MetalTypeEnum.SILVER, Product.weight_grams), else_=0)), Decimal("0")),
        func.coalesce(func.sum(case((Product.metal_type == MetalTypeEnum.PLATINUM, Product.weight_grams), else_=0)), Decimal("0")),
        func.coalesce(func.sum(case((Product.metal_type == MetalTypeEnum.PALLADIUM, Product.weight_grams), else_=0)), Decimal("0")),
    ).where(Product.seller_customer_id == customer_id, visible))).one()
    sale_count, sale_amount = (await db.execute(select(
        func.count(Product.id), func.coalesce(func.sum(Product.sale_price_dkk), Decimal("0"))
    ).where(Product.buyer_customer_id == customer_id, visible))).one()
    document_count = await db.scalar(select(func.count(PosDocument.sequence_no)).join(PosSession, PosSession.id == PosDocument.pos_session_id).where(PosSession.customer_id == customer_id))
    note_count = await db.scalar(select(func.count(CustomerNote.id)).where(CustomerNote.customer_id == customer_id, CustomerNote.deleted_at.is_(None)))
    last_purchase = await db.scalar(select(func.max(Product.purchase_date)).where(Product.seller_customer_id == customer_id, visible))
    last_sale = await db.scalar(select(func.max(Product.sale_date)).where(Product.buyer_customer_id == customer_id, visible))
    last_transaction_at = max([value for value in (last_purchase, last_sale) if value is not None], default=None)

    knife_count = Decimal("0")
    knife_total_weight = Decimal("0")
    session_notes = await db.scalars(
        select(PosSession.notes).where(
            PosSession.customer_id == customer_id,
            PosSession.status == PosSessionStatusEnum.CONFIRMED,
        )
    )
    for notes in session_notes:
        calculators = _workspace_calculators_from_note(_parse_workspace_note_payload(notes))
        for row in calculators.gold_rows:
            knife_count += row.count
            knife_total_weight += row.total_weight

    return CustomerWorkspaceOut(
        customer=detail,
        purchase_count=int(purchase_count or 0),
        purchase_amount_dkk=str(purchase_amount or 0),
        sale_count=int(sale_count or 0),
        sale_amount_dkk=str(sale_amount or 0),
        total_gold_grams=str(gold_grams or 0),
        total_silver_grams=str(silver_grams or 0),
        total_platinum_grams=str(platinum_grams or 0),
        total_palladium_grams=str(palladium_grams or 0),
        knife_count=str(knife_count),
        knife_total_weight_grams=str(knife_total_weight),
        document_count=int(document_count or 0),
        note_count=int(note_count or 0),
        last_transaction_at=last_transaction_at,
    )


@router.get("/{customer_id}/transactions", response_model=CustomerTransactionListOut)
async def get_customer_transactions(
    customer_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, ge=1, le=100),
    side: Literal["all", "buy_from_customer", "sell_to_customer"] = Query(default="all"),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> CustomerTransactionListOut:
    await _customer_record(db, customer_id)
    side_filter = Product.seller_customer_id == customer_id if side == "buy_from_customer" else Product.buyer_customer_id == customer_id if side == "sell_to_customer" else or_(Product.seller_customer_id == customer_id, Product.buyer_customer_id == customer_id)
    query = select(Product).where(side_filter, Product.deleted_at.is_(None))
    total = int(await db.scalar(select(func.count()).select_from(query.subquery())) or 0)
    products = (await db.scalars(query.order_by(Product.updated_at.desc()).offset((page - 1) * page_size).limit(page_size))).all()
    items = []
    for product in products:
        resolved_side = "buy_from_customer" if product.seller_customer_id == customer_id else "sell_to_customer"
        amount = product.purchase_price_dkk if resolved_side == "buy_from_customer" else product.sale_price_dkk or 0
        happened_at = product.purchase_date if resolved_side == "buy_from_customer" else product.sale_date or product.updated_at
        items.append(CustomerTransactionOut(
            id=product.id,
            side=resolved_side,
            product_number=product.product_number,
            reference_number=product.reference_number,
            product_type=product.product_type.value,
            metal_type=product.metal_type.value,
            weight_grams=str(product.weight_grams),
            purity_karat=product.purity_karat,
            amount_dkk=str(amount),
            status=product.status.value,
            transaction_at=happened_at,
        ))
    return CustomerTransactionListOut(items=items, page=page, page_size=page_size, total=total, total_pages=max(1, ceil(total / page_size)))


@router.get("/{customer_id}/documents", response_model=list[PosDocumentListItemOut])
async def get_customer_documents(customer_id: UUID, limit: int = Query(default=100, ge=1, le=300), db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)) -> list[PosDocumentListItemOut]:
    return await get_customer_history(customer_id=customer_id, limit=limit, db=db, _=admin)


@router.get("/{customer_id}/notes", response_model=CustomerNoteListOut)
async def get_customer_notes(customer_id: UUID, limit: int = Query(default=100, ge=1, le=200), db: AsyncSession = Depends(get_db), _=Depends(require_admin)) -> CustomerNoteListOut:
    await _customer_record(db, customer_id)
    total = int(await db.scalar(select(func.count(CustomerNote.id)).where(CustomerNote.customer_id == customer_id, CustomerNote.deleted_at.is_(None))) or 0)
    notes = (await db.scalars(select(CustomerNote).where(CustomerNote.customer_id == customer_id, CustomerNote.deleted_at.is_(None)).order_by(CustomerNote.created_at.desc()).limit(limit))).all()
    return CustomerNoteListOut(items=await _note_payloads(db, list(notes)), total=total)


@router.post("/{customer_id}/notes", response_model=CustomerNoteOut, status_code=status.HTTP_201_CREATED)
async def post_customer_note(customer_id: UUID, payload: CustomerNoteCreate, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)) -> CustomerNoteOut:
    await _customer_record(db, customer_id)
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=422, detail="Not boş bırakılamaz")
    note = CustomerNote(customer_id=customer_id, author_user_id=admin.id, body=body)
    db.add(note)
    await db.flush()
    db.add(CustomerNoteRevision(note_id=note.id, customer_id=customer_id, actor_user_id=admin.id, action="created", body_snapshot=body, version=1))
    await db.commit()
    await db.refresh(note)
    return (await _note_payloads(db, [note]))[0]


@router.put("/{customer_id}/notes/{note_id}", response_model=CustomerNoteOut)
async def put_customer_note(customer_id: UUID, note_id: UUID, payload: CustomerNoteUpdate, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)) -> CustomerNoteOut:
    note = await db.scalar(select(CustomerNote).where(CustomerNote.id == note_id, CustomerNote.customer_id == customer_id, CustomerNote.deleted_at.is_(None)))
    if not note:
        raise HTTPException(status_code=404, detail="Not bulunamadı")
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=422, detail="Not boş bırakılamaz")
    # M2: atomik compare-and-swap — version kontrolü tek UPDATE ... WHERE
    # version=:base ifadesindedir (check-then-write race'i kapalıdır). Aynı
    # base_version ile koşan iki istekten yalnız biri geçer; diğeri 409 alır
    # ve revizyon zincirine aynı version'la iki 'updated' snapshot düşemez.
    previous_body = note.body
    previous_version = note.version
    result = await db.execute(
        update(CustomerNote)
        .where(
            CustomerNote.id == note_id,
            CustomerNote.customer_id == customer_id,
            CustomerNote.deleted_at.is_(None),
            CustomerNote.version == payload.base_version,
        )
        .values(body=body, author_user_id=admin.id, version=CustomerNote.version + 1)
    )
    if result.rowcount == 0:
        still_there = await db.scalar(
            select(CustomerNote).where(
                CustomerNote.id == note_id,
                CustomerNote.customer_id == customer_id,
                CustomerNote.deleted_at.is_(None),
            )
        )
        if still_there is None:
            raise HTTPException(status_code=404, detail="Not bulunamadı")
        raise HTTPException(status_code=409, detail="Not başka bir kullanıcı tarafından güncellendi")
    db.add(CustomerNoteRevision(note_id=note.id, customer_id=customer_id, actor_user_id=admin.id, action="updated", body_snapshot=previous_body, version=previous_version))
    await db.commit()
    await db.refresh(note)
    return (await _note_payloads(db, [note]))[0]


@router.delete("/{customer_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_customer_note(customer_id: UUID, note_id: UUID, base_version: int = Query(ge=1), db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)) -> Response:
    note = await db.scalar(select(CustomerNote).where(CustomerNote.id == note_id, CustomerNote.customer_id == customer_id, CustomerNote.deleted_at.is_(None)))
    if not note:
        raise HTTPException(status_code=404, detail="Not bulunamadı")
    # M2: silmede de atomik CAS (put ile aynı gerekçe).
    previous_body = note.body
    previous_version = note.version
    result = await db.execute(
        update(CustomerNote)
        .where(
            CustomerNote.id == note_id,
            CustomerNote.customer_id == customer_id,
            CustomerNote.deleted_at.is_(None),
            CustomerNote.version == base_version,
        )
        .values(deleted_at=func.now(), version=CustomerNote.version + 1)
    )
    if result.rowcount == 0:
        still_there = await db.scalar(
            select(CustomerNote).where(
                CustomerNote.id == note_id,
                CustomerNote.customer_id == customer_id,
                CustomerNote.deleted_at.is_(None),
            )
        )
        if still_there is None:
            raise HTTPException(status_code=404, detail="Not bulunamadı")
        raise HTTPException(status_code=409, detail="Not başka bir kullanıcı tarafından güncellendi")
    db.add(CustomerNoteRevision(note_id=note.id, customer_id=customer_id, actor_user_id=admin.id, action="deleted", body_snapshot=previous_body, version=previous_version))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{customer_id}/notes/{note_id}/revisions", response_model=list[CustomerNoteRevisionOut])
async def get_customer_note_revisions(customer_id: UUID, note_id: UUID, db: AsyncSession = Depends(get_db), _=Depends(require_admin)) -> list[CustomerNoteRevisionOut]:
    revisions = (await db.scalars(select(CustomerNoteRevision).where(CustomerNoteRevision.customer_id == customer_id, CustomerNoteRevision.note_id == note_id).order_by(CustomerNoteRevision.created_at.desc()))).all()
    actor_ids = {item.actor_user_id for item in revisions if item.actor_user_id}
    actors = {user.id: user.name for user in (await db.scalars(select(User).where(User.id.in_(actor_ids)))).all()} if actor_ids else {}
    return [CustomerNoteRevisionOut(id=item.id, note_id=item.note_id, action=item.action, body_snapshot=item.body_snapshot, version=item.version, actor_user_id=item.actor_user_id, actor_name=actors.get(item.actor_user_id, "Sistem"), created_at=item.created_at) for item in revisions]


@router.get("/{customer_id}/statement.pdf")
async def get_customer_statement_pdf(customer_id: UUID, from_date: date | None = Query(default=None, alias="from"), to_date: date | None = Query(default=None, alias="to"), db: AsyncSession = Depends(get_db), _=Depends(require_admin)) -> Response:
    customer = await _customer_record(db, customer_id)
    customer_out = await to_customer_out(db, customer)
    products = (await db.scalars(select(Product).where(or_(Product.seller_customer_id == customer_id, Product.buyer_customer_id == customer_id), Product.deleted_at.is_(None)).order_by(Product.updated_at.desc()))).all()
    rows: list[dict[str, str]] = []
    for product in products:
        is_purchase = product.seller_customer_id == customer_id
        happened_at = product.purchase_date if is_purchase else product.sale_date or product.updated_at
        if from_date and happened_at.date() < from_date:
            continue
        if to_date and happened_at.date() > to_date:
            continue
        rows.append({"date": happened_at.strftime("%d.%m.%Y"), "side": "Müşteriden alış" if is_purchase else "Müşteriye satış", "reference": product.reference_number or product.product_number, "weight": f"{product.weight_grams} g", "amount": str(product.purchase_price_dkk if is_purchase else product.sale_price_dkk or 0)})
    period = f"{from_date.isoformat() if from_date else 'Başlangıç'} - {to_date.isoformat() if to_date else 'Bugün'}"
    pdf = render_customer_statement_pdf(customer=customer_out, rows=rows, period=period)
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="customer-{customer_id}-statement.pdf"'})
