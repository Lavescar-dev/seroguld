from __future__ import annotations

import secrets
import uuid
from datetime import timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.customer_activity import CustomerActivityEvent
from app.models.customer_identity import CustomerIdentityDocument
from app.models.enums import ProductStatusEnum, RoleEnum
from app.models.product import Product
from app.models.user import User
from app.schemas.customer import (
    CustomerCreate,
    CustomerDetailOut,
    CustomerOut,
    CustomerRiskOut,
    CustomerStats,
    CustomerUpdate,
)
from app.schemas.address import CustomerMatchItemOut, CustomerMatchOut
from app.utils.helpers import utc_now
from app.utils.security import (
    decrypt_field,
    encrypt_field,
    get_password_hash,
    hash_cpr,
    hash_sensitive_value,
    mask_cpr,
    mask_last4,
)


def _normalize_generated_email() -> str:
    return f"customer-{uuid.uuid4().hex[:12]}@local.seroguld"


def _digits_only(value: str | None) -> str:
    return "".join(ch for ch in (value or "") if ch.isdigit())


def _normalize_phone(value: str | None) -> str | None:
    raw = (value or "").strip()
    if not raw:
        return None
    digits = _digits_only(raw)
    if not digits:
        return raw
    if raw.startswith("+"):
        return f"+{digits}"
    return digits


def _normalize_postal_code(value: str | None) -> str | None:
    raw = (value or "").strip()
    if not raw:
        return None
    if not raw.isdigit() or len(raw) != 4:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Posta kodu boş veya tam 4 rakam olmalı.",
        )
    return raw


def _normalize_cpr(value: str | None) -> str | None:
    digits = _digits_only(value)
    return digits or None


def _normalize_city(value: str | None) -> str | None:
    return (value or "").strip() or None


def _validate_customer_identity_inputs(
    *,
    phone: str | None,
    cpr: str | None,
    identity_doc_number: str | None,
) -> None:
    phone_digits = _digits_only(phone)
    if phone is not None and phone.strip() and (not phone_digits or len(phone_digits) < 7 or len(phone_digits) > 15):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Telefon formatı geçersiz (7-15 rakam).",
        )

    cpr_digits = _normalize_cpr(cpr)
    if cpr is not None and cpr.strip() and (cpr_digits is None or len(cpr_digits) != 10):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="CPR formatı geçersiz (10 rakam).",
        )

    if identity_doc_number is not None and identity_doc_number.strip() and len(identity_doc_number.strip()) < 4:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Kimlik belge numarası en az 4 karakter olmalı.",
        )


def _customer_out(user: User, identity: CustomerIdentityDocument | None) -> CustomerOut:
    cpr_plain = decrypt_field(user.cpr_number_encrypted)
    address_plain = decrypt_field(user.address_encrypted)
    identity_number = decrypt_field(identity.identity_doc_number_encrypted) if identity else None

    return CustomerOut(
        id=user.id,
        email=user.email,
        name=user.name,
        phone=user.phone,
        address=address_plain,
        postal_code=user.postal_code,
        city=user.city,
        cpr_number=cpr_plain,
        cpr_number_masked=mask_cpr(cpr_plain),
        identity_doc_type=(identity.identity_doc_type if identity else None),
        identity_doc_number=identity_number,
        identity_doc_number_masked=mask_last4(identity_number),
        identity_doc_country=(identity.identity_doc_country if identity else None),
        identity_photo_refs=(identity.identity_photo_refs if identity else []),
        gdpr_status=user.gdpr_status,
        gdpr_pseudonymized_at=user.gdpr_pseudonymized_at,
        marketing_opt_out_at=user.marketing_opt_out_at,
        is_active=user.is_active,
        created_at=user.created_at,
    )


async def _get_identity(session: AsyncSession, user_id) -> CustomerIdentityDocument | None:
    return await session.scalar(
        select(CustomerIdentityDocument).where(CustomerIdentityDocument.user_id == user_id)
    )


async def _upsert_identity_document(
    session: AsyncSession,
    *,
    user_id,
    identity_doc_type,
    identity_doc_number: str | None,
    identity_doc_country: str | None,
    identity_photo_refs: list[str] | None,
    fields_set: set[str] | None = None,
) -> None:
    apply_type = identity_doc_type is not None if fields_set is None else "identity_doc_type" in fields_set
    apply_number = identity_doc_number is not None if fields_set is None else "identity_doc_number" in fields_set
    apply_country = identity_doc_country is not None if fields_set is None else "identity_doc_country" in fields_set
    apply_photos = identity_photo_refs is not None if fields_set is None else "identity_photo_refs" in fields_set
    if not (apply_type or apply_number or apply_country or apply_photos):
        return

    document = await _get_identity(session, user_id)
    if document is None:
        # An explicit clear should not create an otherwise empty identity row.
        has_value = bool(
            identity_doc_type
            or (identity_doc_number or "").strip()
            or (identity_doc_country or "").strip()
            or identity_photo_refs
        )
        if not has_value:
            return
        document = CustomerIdentityDocument(user_id=user_id)
        session.add(document)
        await session.flush()

    if apply_type:
        document.identity_doc_type = identity_doc_type
    if apply_number:
        clean = (identity_doc_number or "").strip()
        document.identity_doc_number_encrypted = encrypt_field(clean) if clean else None
        document.identity_doc_number_hash = hash_sensitive_value(clean) if clean else None
    if apply_country:
        stripped = (identity_doc_country or "").strip()
        document.identity_doc_country = stripped.upper() if stripped else None
    if apply_photos:
        document.identity_photo_refs = identity_photo_refs or []


async def _identity_conflicting_customer_ids(
    session: AsyncSession,
    *,
    cpr_hash: str | None,
    identity_doc_number_hash: str | None,
    exclude_user_id=None,
) -> set:
    conditions = []
    if cpr_hash:
        conditions.append(User.cpr_hash == cpr_hash)
    if identity_doc_number_hash:
        conditions.append(CustomerIdentityDocument.identity_doc_number_hash == identity_doc_number_hash)
    if not conditions:
        return set()
    statement = (
        select(User.id)
        .outerjoin(CustomerIdentityDocument, CustomerIdentityDocument.user_id == User.id)
        .where(User.role == RoleEnum.CUSTOMER, or_(*conditions))
    )
    if exclude_user_id is not None:
        statement = statement.where(User.id != exclude_user_id)
    return set((await session.scalars(statement)).all())


def _identity_conflict_detail(*, has_cpr: bool, has_identity_doc: bool) -> str:
    if has_cpr and has_identity_doc:
        return "Bu CPR veya kimlik belge numarasıyla kayıtlı bir müşteri zaten var."
    if has_cpr:
        return "Bu CPR ile kayıtlı bir müşteri zaten var."
    return "Bu kimlik belge numarasıyla kayıtlı bir müşteri zaten var."


async def _ensure_identity_values_available(
    session: AsyncSession,
    *,
    cpr: str | None,
    identity_doc_number: str | None,
    exclude_user_id=None,
) -> None:
    cpr_hash = hash_cpr(cpr)
    doc_hash = hash_sensitive_value(identity_doc_number) if identity_doc_number else None
    conflicts = await _identity_conflicting_customer_ids(
        session,
        cpr_hash=cpr_hash,
        identity_doc_number_hash=doc_hash,
        exclude_user_id=exclude_user_id,
    )
    if conflicts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_identity_conflict_detail(has_cpr=bool(cpr), has_identity_doc=bool(identity_doc_number)),
        )


async def customer_identity_match(
    session: AsyncSession,
    *,
    cpr_number: str | None,
    identity_doc_number: str | None,
) -> CustomerMatchOut:
    """Return exact hash matches without disclosing raw identity values."""

    cpr = _normalize_cpr(cpr_number)
    cpr_hash = hash_cpr(cpr) if cpr and len(cpr) == 10 else None
    doc_number = (identity_doc_number or "").strip() or None
    doc_hash = hash_sensitive_value(doc_number) if doc_number and len(doc_number) >= 4 else None
    if not cpr_hash and not doc_hash:
        return CustomerMatchOut(status="none")

    conditions = []
    if cpr_hash:
        conditions.append(User.cpr_hash == cpr_hash)
    if doc_hash:
        conditions.append(CustomerIdentityDocument.identity_doc_number_hash == doc_hash)
    rows = (
        await session.execute(
            select(User, CustomerIdentityDocument)
            .outerjoin(CustomerIdentityDocument, CustomerIdentityDocument.user_id == User.id)
            .where(User.role == RoleEnum.CUSTOMER, or_(*conditions))
            .order_by(User.created_at.asc())
        )
    ).all()

    matches: list[CustomerMatchItemOut] = []
    for user, document in rows:
        matched_fields: list[str] = []
        if cpr_hash and user.cpr_hash == cpr_hash:
            matched_fields.append("cpr")
        if doc_hash and document and document.identity_doc_number_hash == doc_hash:
            matched_fields.append("identity_doc_number")
        if not matched_fields:
            continue
        matches.append(
            CustomerMatchItemOut(
                id=str(user.id),
                name=user.name,
                cpr_number_masked=(f"******{user.cpr_last4}" if user.cpr_last4 else None),
                identity_doc_number_masked=mask_last4(
                    decrypt_field(document.identity_doc_number_encrypted) if document else None
                ),
                matched_by=", ".join(matched_fields),
            )
        )

    match_status = "none" if not matches else "single" if len(matches) == 1 else "conflict"
    return CustomerMatchOut(status=match_status, matches=matches)


async def create_customer(session: AsyncSession, payload: CustomerCreate) -> User:
    email = payload.email or _normalize_generated_email()
    phone = _normalize_phone(payload.phone)
    postal_code = _normalize_postal_code(payload.postal_code)
    city = _normalize_city(payload.city)
    cpr = _normalize_cpr(payload.cpr_number)
    identity_doc_number = payload.identity_doc_number.strip() if payload.identity_doc_number else None
    _validate_customer_identity_inputs(phone=phone, cpr=cpr, identity_doc_number=identity_doc_number)

    existing = await session.scalar(select(User).where(User.email == email))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email zaten kayıtlı")

    if phone:
        phone_candidates = (
            await session.scalars(select(User).where(User.role == RoleEnum.CUSTOMER, User.phone.is_not(None)))
        ).all()
        for candidate in phone_candidates:
            if _normalize_phone(candidate.phone) == phone:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Bu telefon numarası ile kayıtlı bir müşteri zaten var.",
                )

    await _ensure_identity_values_available(
        session,
        cpr=cpr,
        identity_doc_number=identity_doc_number,
    )

    password = payload.password or secrets.token_urlsafe(12)

    try:
        # The duplicate lookup is only a friendly early warning.  The partial
        # unique indexes are the authoritative race guard; use a savepoint so
        # an index collision leaves the caller's outer transaction usable.
        async with session.begin_nested():
            await _ensure_identity_values_available(
                session,
                cpr=cpr,
                identity_doc_number=identity_doc_number,
            )
            user = User(
                email=email,
                password_hash=get_password_hash(password),
                name=payload.name,
                role=RoleEnum.CUSTOMER,
                phone=phone,
                postal_code=postal_code,
                city=city,
                address_encrypted=encrypt_field(payload.address.strip()) if payload.address else None,
                cpr_number_encrypted=encrypt_field(cpr) if cpr else None,
                cpr_hash=hash_cpr(cpr),
                cpr_last4=(cpr[-4:] if cpr else None),
                is_active=True,
            )
            session.add(user)
            await session.flush()

            await _upsert_identity_document(
                session,
                user_id=user.id,
                identity_doc_type=payload.identity_doc_type,
                identity_doc_number=identity_doc_number,
                identity_doc_country=payload.identity_doc_country,
                identity_photo_refs=payload.identity_photo_refs,
                fields_set={
                    "identity_doc_type",
                    "identity_doc_number",
                    "identity_doc_country",
                    "identity_photo_refs",
                },
            )
            await session.flush()
    except IntegrityError as exc:
        concurrent_email = await session.scalar(select(User.id).where(User.email == email))
        if concurrent_email is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email zaten kayıtlı") from exc
        await _ensure_identity_values_available(
            session,
            cpr=cpr,
            identity_doc_number=identity_doc_number,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Müşteri kaydedilirken bir çakışma oluştu. Tekrar arayın.",
        ) from exc

    return user


async def update_customer(session: AsyncSession, user: User, payload: CustomerUpdate) -> User:
    user_id = user.id
    fields = payload.model_fields_set
    submitted_cpr = _normalize_cpr(payload.cpr_number) if "cpr_number" in fields else None
    submitted_identity_doc = (payload.identity_doc_number or "").strip() or None
    try:
        # As with creates, the indexes are the final concurrency guard.  A
        # savepoint contains a losing update race so callers get a usable 409
        # instead of leaving the outer request transaction in error state.
        async with session.begin_nested():
            await _apply_customer_update(session, user, payload)
    except IntegrityError as exc:
        if "email" in fields and payload.email is not None:
            concurrent_email = await session.scalar(
                select(User.id).where(User.email == payload.email, User.id != user_id)
            )
            if concurrent_email is not None:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email zaten kayıtlı") from exc
        await _ensure_identity_values_available(
            session,
            cpr=submitted_cpr,
            identity_doc_number=submitted_identity_doc if "identity_doc_number" in fields else None,
            exclude_user_id=user_id,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Müşteri bilgileri aynı anda değiştirildi. Güncel kaydı açıp tekrar deneyin.",
        ) from exc
    return user


async def _apply_customer_update(session: AsyncSession, user: User, payload: CustomerUpdate) -> None:
    fields = payload.model_fields_set
    if "name" in fields and payload.name is not None:
        user.name = payload.name
    if "email" in fields and payload.email is not None and payload.email != user.email:
        existing = await session.scalar(select(User).where(User.email == payload.email, User.id != user.id))
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email zaten kayıtlı")
        user.email = payload.email
    if "phone" in fields:
        phone = _normalize_phone(payload.phone)
        _validate_customer_identity_inputs(phone=phone, cpr=None, identity_doc_number=None)
        user.phone = phone
    if "postal_code" in fields:
        user.postal_code = _normalize_postal_code(payload.postal_code)
    if "city" in fields:
        user.city = _normalize_city(payload.city)
    if "address" in fields:
        user.address_encrypted = encrypt_field(payload.address) if payload.address else None
    if "cpr_number" in fields:
        cpr = _normalize_cpr(payload.cpr_number)
        _validate_customer_identity_inputs(phone=None, cpr=payload.cpr_number, identity_doc_number=None)
        await _ensure_identity_values_available(
            session,
            cpr=cpr,
            identity_doc_number=None,
            exclude_user_id=user.id,
        )
        user.cpr_number_encrypted = encrypt_field(cpr) if cpr else None
        user.cpr_hash = hash_cpr(cpr)
        user.cpr_last4 = cpr[-4:] if cpr else None
    if "is_active" in fields and payload.is_active is not None:
        user.is_active = payload.is_active

    identity_doc_number = payload.identity_doc_number.strip() if payload.identity_doc_number else None
    if "identity_doc_number" in fields:
        _validate_customer_identity_inputs(phone=None, cpr=None, identity_doc_number=payload.identity_doc_number)
        await _ensure_identity_values_available(
            session,
            cpr=None,
            identity_doc_number=identity_doc_number,
            exclude_user_id=user.id,
        )

    await _upsert_identity_document(
        session,
        user_id=user.id,
        identity_doc_type=payload.identity_doc_type,
        identity_doc_number=identity_doc_number,
        identity_doc_country=payload.identity_doc_country,
        identity_photo_refs=payload.identity_photo_refs,
        fields_set=fields,
    )

    await session.flush()


async def get_customer_detail(session: AsyncSession, user: User) -> CustomerDetailOut:
    purchase_stats = await session.execute(
        select(func.count(Product.id), func.coalesce(func.sum(Product.purchase_price_dkk), Decimal("0"))).where(
            Product.seller_customer_id == user.id,
            Product.deleted_at.is_(None),
        )
    )
    sold_to_shop_count, sold_to_shop_value = purchase_stats.one()

    sale_stats = await session.execute(
        select(func.count(Product.id), func.coalesce(func.sum(Product.sale_price_dkk), Decimal("0"))).where(
            Product.buyer_customer_id == user.id,
            Product.deleted_at.is_(None),
        )
    )
    bought_from_shop_count, bought_from_shop_value = sale_stats.one()

    identity = await _get_identity(session, user.id)
    base = _customer_out(user, identity)
    stats = CustomerStats(
        total_sold_to_shop=sold_to_shop_count or 0,
        total_bought_from_shop=bought_from_shop_count or 0,
        total_purchase_value_dkk=str(sold_to_shop_value or Decimal("0")),
        total_sale_value_dkk=str(bought_from_shop_value or Decimal("0")),
    )
    risk = await _get_customer_risk(session, user.id)

    return CustomerDetailOut(**base.model_dump(), stats=stats, risk=risk)


async def to_customer_out(session: AsyncSession, user: User) -> CustomerOut:
    identity = await _get_identity(session, user.id)
    return _customer_out(user, identity)


def _build_customer_risk(
    *,
    transactions_30d: int,
    distinct_addresses_30d: int,
    distinct_identity_docs_30d: int,
    melted_items_30d: int,
) -> CustomerRiskOut:
    score = 0
    warnings: list[str] = []

    if distinct_addresses_30d >= 4:
        score += 45
        warnings.append(f"Bu müşteri son 30 günde {distinct_addresses_30d} farklı adresten işlem yaptı.")

    if distinct_identity_docs_30d >= 3:
        score += 30
        warnings.append(
            f"Bu müşteri son 30 günde {distinct_identity_docs_30d} farklı kimlik numarası ile işlem yaptı."
        )

    if transactions_30d >= 12:
        score += 15
        warnings.append(f"Son 30 günde işlem hacmi yüksek ({transactions_30d} işlem).")

    if melted_items_30d >= 3:
        score += 20
        warnings.append(f"Son 30 günde eritilen ürün sayısı yüksek ({melted_items_30d}).")

    if score >= 60:
        level = "high"
    elif score >= 30:
        level = "medium"
    else:
        level = "low"

    return CustomerRiskOut(
        score=score,
        level=level,
        warnings=warnings,
        transactions_30d=transactions_30d,
        distinct_addresses_30d=distinct_addresses_30d,
        distinct_identity_docs_30d=distinct_identity_docs_30d,
        melted_items_30d=melted_items_30d,
    )


async def _get_customer_risk(session: AsyncSession, customer_id) -> CustomerRiskOut:
    window_start = utc_now() - timedelta(days=30)

    activity_agg = await session.execute(
        select(
            func.count(CustomerActivityEvent.id),
            func.count(func.distinct(CustomerActivityEvent.address_hash)),
            func.count(func.distinct(CustomerActivityEvent.identity_doc_number_hash)),
        ).where(
            CustomerActivityEvent.customer_id == customer_id,
            CustomerActivityEvent.created_at >= window_start,
        )
    )
    transactions_30d, distinct_addresses_30d, distinct_identity_docs_30d = activity_agg.one()

    melted_items_30d = await session.scalar(
        select(func.count(Product.id)).where(
            Product.seller_customer_id == customer_id,
            Product.status == ProductStatusEnum.MELTED,
            Product.melt_date >= window_start,
            Product.deleted_at.is_(None),
        )
    )

    return _build_customer_risk(
        transactions_30d=int(transactions_30d or 0),
        distinct_addresses_30d=int(distinct_addresses_30d or 0),
        distinct_identity_docs_30d=int(distinct_identity_docs_30d or 0),
        melted_items_30d=int(melted_items_30d or 0),
    )
