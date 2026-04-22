from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

import httpx

from app.config import get_settings
from app.utils.helpers import quantize_2


class GoldPriceService:
    """Fetches live metal rates (DKK/gram) with fallback defaults."""

    _TROY_OUNCE_GRAMS = Decimal("31.1034768")
    _SYMBOLS = {
        "gold": "xauusd",
        "silver": "xagusd",
        "platinum": "xptusd",
        "palladium": "xpdusd",
    }
    _FX_SYMBOL = "usddkk"
    _STOOQ_CSV_URL = "https://stooq.com/q/l/?s={symbol}&f=sd2t2ohlcv&h&e=csv"
    _FALLBACK_RATES = {
        "gold": Decimal("615.50"),
        "silver": Decimal("7.80"),
        "platinum": Decimal("255.00"),
        "palladium": Decimal("268.00"),
    }

    _cache_rates: dict[str, Decimal] | None = None
    _cache_expires_at: datetime | None = None

    def __init__(self) -> None:
        settings = get_settings()
        self.timeout_seconds = max(2.0, float(settings.gold_price_timeout_seconds))
        self.cache_seconds = max(3, int(settings.gold_price_cache_seconds))
        self.live_enabled = bool(settings.gold_price_live_enabled)

    @classmethod
    def _now(cls) -> datetime:
        return datetime.now(timezone.utc)

    @classmethod
    def _cache_is_valid(cls) -> bool:
        return (
            cls._cache_rates is not None
            and cls._cache_expires_at is not None
            and cls._cache_expires_at > cls._now()
        )

    @classmethod
    def _set_cache(cls, rates: dict[str, Decimal], cache_seconds: int) -> None:
        cls._cache_rates = dict(rates)
        cls._cache_expires_at = cls._now() + timedelta(seconds=cache_seconds)

    @classmethod
    def _parse_stooq_close(cls, csv_text: str) -> Decimal | None:
        lines = [line.strip() for line in csv_text.splitlines() if line.strip()]
        if len(lines) < 2:
            return None

        values = lines[1].split(",")
        if len(values) < 7:
            return None

        close_raw = values[6].strip()
        if close_raw in {"", "N/D", "-"}:
            return None

        try:
            close_value = Decimal(close_raw)
        except InvalidOperation:
            return None

        if close_value <= 0:
            return None
        return close_value

    @classmethod
    def _convert_usd_ounce_to_dkk_gram(cls, usd_per_ounce: Decimal, usd_dkk: Decimal) -> Decimal:
        return quantize_2((usd_per_ounce * usd_dkk) / cls._TROY_OUNCE_GRAMS)

    async def _fetch_stooq_close(self, client: httpx.AsyncClient, symbol: str) -> Decimal | None:
        try:
            response = await client.get(self._STOOQ_CSV_URL.format(symbol=symbol))
            response.raise_for_status()
        except Exception:
            return None
        return self._parse_stooq_close(response.text)

    async def _fetch_live_rates(self) -> dict[str, Decimal] | None:
        headers = {"User-Agent": "SeroGuldCRM/1.0 (+local demo)"}
        async with httpx.AsyncClient(timeout=self.timeout_seconds, headers=headers) as client:
            usd_dkk = await self._fetch_stooq_close(client, self._FX_SYMBOL)
            if usd_dkk is None:
                return None

            rates: dict[str, Decimal] = {}
            for metal_key, symbol in self._SYMBOLS.items():
                usd_per_ounce = await self._fetch_stooq_close(client, symbol)
                if usd_per_ounce is None:
                    return None
                rates[metal_key] = self._convert_usd_ounce_to_dkk_gram(usd_per_ounce, usd_dkk)

            return rates

    async def get_rates(self, *, force_refresh: bool = False) -> dict[str, Decimal]:
        if not force_refresh and self._cache_is_valid():
            return dict(self._cache_rates or {})

        live_rates: dict[str, Decimal] | None = None
        if self.live_enabled:
            live_rates = await self._fetch_live_rates()

        rates = live_rates or dict(self._FALLBACK_RATES)
        self._set_cache(rates, self.cache_seconds)
        return dict(rates)
