from decimal import Decimal

from app.models.enums import PosTradeSideEnum
from app.services.pos_service import _calculate_offer


def test_calculate_offer_buy_margin_is_additive_kr_per_gram():
    # R2-07 "Mer pris": margin kr/g olarak orana EKLENİR (yüzde değil).
    # saf gram = 20 × 0.75 = 15; efektif oran = 100 + 8 = 108 → 1620.00
    offer = _calculate_offer(
        weight_grams=Decimal("20"),
        purity_percentage=Decimal("75"),
        active_rate=Decimal("100"),
        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
        margin_percent=Decimal("8"),
    )
    assert offer == Decimal("1620.00")


def test_calculate_offer_negative_mer_pris_reduces_rate():
    # −8 kr/g → efektif oran 92; 15 saf gram × 92 = 1380.00
    offer = _calculate_offer(
        weight_grams=Decimal("20"),
        purity_percentage=Decimal("75"),
        active_rate=Decimal("100"),
        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
        margin_percent=Decimal("-8"),
    )
    assert offer == Decimal("1380.00")


def test_calculate_offer_sell_to_customer_uses_markup_margin():
    offer = _calculate_offer(
        weight_grams=Decimal("20"),
        purity_percentage=Decimal("75"),
        active_rate=Decimal("100"),
        trade_side=PosTradeSideEnum.SELL_TO_CUSTOMER,
        margin_percent=Decimal("8"),
    )
    assert offer == Decimal("1620.00")
