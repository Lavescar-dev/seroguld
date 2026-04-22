from __future__ import annotations

from enum import Enum
from typing import TypeVar

from sqlalchemy import Enum as SqlEnum


class RoleEnum(str, Enum):
    ADMIN = "admin"
    CUSTOMER = "customer"


class ProductTypeEnum(str, Enum):
    BRACELET = "bracelet"
    RING = "ring"
    NECKLACE = "necklace"
    EARRING = "earring"
    CHAIN = "chain"
    BAR = "bar"
    JEWELRY = "jewelry"


class MetalTypeEnum(str, Enum):
    YELLOW_GOLD = "yellow_gold"
    WHITE_GOLD = "white_gold"
    SILVER = "silver"
    PLATINUM = "platinum"
    PALLADIUM = "palladium"


class ProductStatusEnum(str, Enum):
    PURCHASED = "purchased"
    IN_INVENTORY = "in_inventory"
    FOR_SALE = "for_sale"
    SOLD = "sold"
    MELTED = "melted"
    UNDECIDED = "undecided"


class IdentityDocTypeEnum(str, Enum):
    PASSPORT = "passport"
    ID_CARD = "id_card"
    DRIVER_LICENSE = "driver_license"


class PosTradeSideEnum(str, Enum):
    BUY_FROM_CUSTOMER = "buy_from_customer"
    SELL_TO_CUSTOMER = "sell_to_customer"


class PosRateSourceEnum(str, Enum):
    LIVE = "live"
    MANUAL = "manual"


class PosSessionStatusEnum(str, Enum):
    DRAFT = "draft"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"


class PosDocumentTypeEnum(str, Enum):
    SALE_INVOICE = "sale_invoice"
    PURCHASE_RECEIPT = "purchase_receipt"


EnumT = TypeVar("EnumT", bound=Enum)


def sqlalchemy_enum(enum_cls: type[EnumT], *, name: str) -> SqlEnum:
    return SqlEnum(
        enum_cls,
        name=name,
        values_callable=lambda enum_items: [item.value for item in enum_items],
    )
