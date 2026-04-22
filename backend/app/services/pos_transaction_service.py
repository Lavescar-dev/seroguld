from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import PosTradeSideEnum
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.pos_session_line import PosSessionLine
from app.models.product import Product
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.services.pos_value_helpers import (
    active_rate,
    calculate_offer,
    metal_value,
    product_value,
)
from app.utils.helpers import quantize_2, to_decimal


async def ensure_pos_transaction(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    product: Product | None,
    pos_document: PosDocument,
    trade_side: PosTradeSideEnum,
    amount_dkk: Decimal | None,
    notes: str | None,
    line_products: list[Product] | None = None,
) -> tuple[Transaction, bool]:
    existing = await session.scalar(select(Transaction).where(Transaction.pos_session_id == pos_session.id))
    if existing:
        return existing, False

    gross_amount = quantize_2(amount_dkk if amount_dkk is not None else Decimal("0"))
    transaction = Transaction(
        pos_session_id=pos_session.id,
        pos_document_sequence_no=pos_document.sequence_no,
        trade_side=trade_side.value,
        status="confirmed",
        customer_id=pos_session.customer_id,
        clerk_user_id=pos_session.clerk_user_id,
        currency_code=pos_document.currency_code,
        gross_amount_dkk=quantize_2(to_decimal(pos_document.gross_amount_dkk)),
        net_amount_dkk=quantize_2(to_decimal(pos_document.net_amount_dkk)),
        vat_rate_percent=quantize_2(to_decimal(pos_document.vat_rate_percent)),
        vat_amount_dkk=quantize_2(to_decimal(pos_document.vat_amount_dkk)),
        notes=notes,
        confirmed_at=pos_session.confirmed_at,
    )
    session.add(transaction)
    await session.flush()

    pos_lines = (
        await session.scalars(
            select(PosSessionLine)
            .where(PosSessionLine.pos_session_id == pos_session.id)
            .order_by(PosSessionLine.line_no.asc())
        )
    ).all()

    if pos_lines:
        line_payloads: list[dict[str, Any]] = []
        for source in pos_lines:
            rate_value = to_decimal(source.rate_dkk) if source.rate_dkk is not None else active_rate(pos_session)
            if rate_value is None and product is not None and product.gold_rate_at_purchase is not None:
                rate_value = to_decimal(product.gold_rate_at_purchase)
            margin_value = quantize_2(to_decimal(source.margin_percent_internal or Decimal("0")))
            line_total = (
                quantize_2(to_decimal(source.line_offer_dkk))
                if source.line_offer_dkk is not None
                else calculate_offer(
                    weight_grams=to_decimal(source.weight_grams),
                    purity_percentage=to_decimal(source.purity_percentage),
                    active_rate=rate_value,
                    trade_side=trade_side,
                    margin_percent=margin_value,
                )
            )
            pure_gold_grams = quantize_2(
                to_decimal(source.weight_grams) * (to_decimal(source.purity_percentage) / Decimal("100"))
            )
            line_payloads.append(
                {
                    "product_id": None,
                    "product_number": None,
                    "reference_number": None,
                    "product_type": product_value(source.product_type),
                    "metal_type": metal_value(source.metal_type),
                    "weight_grams": quantize_2(to_decimal(source.weight_grams)),
                    "purity_karat": source.purity_karat,
                    "purity_percentage": quantize_2(to_decimal(source.purity_percentage)),
                    "pure_gold_grams": pure_gold_grams,
                    "rate_dkk": quantize_2(rate_value) if rate_value is not None else None,
                    "margin_percent": margin_value,
                    "line_total_dkk": quantize_2(line_total) if line_total is not None else Decimal("0.00"),
                }
            )

        for idx, payload_row in enumerate(line_payloads, start=1):
            linked_product: Product | None = None
            if line_products and len(line_products) >= idx:
                linked_product = line_products[idx - 1]
            elif len(line_payloads) == 1:
                linked_product = product

            if linked_product is not None:
                payload_row["product_id"] = linked_product.id
                payload_row["product_number"] = linked_product.product_number
                payload_row["reference_number"] = linked_product.reference_number
                payload_row["product_type"] = product_value(linked_product.product_type) or payload_row["product_type"]
                payload_row["metal_type"] = metal_value(linked_product.metal_type) or payload_row["metal_type"]
                if linked_product.purchase_price_dkk is not None:
                    payload_row["line_total_dkk"] = quantize_2(to_decimal(linked_product.purchase_price_dkk))
                if linked_product.pure_gold_grams is not None:
                    payload_row["pure_gold_grams"] = quantize_2(to_decimal(linked_product.pure_gold_grams))

        lines_total = quantize_2(sum((item["line_total_dkk"] for item in line_payloads), Decimal("0.00")))
        if line_payloads and lines_total != gross_amount:
            delta = quantize_2(gross_amount - lines_total)
            # Transaction yazımında yalnızca çok küçük yuvarlama farklarını otomatik dengeleriz.
            if abs(delta) <= Decimal("0.01"):
                line_payloads[-1]["line_total_dkk"] = quantize_2(line_payloads[-1]["line_total_dkk"] + delta)

        for idx, payload_row in enumerate(line_payloads, start=1):
            session.add(
                TransactionLine(
                    transaction_id=transaction.id,
                    line_no=idx,
                    product_id=payload_row["product_id"],
                    product_number=payload_row["product_number"],
                    reference_number=payload_row["reference_number"],
                    product_type=payload_row["product_type"],
                    metal_type=payload_row["metal_type"],
                    weight_grams=payload_row["weight_grams"],
                    purity_karat=payload_row["purity_karat"],
                    purity_percentage=payload_row["purity_percentage"],
                    pure_gold_grams=payload_row["pure_gold_grams"],
                    rate_dkk=payload_row["rate_dkk"],
                    margin_percent=payload_row["margin_percent"],
                    line_total_dkk=payload_row["line_total_dkk"],
                )
            )
    else:
        if product is None:
            raise ValueError("Transaction yazımı için ürün veya satır verisi gerekli")
        rate_value = active_rate(pos_session)
        if rate_value is None and product.gold_rate_at_purchase is not None:
            rate_value = to_decimal(product.gold_rate_at_purchase)

        line = TransactionLine(
            transaction_id=transaction.id,
            line_no=1,
            product_id=product.id,
            product_number=product.product_number,
            reference_number=product.reference_number,
            product_type=product_value(product.product_type),
            metal_type=metal_value(product.metal_type),
            weight_grams=(quantize_2(to_decimal(product.weight_grams)) if product.weight_grams is not None else None),
            purity_karat=product.purity_karat,
            purity_percentage=(
                quantize_2(to_decimal(product.purity_percentage))
                if product.purity_percentage is not None
                else None
            ),
            pure_gold_grams=(
                quantize_2(to_decimal(product.pure_gold_grams))
                if product.pure_gold_grams is not None
                else None
            ),
            rate_dkk=(quantize_2(to_decimal(rate_value)) if rate_value is not None else None),
            margin_percent=quantize_2(to_decimal(pos_session.margin_percent_internal or Decimal("0"))),
            line_total_dkk=gross_amount,
        )
        session.add(line)
    await session.flush()
    return transaction, True
