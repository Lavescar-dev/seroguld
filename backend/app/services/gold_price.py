from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from app.config import get_settings
from app.services.ecb_fx import DEFAULT_EUR_DKK_FX, EcbFxService
from app.services.metals_dev import MetalsDevService
from app.utils.helpers import quantize_2


class GoldPriceService:
    """Canlı metal oranları (DKK/gram) — katmanlı kaynak zinciri.

    Metal başına bağımsız çözüm: Metals.Dev (anahtar varsa, tek toplu çağrı)
    → Stooq (USD/oz × USD/DKK) → sabit fallback.  Bir metalin kaynağı düşse
    bile diğerleri canlı kalır; her değerin yanında kaynak/zaman/bayatlık
    metadatası tutulur.
    """

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
    _cache_meta: dict[str, dict[str, Any]] | None = None
    _cache_expires_at: datetime | None = None

    def __init__(self) -> None:
        settings = get_settings()
        self.timeout_seconds = max(2.0, float(settings.gold_price_timeout_seconds))
        self.cache_seconds = max(3, int(settings.gold_price_cache_seconds))
        self.live_enabled = bool(settings.market_rates_live_enabled)
        # Stooq Pt/Pd sembolleri hedef makinede doğrulanana kadar ayarlanabilir.
        self._SYMBOLS = dict(self._SYMBOLS)
        platinum_symbol = (getattr(settings, "stooq_symbol_platinum", "") or "").strip()
        palladium_symbol = (getattr(settings, "stooq_symbol_palladium", "") or "").strip()
        if platinum_symbol:
            self._SYMBOLS["platinum"] = platinum_symbol
        if palladium_symbol:
            self._SYMBOLS["palladium"] = palladium_symbol

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
    def _set_cache(cls, rates: dict[str, Decimal], meta: dict[str, dict[str, Any]], cache_seconds: int) -> None:
        cls._cache_rates = dict(rates)
        cls._cache_meta = {key: dict(value) for key, value in meta.items()}
        cls._cache_expires_at = cls._now() + timedelta(seconds=cache_seconds)

    @classmethod
    def _fallback_meta(cls) -> dict[str, dict[str, Any]]:
        return {
            key: {"source": "fallback", "observed_at": None, "stale": True}
            for key in cls._FALLBACK_RATES
        }

    @classmethod
    def cached_rates_or_fallback(cls) -> dict[str, Decimal]:
        """Return rates without performing network I/O.

        Workspace writes run inside the SQLite transaction that claims the
        workspace revision.  Calling ``get_rates`` from that transaction can
        hold the write lock while the feed is unavailable, which turns a
        normal row edit into a browser ``Load failed`` error.  Read-only
        callers may still use ``get_rates``; mutation paths use this
        deterministic helper.
        """
        if cls._cache_is_valid():
            return dict(cls._cache_rates or {})
        return dict(cls._FALLBACK_RATES)

    @classmethod
    def cached_meta_or_fallback(cls) -> dict[str, dict[str, Any]]:
        if cls._cache_is_valid() and cls._cache_meta:
            return {key: dict(value) for key, value in cls._cache_meta.items()}
        return cls._fallback_meta()

    @classmethod
    def cached_auto_values_or_fallback(cls) -> dict[str, dict[str, Any]]:
        """Profilin oto değerleri (fx, Pt, Pd) — ağ I/O'su olmadan."""
        rates = cls.cached_rates_or_fallback()
        meta = cls.cached_meta_or_fallback()
        fx_cached = EcbFxService.cached_fx()
        if fx_cached is not None:
            fx_value, fx_observed = fx_cached
            fx_entry: dict[str, Any] = {"value": fx_value, "source": "live", "observed_at": fx_observed, "stale": False}
        else:
            fx_entry = {"value": DEFAULT_EUR_DKK_FX, "source": "fallback", "observed_at": None, "stale": True}
        return {
            "eur_dkk_fx": fx_entry,
            "platinum_dkk": {"value": rates.get("platinum"), **meta.get("platinum", {})},
            "palladium_dkk": {"value": rates.get("palladium"), **meta.get("palladium", {})},
        }

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

    async def _fetch_live_rates(self) -> tuple[dict[str, Decimal], dict[str, dict[str, Any]]]:
        """Metal başına bağımsız çözüm; asla topluca başarısız olmaz."""
        rates: dict[str, Decimal] = {}
        meta: dict[str, dict[str, Any]] = {}

        metals_dev = MetalsDevService()
        if metals_dev.enabled:
            fetched = await metals_dev.fetch_rates()
            if fetched is not None:
                dev_rates, observed_at = fetched
                for key, value in dev_rates.items():
                    rates[key] = value
                    meta[key] = {"source": "live", "observed_at": observed_at, "stale": False}

        missing = [key for key in self._FALLBACK_RATES if key not in rates]
        if missing:
            headers = {"User-Agent": "SeroGuldCRM/1.0 (+local demo)"}
            async with httpx.AsyncClient(timeout=self.timeout_seconds, headers=headers) as client:
                usd_dkk = await self._fetch_stooq_close(client, self._FX_SYMBOL)
                observed_at = self._now().isoformat()
                for metal_key in missing:
                    close = (
                        await self._fetch_stooq_close(client, self._SYMBOLS[metal_key])
                        if usd_dkk is not None
                        else None
                    )
                    if close is not None and usd_dkk is not None:
                        rates[metal_key] = self._convert_usd_ounce_to_dkk_gram(close, usd_dkk)
                        meta[metal_key] = {"source": "live", "observed_at": observed_at, "stale": False}
                    else:
                        rates[metal_key] = self._FALLBACK_RATES[metal_key]
                        meta[metal_key] = {"source": "fallback", "observed_at": None, "stale": True}

        return rates, meta

    async def get_rates(self, *, force_refresh: bool = False) -> dict[str, Decimal]:
        if not force_refresh and self._cache_is_valid():
            return dict(self._cache_rates or {})

        if self.live_enabled:
            rates, meta = await self._fetch_live_rates()
        else:
            rates, meta = dict(self._FALLBACK_RATES), self._fallback_meta()
        self._set_cache(rates, meta, self.cache_seconds)
        return dict(rates)

    async def get_auto_values(self) -> dict[str, dict[str, Any]]:
        """Profilin oto değerleri (fx, Pt, Pd) — taze çekim serbest."""
        await self.get_rates()
        fx_fetched = await EcbFxService().fetch_fx()
        result = self.cached_auto_values_or_fallback()
        if fx_fetched is not None:
            fx_value, fx_observed = fx_fetched
            result["eur_dkk_fx"] = {"value": fx_value, "source": "live", "observed_at": fx_observed, "stale": False}
        return result
