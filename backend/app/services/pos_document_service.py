from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.enums import PosDocumentTypeEnum, PosTradeSideEnum
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.user import User
from app.utils.helpers import quantize_2, to_decimal, utc_now
from app.utils.security import decrypt_field

settings = get_settings()


def seller_address_line() -> str:
    parts = [
        settings.invoice_seller_address_line1.strip(),
        " ".join([settings.invoice_seller_postal_code.strip(), settings.invoice_seller_city.strip()]).strip(),
        settings.invoice_seller_country.strip(),
    ]
    return ", ".join([part for part in parts if part])


def document_type_for_trade_side(trade_side: PosTradeSideEnum) -> PosDocumentTypeEnum:
    if trade_side == PosTradeSideEnum.SELL_TO_CUSTOMER:
        return PosDocumentTypeEnum.SALE_INVOICE
    return PosDocumentTypeEnum.PURCHASE_RECEIPT


def document_title_tr(document_type: PosDocumentTypeEnum) -> str:
    if document_type == PosDocumentTypeEnum.SALE_INVOICE:
        return "Satış Faturası"
    return "Alım Makbuzu"


def customer_party_label(document_type: PosDocumentTypeEnum) -> str:
    if document_type == PosDocumentTypeEnum.SALE_INVOICE:
        return "Alıcı"
    return "Satıcı"


def format_document_number(document: PosDocument) -> str:
    if document.legacy_document_number:
        return document.legacy_document_number
    prefix = settings.invoice_number_prefix.strip() or "SG"
    issue_year = (document.issued_at or utc_now()).year
    return f"{prefix}-{issue_year}-{document.sequence_no:06d}"


def compute_vat_breakdown(gross_amount: Decimal, vat_rate_percent: Decimal) -> tuple[Decimal, Decimal]:
    if vat_rate_percent <= 0:
        return quantize_2(gross_amount), Decimal("0.00")
    divisor = Decimal("1.00") + (vat_rate_percent / Decimal("100"))
    if divisor <= 0:
        return quantize_2(gross_amount), Decimal("0.00")
    net_amount = quantize_2(gross_amount / divisor)
    vat_amount = quantize_2(gross_amount - net_amount)
    return net_amount, vat_amount


async def ensure_pos_document(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    customer: User | None,
    trade_side: PosTradeSideEnum,
    amount_dkk: Decimal | None,
    notes: str | None,
) -> tuple[PosDocument, bool]:
    existing = await session.scalar(select(PosDocument).where(PosDocument.pos_session_id == pos_session.id))
    if existing:
        return existing, False

    customer_record = customer
    if customer_record is None:
        customer_record = await session.get(User, pos_session.customer_id)

    gross_amount = quantize_2(amount_dkk if amount_dkk is not None else Decimal("0"))
    document_type = document_type_for_trade_side(trade_side)
    vat_rate = (
        quantize_2(to_decimal(settings.invoice_sale_vat_rate_percent))
        if document_type == PosDocumentTypeEnum.SALE_INVOICE
        else Decimal("0.00")
    )
    net_amount, vat_amount = compute_vat_breakdown(gross_amount, vat_rate)

    customer_address = decrypt_field(customer_record.address_encrypted) if customer_record else None
    pos_document = PosDocument(
        pos_session_id=pos_session.id,
        document_type=document_type,
        issued_at=pos_session.confirmed_at or utc_now(),
        supply_at=pos_session.confirmed_at,
        currency_code=(settings.invoice_default_currency or "DKK").strip().upper(),
        gross_amount_dkk=gross_amount,
        net_amount_dkk=net_amount,
        vat_rate_percent=vat_rate,
        vat_amount_dkk=vat_amount,
        customer_name=(customer_record.name if customer_record else None),
        customer_phone=(customer_record.phone if customer_record else None),
        customer_email=(customer_record.email if customer_record else None),
        customer_address=customer_address,
        customer_postal_code=(customer_record.postal_code if customer_record else None),
        notes=notes,
    )
    session.add(pos_document)
    await session.flush()
    return pos_document, True
