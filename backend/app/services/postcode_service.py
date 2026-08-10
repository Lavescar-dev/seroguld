from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging

import httpx

from app.schemas.pos import PosPostalLookupOut
from app.services.kds_address_service import KDS_ADDRESS_SOURCE, KdsAddressError, kds_address_service


logger = logging.getLogger(__name__)


POSTCODE_SOURCE = "dataforsyningen.dk"
POSTCODE_SOURCE_URL = "https://api.dataforsyningen.dk/postnumre"
POSTCODE_DATASET_VERSION = "dataforsyningen-postnumre-v1"
KDS_POSTCODE_DATASET_VERSION = "kds-adressevaelger-postnr-v1"
DATASET_NOT_AVAILABLE = "DATASET_NOT_AVAILABLE"


def normalize_danish_postcode(value: str) -> str:
    """Keep the existing POS contract: use the first four numeric digits."""
    return "".join(ch for ch in (value or "") if ch.isdigit())[:4]


def _first_named_item(value: object) -> str | None:
    if isinstance(value, list) and value:
        first = value[0]
        if isinstance(first, Mapping):
            name = str(first.get("navn") or "").strip()
            return name or None
        name = str(first or "").strip()
        return name or None
    if isinstance(value, Mapping):
        name = str(value.get("navn") or "").strip()
        return name or None
    text = str(value or "").strip()
    return text or None


@dataclass(frozen=True)
class _CachedPostcode:
    result: PosPostalLookupOut
    expires_at: datetime


class DanishPostcodeService:
    """Cache-first Danish postcode lookup with an honest offline contract.

    The public source is queried lazily per postcode. The cache is deliberately
    process-local: postcode lookups are reference data and must not write test
    or production rows to the CRM database. A stale cache is still returned if
    a refresh cannot reach the source.
    """

    def __init__(
        self,
        *,
        timeout_seconds: float = 4.0,
        cache_ttl_seconds: float = 24 * 60 * 60,
        client_factory: Callable[..., httpx.AsyncClient] | None = None,
        clock: Callable[[], datetime] | None = None,
        postal_district_fallback: Callable[[str], Awaitable[str | None]] | None = None,
    ) -> None:
        self.timeout_seconds = max(0.1, float(timeout_seconds))
        self.cache_ttl_seconds = max(0.0, float(cache_ttl_seconds))
        self.client_factory = client_factory
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self.postal_district_fallback = postal_district_fallback
        self._cache: dict[str, _CachedPostcode] = {}

    def clear_cache(self) -> None:
        self._cache.clear()

    def _now(self) -> datetime:
        now = self._clock()
        if now.tzinfo is None:
            return now.replace(tzinfo=timezone.utc)
        return now.astimezone(timezone.utc)

    def _cache_is_fresh(self, entry: _CachedPostcode, *, now: datetime) -> bool:
        return entry.expires_at > now

    def _cached_result(self, entry: _CachedPostcode, *, offline: bool) -> PosPostalLookupOut:
        source = entry.result.source or POSTCODE_SOURCE
        return entry.result.model_copy(
            update={
                "status": "OFFLINE_CACHE" if offline else "CACHE",
                "provenance": f"{'offline-cache' if offline else 'cache'}:{source}",
                "from_cache": True,
                "offline": offline,
                "error_code": None,
            }
        )

    async def _fetch_remote(self, normalized: str) -> PosPostalLookupOut | None:
        url = f"{POSTCODE_SOURCE_URL}/{normalized}"
        client_factory = self.client_factory or httpx.AsyncClient
        try:
            async with client_factory(
                timeout=self.timeout_seconds,
                follow_redirects=True,
            ) as client:
                response = await client.get(url, headers={"Accept": "application/json"})

            if response.status_code == 404:
                return PosPostalLookupOut(
                    postal_code=normalized,
                    found=False,
                    available=True,
                    status="NOT_FOUND",
                    source=POSTCODE_SOURCE,
                    provenance=f"network:{POSTCODE_SOURCE}",
                    version=POSTCODE_DATASET_VERSION,
                    fetched_at=self._now().isoformat(),
                )

            response.raise_for_status()
            payload = response.json() if getattr(response, "content", b"") else {}
            if not isinstance(payload, Mapping):
                raise ValueError("postcode response must be a JSON object")

            postal_district = str(payload.get("navn") or "").strip() or None
            result = PosPostalLookupOut(
                postal_code=normalized,
                found=bool(postal_district),
                available=True,
                status="FOUND" if postal_district else "NOT_FOUND",
                postal_district=postal_district,
                municipality_name=_first_named_item(payload.get("kommuner")),
                region_name=_first_named_item(payload.get("regioner")),
                source=POSTCODE_SOURCE,
                provenance=f"network:{POSTCODE_SOURCE}",
                version=POSTCODE_DATASET_VERSION,
                fetched_at=self._now().isoformat(),
            )
            return result
        except Exception as exc:  # noqa: BLE001 - network and malformed payload fallback
            logger.info("Danish postcode lookup unavailable for %s: %s", normalized, exc)
            return None

    async def _fetch_kds_fallback(self, normalized: str) -> PosPostalLookupOut | None:
        if self.postal_district_fallback is None:
            return None
        try:
            postal_district = await self.postal_district_fallback(normalized)
        except Exception as exc:  # noqa: BLE001 - manual entry remains available
            logger.info("KDS postcode fallback unavailable for %s: %s", normalized, type(exc).__name__)
            return None
        if not postal_district:
            return None
        return PosPostalLookupOut(
            postal_code=normalized,
            found=True,
            available=True,
            status="KDS_FALLBACK",
            postal_district=postal_district,
            source=KDS_ADDRESS_SOURCE,
            provenance=f"fallback:{KDS_ADDRESS_SOURCE}",
            version=KDS_POSTCODE_DATASET_VERSION,
            fetched_at=self._now().isoformat(),
        )

    async def lookup(self, postal_code: str, *, force_refresh: bool = False) -> PosPostalLookupOut:
        normalized = normalize_danish_postcode(postal_code)
        if len(normalized) != 4:
            raise ValueError("Postnr. 4 rakam olmalı.")

        now = self._now()
        entry = self._cache.get(normalized)
        if entry is not None and not force_refresh and self._cache_is_fresh(entry, now=now):
            return self._cached_result(entry, offline=False)

        remote_result = await self._fetch_remote(normalized)
        if remote_result is not None:
            self._cache[normalized] = _CachedPostcode(
                result=remote_result,
                expires_at=now + timedelta(seconds=self.cache_ttl_seconds),
            )
            return remote_result

        fallback_result = await self._fetch_kds_fallback(normalized)
        if fallback_result is not None:
            self._cache[normalized] = _CachedPostcode(
                result=fallback_result,
                expires_at=now + timedelta(seconds=self.cache_ttl_seconds),
            )
            return fallback_result

        if entry is not None:
            return self._cached_result(entry, offline=True)

        return PosPostalLookupOut(
            postal_code=normalized,
            found=False,
            available=False,
            status=DATASET_NOT_AVAILABLE,
            source=POSTCODE_SOURCE,
            provenance="none",
            version=POSTCODE_DATASET_VERSION,
            fetched_at=None,
            from_cache=False,
            offline=True,
            error_code=DATASET_NOT_AVAILABLE,
        )


async def _kds_postal_district_fallback(postal_code: str) -> str | None:
    try:
        return await kds_address_service.lookup_postal_district(postal_code)
    except (KdsAddressError, ValueError):
        return None


postcode_service = DanishPostcodeService(postal_district_fallback=_kds_postal_district_fallback)


async def lookup_danish_postal_code(
    postal_code: str,
    *,
    force_refresh: bool = False,
) -> PosPostalLookupOut:
    return await postcode_service.lookup(postal_code, force_refresh=force_refresh)


def clear_danish_postcode_cache() -> None:
    postcode_service.clear_cache()
