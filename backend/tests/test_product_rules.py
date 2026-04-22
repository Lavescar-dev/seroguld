from decimal import Decimal
import asyncio

import pytest
from fastapi import HTTPException

from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum
from app.schemas.product import ProductCreate
from app.services.product_service import (
    _allowed_status_transition,
    extract_import_source_type,
    extract_manual_review_reasons,
    has_manual_review_flag,
    _resolve_seller,
    calculate_offer_price,
    calculate_pure_gold_grams,
)


def test_calculate_pure_gold_grams():
    result = calculate_pure_gold_grams(Decimal("10.00"), Decimal("75.00"))
    assert result == Decimal("7.50")


def test_calculate_offer_price():
    result = calculate_offer_price(
        pure_gold_grams=Decimal("7.50"),
        gold_rate_dkk_per_gram=Decimal("520.00"),
        commission_rate=Decimal("0.10"),
    )
    assert result == Decimal("3510.00")


def test_status_transition_rules():
    assert _allowed_status_transition(ProductStatusEnum.IN_INVENTORY, ProductStatusEnum.FOR_SALE)
    assert _allowed_status_transition(ProductStatusEnum.FOR_SALE, ProductStatusEnum.SOLD)
    assert not _allowed_status_transition(ProductStatusEnum.SOLD, ProductStatusEnum.IN_INVENTORY)


def test_resolve_seller_invalid_email_returns_422():
    payload = ProductCreate(
        product_type=ProductTypeEnum.RING,
        metal_type=MetalTypeEnum.YELLOW_GOLD,
        weight_grams=Decimal("10"),
        purity_karat="18K",
        purity_percentage=Decimal("75"),
        purchase_price_dkk=Decimal("1000"),
        commission=Decimal("8"),
        seller_new={
            "name": "Demo Seller",
            "email": "invalid-email",
        },
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(_resolve_seller(None, payload))

    assert exc.value.status_code == 422


def test_manual_review_note_parsing():
    notes = "[SOURCE_TYPE:coin] [MANUAL_REVIEW:type_unknown,metal_unknown] Woo import · Test"
    assert has_manual_review_flag(notes)
    assert extract_manual_review_reasons(notes) == ["type_unknown", "metal_unknown"]
    assert extract_import_source_type(notes) == "coin"
