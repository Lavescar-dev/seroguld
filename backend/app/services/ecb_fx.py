from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Callable

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

DEFAULT_EUR_DKK_FX = Decimal("7.45")


class EcbFxService:
    """Resmi ECB veri API'sinden EUR/DKK referans kuru (anahtarsız).

    Günlük referans kur olduğu için cache uzun tutulur (varsayılan 3600 sn).
    `cached_fx()` asla ağa çıkmaz; mutation yolları yalnız onu kullanmalıdır.
    """

    _cache_fx: Decimal | None = None
    _cache_observed_at: str | None = None
    _cache_expires_at: datetime | None = None

    def __init__(self, client_factory: Callable[..., httpx.AsyncClient] | None = None) -> None:
        settings = get_settings()
        self.url = settings.ecb_fx_url
        self.timeout_seconds = max(2.0, float(settings.ecb_fx_timeout_seconds))
        self.cache_seconds = max(60, int(settings.ecb_fx_cache_seconds))
        self._client_factory = client_factory or httpx.AsyncClient

    @classmethod
    def _now(cls) -> datetime:
        return datetime.now(timezone.utc)

    @classmethod
    def _cache_is_valid(cls) -> bool:
        return (
            cls._cache_fx is not None
            and cls._cache_expires_at is not None
            and cls._cache_expires_at > cls._now()
        )

    @classmethod
    def cached_fx(cls) -> tuple[Decimal, str | None] | None:
        if cls._cache_is_valid():
            return cls._cache_fx, cls._cache_observed_at  # type: ignore[return-value]
        return None

    @classmethod
    def _parse_csv(cls, text: str) -> tuple[Decimal, str | None] | None:
        # SDMX csvdata: sütunlar başlık adıyla bulunur (pozisyon garanti değil).
        try:
            reader = csv.DictReader(io.StringIO(text))
            rows = [row for row in reader if row.get("OBS_VALUE")]
        except csv.Error:
            return None
        if not rows:
            return None
        last = rows[-1]
        try:
            value = Decimal(str(last["OBS_VALUE"]).strip())
        except (InvalidOperation, KeyError, TypeError, ValueError):
            return None
        if value <= 0:
            return None
        observed_at = (last.get("TIME_PERIOD") or "").strip() or None
        return value, observed_at

    async def fetch_fx(self) -> tuple[Decimal, str | None] | None:
        cached = self.cached_fx()
        if cached is not None:
            return cached
        try:
            async with self._client_factory(timeout=self.timeout_seconds) as client:
                response = await client.get(self.url, headers={"Accept": "text/csv"})
                response.raise_for_status()
        except Exception as exc:
            logger.warning("ECB EUR/DKK kuru çekilemedi (varsayılan kur kullanılacak): %s", exc)
            return None
        parsed = self._parse_csv(response.text)
        if parsed is None:
            return None
        value, observed_at = parsed
        cls = type(self)
        cls._cache_fx = value
        cls._cache_observed_at = observed_at
        cls._cache_expires_at = self._now() + timedelta(seconds=self.cache_seconds)
        return value, observed_at
