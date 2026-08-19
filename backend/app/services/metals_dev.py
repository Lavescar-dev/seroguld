from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Callable

import httpx

from app.config import get_settings
from app.utils.helpers import quantize_2

_METAL_KEYS = ("gold", "silver", "platinum", "palladium")


class MetalsDevService:
    """Metals.Dev /v1/latest — tek çağrıda dört metal, doğrudan DKK/gram.

    Anahtar (METALS_DEV_API_KEY) boşsa servis devre dışıdır; çağıranlar
    Stooq/fallback zincirine düşer.  Cache cömerttir (varsayılan 1800 sn) —
    plan kotasına saygı ve mutation yollarında ağ I/O'su yasağı nedeniyle
    `cached_rates()` hiçbir zaman ağa çıkmaz.
    """

    _cache_rates: dict[str, Decimal] | None = None
    _cache_observed_at: str | None = None
    _cache_expires_at: datetime | None = None

    def __init__(self, client_factory: Callable[..., httpx.AsyncClient] | None = None) -> None:
        settings = get_settings()
        self.api_key = (settings.metals_dev_api_key or "").strip()
        self.url = settings.metals_dev_url
        self.timeout_seconds = max(2.0, float(settings.metals_dev_timeout_seconds))
        self.cache_seconds = max(60, int(settings.metals_dev_cache_seconds))
        self._client_factory = client_factory or httpx.AsyncClient

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

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
    def cached_rates(cls) -> tuple[dict[str, Decimal], str | None] | None:
        if cls._cache_is_valid():
            return dict(cls._cache_rates or {}), cls._cache_observed_at
        return None

    @classmethod
    def _parse_payload(cls, payload: Any) -> dict[str, Decimal] | None:
        if not isinstance(payload, dict) or payload.get("status") != "success":
            return None
        metals = payload.get("metals")
        if not isinstance(metals, dict):
            return None
        rates: dict[str, Decimal] = {}
        for key in _METAL_KEYS:
            raw = metals.get(key)
            try:
                value = Decimal(str(raw))
            except (InvalidOperation, TypeError, ValueError):
                return None
            if value <= 0:
                return None
            rates[key] = quantize_2(value)
        return rates

    async def fetch_rates(self) -> tuple[dict[str, Decimal], str | None] | None:
        """Canlı DKK/gram oranları çeker; başarıda cache'i doldurur."""
        if not self.enabled:
            return None
        cached = self.cached_rates()
        if cached is not None:
            return cached
        params = {"api_key": self.api_key, "currency": "DKK", "unit": "g"}
        try:
            async with self._client_factory(timeout=self.timeout_seconds) as client:
                response = await client.get(self.url, params=params, headers={"Accept": "application/json"})
                response.raise_for_status()
                payload = response.json()
        except Exception:
            return None
        rates = self._parse_payload(payload)
        if rates is None:
            return None
        # /spot düz "timestamp", /latest "timestamps.metal" taşır.
        raw_timestamp = payload.get("timestamp")
        if not raw_timestamp and isinstance(payload.get("timestamps"), dict):
            raw_timestamp = payload["timestamps"].get("metal")
        observed_at = str(raw_timestamp) if raw_timestamp else self._now().isoformat()
        cls = type(self)
        cls._cache_rates = dict(rates)
        cls._cache_observed_at = observed_at
        cls._cache_expires_at = self._now() + timedelta(seconds=self.cache_seconds)
        return dict(rates), observed_at
