from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException, status

from app.models.enums import MetalTypeEnum, PosRateSourceEnum, PosTradeSideEnum, ProductTypeEnum
from app.models.pos_session import PosSession
from app.utils.helpers import quantize_2, to_decimal

# R2-09 — üç maddelik beyan (AML/PEP dahil). ÇEVİRİ KATMANI DIŞINDA: sabit
# Danca; arayüz dili değişse de değişmez. Hem .xlsm belgesi (C47-C50) hem HTML
# yazdırma çıktısı bu tek kaynaktan beslenir.
AFG_DECLARATION_HEADER = "Jeg bekræfter herved at:"
AFG_DECLARATION_ITEMS = (
    "Smykkerne/sølvtøjet er solgt frit og ubehæftet til Sero Guld ApS og kan ikke returneres.",
    "Varerne i denne handel er afregnet i henhold til dagsprisen på guld og sølv på www.seroguld.dk",
    "Jeg er ikke en politisk eksponeret person (PEP) eller nærtstående familiemedlem/partner, som er politisk eksponeret.",
)


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

# X2/R2-15: Müşteriye görünen belge/ekran (Danca) için etiketler. İç anahtar
# "yellow_gold" ASLA ham gösterilmez.
METAL_LABEL_DA: dict[str, str] = {
    "yellow_gold": "Guld",
    "white_gold": "Hvidguld",
    "silver": "Sølv",
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


PRODUCT_LABEL_DA: dict[str, str] = {
    "bracelet": "Armbånd",
    "ring": "Ring",
    "necklace": "Halskæde",
    "earring": "Ørering",
    "chain": "Kæde",
    "bar": "Barre",
    "jewelry": "Smykke",
}


def display_product_type_da(value: ProductTypeEnum | str | None) -> str:
    raw = product_value(value)
    if not raw:
        return "-"
    return PRODUCT_LABEL_DA.get(raw, PRODUCT_LABEL_DA.get(raw.lower(), "-"))


def display_metal_type_da(value: MetalTypeEnum | str | None) -> str:
    """Müşteriye görünen Danca metal etiketi (belge + müşteri ekranı).

    İç anahtar ("yellow_gold" gibi) hiçbir zaman ham dönmez; bilinmeyen değer
    için de "-" verilir ki ham anahtar sızmasın (X2)."""
    raw = metal_value(value)
    if not raw:
        return "-"
    return METAL_LABEL_DA.get(raw, METAL_LABEL_DA.get(raw.lower(), "-"))


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
    # R2-07 "Mer pris": margin artık YÜZDE değil, gram başına kr/g düzeltmedir.
    # Alışta orana EKLENİR (negatif = düşer); satışta da aynı işaretle eklenir.
    # Eski yüzde-çarpan formülü (1 ± m/100) kaldırıldı — negatif mer pris'i
    # %ZAM olarak yorumluyordu.
    _ = trade_side  # yön farkı işareti mer pris'in kendisinde (± kr/g)
    effective_rate = active_rate + normalized_margin

    offer = pure_grams * effective_rate
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
