from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException, status

from app.models.enums import MetalTypeEnum, PosRateSourceEnum, PosTradeSideEnum, ProductTypeEnum
from app.models.pos_session import PosSession
from app.utils.helpers import quantize_2, to_decimal

PRODUCT_LABEL_TR: dict[str, str] = {
    "bracelet": "Bilezik",
    "ring": "Yüzük",
    "necklace": "Kolye",
    "earring": "Küpe",
    "chain": "Zincir",
    "bar": "Bar",
    "jewelry": "Takı",
}

METAL_LABEL_TR: dict[str, str] = {
    "yellow_gold": "Sarı Altın",
    "white_gold": "Beyaz Altın",
    "silver": "Gümüş",
    "platinum": "Platin",
    "palladium": "Palladium",
}


def active_rate(pos_session: PosSession) -> Decimal | None:
    if pos_session.rate_source == PosRateSourceEnum.MANUAL and pos_session.manual_rate_dkk is not None:
        return to_decimal(pos_session.manual_rate_dkk)
    if pos_session.live_rate_dkk is not None:
        return to_decimal(pos_session.live_rate_dkk)
    return None


def safe_trade_side(value: PosTradeSideEnum | str | None) -> PosTradeSideEnum | None:
    if value is None:
        return None
    if isinstance(value, PosTradeSideEnum):
        return value
    try:
        return PosTradeSideEnum(str(value))
    except Exception:
        return None


def resolved_trade_side(
    pos_session: PosSession,
    *,
    trade_side_override: PosTradeSideEnum | str | None = None,
) -> PosTradeSideEnum:
    parsed_override = safe_trade_side(trade_side_override)
    if parsed_override is not None:
        return parsed_override

    snapshot = pos_session.visible_snapshot if isinstance(pos_session.visible_snapshot, dict) else {}
    parsed_snapshot = safe_trade_side(snapshot.get("trade_side"))
    if parsed_snapshot is not None:
        return parsed_snapshot

    parsed_db = safe_trade_side(pos_session.trade_side)
    if parsed_db is not None:
        return parsed_db
    return PosTradeSideEnum.BUY_FROM_CUSTOMER


def metal_value(metal_type: MetalTypeEnum | str | None) -> str | None:
    if metal_type is None:
        return None
    if isinstance(metal_type, MetalTypeEnum):
        return metal_type.value
    return str(metal_type)


def product_value(product_type: ProductTypeEnum | str | None) -> str | None:
    if product_type is None:
        return None
    if isinstance(product_type, ProductTypeEnum):
        return product_type.value
    return str(product_type)


def display_product_type(value: ProductTypeEnum | str | None) -> str:
    raw = product_value(value)
    if not raw:
        return "-"
    return PRODUCT_LABEL_TR.get(raw, raw)


def display_metal_type(value: MetalTypeEnum | str | None) -> str:
    raw = metal_value(value)
    if not raw:
        return "-"
    return METAL_LABEL_TR.get(raw, raw)


def fmt_decimal(value: Decimal | str | int | float | None, *, fallback: str = "-") -> str:
    if value is None:
        return fallback
    return format(quantize_2(to_decimal(value)), "f")


def metal_rate_key(metal_type: MetalTypeEnum | str | None) -> str:
    resolved = metal_value(metal_type)
    if resolved in {MetalTypeEnum.YELLOW_GOLD.value, MetalTypeEnum.WHITE_GOLD.value}:
        return "gold"
    if resolved == MetalTypeEnum.SILVER.value:
        return "silver"
    if resolved == MetalTypeEnum.PLATINUM.value:
        return "platinum"
    if resolved == MetalTypeEnum.PALLADIUM.value:
        return "palladium"
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Metal tipi seçilmedi")


def calculate_offer(
    *,
    weight_grams: Decimal | None,
    purity_percentage: Decimal | None,
    active_rate: Decimal | None,
    trade_side: PosTradeSideEnum = PosTradeSideEnum.BUY_FROM_CUSTOMER,
    margin_percent: Decimal | None,
) -> Decimal | None:
    if weight_grams is None or purity_percentage is None or active_rate is None:
        return None

    normalized_margin = margin_percent if margin_percent is not None else Decimal("0")
    pure_grams = weight_grams * (purity_percentage / Decimal("100"))
    margin_ratio = normalized_margin / Decimal("100")
    if trade_side == PosTradeSideEnum.SELL_TO_CUSTOMER:
        multiplier = Decimal("1") + margin_ratio
    else:
        multiplier = Decimal("1") - margin_ratio

    offer = pure_grams * active_rate * multiplier
    return quantize_2(offer)


def recalculate_pos_session(pos_session: PosSession) -> None:
    active_rate_value = active_rate(pos_session)
    pos_session.final_offer_dkk = calculate_offer(
        weight_grams=(to_decimal(pos_session.weight_grams) if pos_session.weight_grams is not None else None),
        purity_percentage=(to_decimal(pos_session.purity_percentage) if pos_session.purity_percentage is not None else None),
        active_rate=active_rate_value,
        trade_side=resolved_trade_side(pos_session),
        margin_percent=to_decimal(pos_session.margin_percent_internal or Decimal("0")),
    )
