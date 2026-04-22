from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def quantize_2(value: Decimal | float | int) -> Decimal:
    decimal_value = value if isinstance(value, Decimal) else Decimal(str(value))
    return decimal_value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def to_decimal(value: Decimal | float | int | str | None, default: str = "0") -> Decimal:
    if value is None:
        return Decimal(default)
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))
