from __future__ import annotations

import secrets
import uuid
from datetime import timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
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
    return raw or None


def _normalize_cpr(value: str | None) -> str | None:
    digits = _digits_only(value)
    return digits or None


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
) -> None:
    if (
        identity_doc_type is None
        and identity_doc_number is None
        and identity_doc_country is None
        and identity_photo_refs is None
    ):
        return

    document = await _get_identity(session, user_id)
    if document is None:
        document = CustomerIdentityDocument(user_id=user_id)
        session.add(document)
        await session.flush()

    if identity_doc_type is not None:
        document.identity_doc_type = identity_doc_type
    if identity_doc_number is not None:
        clean = identity_doc_number.strip()
        document.identity_doc_number_encrypted = encrypt_field(clean)
        document.identity_doc_number_hash = hash_sensitive_value(clean)
    if identity_doc_country is not None:
        stripped = identity_doc_country.strip()
        document.identity_doc_country = stripped.upper() if stripped else None
    if identity_photo_refs is not None:
        document.identity_photo_refs = identity_photo_refs


async def create_customer(session: AsyncSession, payload: CustomerCreate) -> User:
    email = payload.email or _normalize_generated_email()
    phone = _normalize_phone(payload.phone)
    postal_code = _normalize_postal_code(payload.postal_code)
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

    if cpr:
        cpr_hash = hash_cpr(cpr)
        if cpr_hash:
            existing_by_cpr = await session.scalar(
                select(User)
                .where(User.role == RoleEnum.CUSTOMER, User.cpr_hash == cpr_hash)
                .limit(1)
            )
            if existing_by_cpr:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Bu CPR ile kayıtlı bir müşteri zaten var.",
                )

    password = payload.password or secrets.token_urlsafe(12)

    user = User(
        email=email,
        password_hash=get_password_hash(password),
        name=payload.name,
        role=RoleEnum.CUSTOMER,
        phone=phone,
        postal_code=postal_code,
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
    )

    return user


async def update_customer(session: AsyncSession, user: User, payload: CustomerUpdate) -> User:
    if payload.name is not None:
        user.name = payload.name
    if payload.email is not None and payload.email != user.email:
        existing = await session.scalar(select(User).where(User.email == payload.email, User.id != user.id))
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email zaten kayıtlı")
        user.email = payload.email
    if payload.phone is not None:
        phone = _normalize_phone(payload.phone)
        _validate_customer_identity_inputs(phone=phone, cpr=None, identity_doc_number=None)
        user.phone = phone
    if payload.postal_code is not None:
        user.postal_code = _normalize_postal_code(payload.postal_code)
    if payload.address is not None:
        user.address_encrypted = encrypt_field(payload.address)
    if payload.cpr_number is not None:
        cpr = _normalize_cpr(payload.cpr_number)
        _validate_customer_identity_inputs(phone=None, cpr=payload.cpr_number, identity_doc_number=None)
        user.cpr_number_encrypted = encrypt_field(cpr)
        user.cpr_hash = hash_cpr(cpr)
        user.cpr_last4 = cpr[-4:] if cpr else None
    if payload.is_active is not None:
        user.is_active = payload.is_active

    await _upsert_identity_document(
        session,
        user_id=user.id,
        identity_doc_type=payload.identity_doc_type,
        identity_doc_number=payload.identity_doc_number.strip() if payload.identity_doc_number else payload.identity_doc_number,
        identity_doc_country=payload.identity_doc_country,
        identity_photo_refs=payload.identity_photo_refs,
    )

    await session.flush()
    return user


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
