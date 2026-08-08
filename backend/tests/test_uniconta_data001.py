from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

from app.models.enums import MetalTypeEnum, PosTradeSideEnum
from app.services.pos_value_helpers import calculate_offer
from app.services.uniconta_service import build_uniconta_lines_from_pos_lines
from app.utils.helpers import quantize_2


def _line(
    *,
    metal: MetalTypeEnum,
    weight: str,
    purity: str,
    rate: str,
    margin: str,
    line_offer: str | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        metal_type=metal,
        purity_karat="18K" if metal != MetalTypeEnum.SILVER else None,
        purity_percentage=Decimal(purity),
        weight_grams=Decimal(weight),
        rate_dkk=Decimal(rate),
        margin_percent_internal=Decimal(margin),
        line_offer_dkk=Decimal(line_offer) if line_offer is not None else None,
    )


def _payload_total(row: dict[str, object]) -> Decimal:
    return quantize_2(Decimal(str(row["Qty"])) * Decimal(str(row["Price"])))


def test_gold_fractional_line_preserves_canonical_local_net_offer() -> None:
    line = _line(
        metal=MetalTypeEnum.YELLOW_GOLD,
        weight="0.125",
        purity="75.00",
        rate="615.50",
        margin="8.00",
        line_offer="53.09",
    )

    payload = build_uniconta_lines_from_pos_lines([line])[0]

    assert payload["Qty"] == 1.0
    assert _payload_total(payload) == Decimal("53.09")
    assert Decimal(str(payload["Price"])) == Decimal("53.09")
    assert "Guld" in str(payload["Text"])
    assert "0.125g" in str(payload["Text"])


def test_silver_fractional_line_recomputes_net_offer_with_buy_margin() -> None:
    line = _line(
        metal=MetalTypeEnum.SILVER,
        weight="0.125",
        purity="92.50",
        rate="14.56",
        margin="8.00",
    )
    expected = calculate_offer(
        weight_grams=Decimal("0.125"),
        purity_percentage=Decimal("92.50"),
        active_rate=Decimal("14.56"),
        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
        margin_percent=Decimal("8.00"),
    )

    payload = build_uniconta_lines_from_pos_lines([line])[0]

    assert expected == Decimal("1.55")
    assert _payload_total(payload) == expected
    assert "Sølv" in str(payload["Text"])
    assert "0.125g" in str(payload["Text"])


def test_net_offer_uses_round_half_up_at_ore_boundary() -> None:
    line = _line(
        metal=MetalTypeEnum.YELLOW_GOLD,
        weight="0.500",
        purity="100.00",
        rate="20.01",
        margin="0.00",
    )

    payload = build_uniconta_lines_from_pos_lines([line])[0]

    # 0.500 * 100% * 20.01 = 10.005; DATA-001 requires 10.01, not bankers' 10.00.
    assert _payload_total(payload) == Decimal("10.01")


def test_sell_side_margin_is_reflected_in_uniconta_line_total() -> None:
    line = _line(
        metal=MetalTypeEnum.YELLOW_GOLD,
        weight="0.500",
        purity="100.00",
        rate="20.00",
        margin="8.00",
    )

    payload = build_uniconta_lines_from_pos_lines(
        [line], trade_side=PosTradeSideEnum.SELL_TO_CUSTOMER
    )[0]

    assert _payload_total(payload) == Decimal("10.80")
