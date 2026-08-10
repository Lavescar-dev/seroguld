from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging
import re

import httpx

from app.config import get_settings
from app.schemas.address import KdsAddressResolveOut, KdsAddressSearchOut, KdsAddressSearchSuggestionOut


LOGGER = logging.getLogger(__name__)
KDS_ADDRESS_SOURCE = "adressevaelger.dk"

_POSTAL_CITY_RE = re.compile(r"^(?P<address>.*?)(?:,\s*|\s+)(?P<postal_code>\d{4})\s+(?P<city>[^,]+)$")


class KdsAddressError(Exception):
    def __init__(self, *, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


@dataclass(frozen=True)
class _CachedValue:
    value: KdsAddressSearchOut | KdsAddressResolveOut
    expires_at: datetime


@dataclass(frozen=True)
class _CachedPostalDistrict:
    value: str | None
    expires_at: datetime


def _clean_text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _as_mapping(value: object) -> Mapping[str, object] | None:
    return value if isinstance(value, Mapping) else None


def _extract_postal_city(title: str | None) -> tuple[str | None, str | None, str | None]:
    """Return CRM address line, postal code and postal district from DAR text."""

    clean_title = _clean_text(title)
    if not clean_title:
        return None, None, None
    match = _POSTAL_CITY_RE.match(clean_title)
    if match is None:
        return clean_title, None, None
    address = match.group("address").strip(" ,") or None
    postal_code = match.group("postal_code")
    city = match.group("city").strip() or None
    return address, postal_code, city


def _address_components(raw: Mapping[str, object]) -> tuple[str | None, str | None, str | None, str | None]:
    """Read KDS' documented address/husnummer response without exposing it raw."""

    title = _clean_text(raw.get("adressebetegnelse")) or _clean_text(raw.get("adgangsadressebetegnelse"))
    address, postal_code, city = _extract_postal_city(title)
    house = _as_mapping(raw.get("husnummer"))
    if house is not None:
        house_title = _clean_text(house.get("adgangsadressebetegnelse"))
        _, house_postal_code, house_city = _extract_postal_city(house_title)
        postal_code = postal_code or house_postal_code
        city = city or house_city
    return title, address, postal_code, city


class KdsAddressService:
    """Small server-side adapter for KDS Adressevælger.

    KDS requires a query-string token.  This adapter deliberately owns the
    request and caches short-lived lookup data, so browsers only receive the
    selected address data and can always fall back to manual entry on errors.
    """

    def __init__(
        self,
        *,
        base_url: str,
        token: str,
        timeout_seconds: float = 4.0,
        cache_ttl_seconds: float = 300.0,
        client_factory: Callable[..., httpx.AsyncClient] | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token.strip()
        self.timeout_seconds = max(0.1, float(timeout_seconds))
        self.cache_ttl_seconds = max(0.0, float(cache_ttl_seconds))
        self.client_factory = client_factory
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._search_cache: dict[tuple[str, str | None, int], _CachedValue] = {}
        self._resolve_cache: dict[str, _CachedValue] = {}
        self._postal_district_cache: dict[str, _CachedPostalDistrict] = {}

    def clear_cache(self) -> None:
        self._search_cache.clear()
        self._resolve_cache.clear()
        self._postal_district_cache.clear()

    def _now(self) -> datetime:
        now = self._clock()
        return now.replace(tzinfo=timezone.utc) if now.tzinfo is None else now.astimezone(timezone.utc)

    def _cache_get(
        self,
        cache: dict[object, _CachedValue],
        key: object,
    ) -> KdsAddressSearchOut | KdsAddressResolveOut | None:
        entry = cache.get(key)
        if entry is None or entry.expires_at <= self._now():
            return None
        return entry.value.model_copy(deep=True)

    def _cache_put(
        self,
        cache: dict[object, _CachedValue],
        key: object,
        value: KdsAddressSearchOut | KdsAddressResolveOut,
    ) -> None:
        cache[key] = _CachedValue(
            value=value.model_copy(deep=True),
            expires_at=self._now() + timedelta(seconds=self.cache_ttl_seconds),
        )

    def _assert_configured(self) -> None:
        if self.base_url and self.token:
            return
        raise KdsAddressError(
            status_code=503,
            code="address_lookup_not_configured",
            message="Adresseopslag er ikke sat op. Indtast adressen manuelt.",
        )

    async def _get_json(self, path: str, *, params: Mapping[str, object]) -> Mapping[str, object]:
        self._assert_configured()
        request_params = {"token": self.token, **params}
        client_factory = self.client_factory or httpx.AsyncClient
        try:
            async with client_factory(timeout=self.timeout_seconds, follow_redirects=True) as client:
                response = await client.get(
                    f"{self.base_url}/{path.lstrip('/')}",
                    params=request_params,
                    headers={"Accept": "application/json"},
                )
        except (httpx.HTTPError, OSError, ValueError) as exc:
            # Do not log ``exc``: httpx may include the request URL and its
            # query token in a transport error string.
            LOGGER.info("KDS Adressevælger is unavailable (%s)", type(exc).__name__)
            raise KdsAddressError(
                status_code=503,
                code="address_lookup_unavailable",
                message="Adresseopslag er midlertidigt utilgængeligt. Indtast adressen manuelt.",
            ) from exc

        if response.status_code == 404:
            raise KdsAddressError(
                status_code=404,
                code="address_not_found",
                message="Adressen findes ikke længere. Søg igen eller indtast den manuelt.",
            )
        if response.status_code >= 400:
            LOGGER.info("KDS Adressevælger returned HTTP %s", response.status_code)
            raise KdsAddressError(
                status_code=503,
                code="address_lookup_unavailable",
                message="Adresseopslag er midlertidigt utilgængeligt. Indtast adressen manuelt.",
            )
        try:
            payload = response.json()
        except ValueError as exc:
            LOGGER.info("KDS Adressevælger returned invalid JSON")
            raise KdsAddressError(
                status_code=503,
                code="address_lookup_unavailable",
                message="Adresseopslag er midlertidigt utilgængeligt. Indtast adressen manuelt.",
            ) from exc
        mapping = _as_mapping(payload)
        if mapping is None or str(mapping.get("status") or "").lower() != "ok":
            LOGGER.info("KDS Adressevælger returned an unexpected payload status")
            raise KdsAddressError(
                status_code=503,
                code="address_lookup_unavailable",
                message="Adresseopslag er midlertidigt utilgængeligt. Indtast adressen manuelt.",
            )
        return mapping

    async def search(
        self,
        query: str,
        *,
        postal_code: str | None = None,
        limit: int = 10,
    ) -> KdsAddressSearchOut:
        text = query.strip()
        if not text:
            raise ValueError("Adresse-søgning må ikke være tom.")
        if len(text) > 73:
            raise ValueError("Adresse-søgning må højst være 73 tegn.")
        if postal_code is not None and not re.fullmatch(r"\d{4}", postal_code):
            raise ValueError("Postnr. skal bestå af præcis 4 cifre.")
        bounded_limit = max(1, min(int(limit), 10))
        cache_key = (text.casefold(), postal_code, bounded_limit)
        cached = self._cache_get(self._search_cache, cache_key)
        if isinstance(cached, KdsAddressSearchOut):
            return cached

        params: dict[str, object] = {"tekst": text, "maksimum": bounded_limit}
        if postal_code:
            params["postnummer"] = postal_code
        payload = await self._get_json("adresser/soeg", params=params)
        raw_results = payload.get("fund")
        results: list[KdsAddressSearchSuggestionOut] = []
        if isinstance(raw_results, list):
            for raw in raw_results:
                item = _as_mapping(raw)
                if item is None or str(item.get("type") or "").strip().lower() != "adresse":
                    continue
                identifier = _clean_text(item.get("id"))
                title = _clean_text(item.get("titel"))
                if not identifier or not title:
                    continue
                _, hit_postal_code, hit_city = _extract_postal_city(title)
                # KDS documents that ``postnummer`` may not always constrain
                # free-text queries.  The CRM applies the filter again to
                # prevent an address from another postcode appearing in UI.
                if postal_code is not None and hit_postal_code != postal_code:
                    continue
                results.append(
                    KdsAddressSearchSuggestionOut(
                        id=identifier,
                        title=title,
                        type="adresse",
                        postal_code=hit_postal_code,
                        city=hit_city,
                    )
                )
                if len(results) >= bounded_limit:
                    break

        result = KdsAddressSearchOut(available=True, results=results)
        self._cache_put(self._search_cache, cache_key, result)
        return result

    async def resolve(self, address_id: str, *, postal_code: str | None = None) -> KdsAddressResolveOut:
        identifier = address_id.strip()
        if not re.fullmatch(r"[0-9a-fA-F-]{36}", identifier):
            raise ValueError("Adresse-id har et ugyldigt format.")
        if postal_code is not None and not re.fullmatch(r"\d{4}", postal_code):
            raise ValueError("Postnr. skal bestå af præcis 4 cifre.")
        cached = self._cache_get(self._resolve_cache, identifier)
        if isinstance(cached, KdsAddressResolveOut):
            result = cached
        else:
            payload = await self._get_json(f"adresser/{identifier}", params={})
            raw_address = _as_mapping(payload.get("adresse"))
            if raw_address is None:
                raise KdsAddressError(
                    status_code=404,
                    code="address_not_found",
                    message="Adressen findes ikke længere. Søg igen eller indtast den manuelt.",
                )
            title, address, resolved_postal_code, city = _address_components(raw_address)
            if not title or not address or not resolved_postal_code or not city:
                LOGGER.info("KDS Adressevælger resolve response lacked CRM address fields")
                raise KdsAddressError(
                    status_code=503,
                    code="address_lookup_unavailable",
                    message="Adresseopslag kunne ikke færdiggøre adressen. Indtast den manuelt.",
                )
            result = KdsAddressResolveOut(
                id=_clean_text(raw_address.get("id_lokalid")) or identifier,
                title=title,
                address=address,
                postal_code=resolved_postal_code,
                city=city,
            )
            self._cache_put(self._resolve_cache, identifier, result)

        if postal_code is not None and result.postal_code != postal_code:
            raise KdsAddressError(
                status_code=409,
                code="address_postal_code_mismatch",
                message="Den valgte adresse matcher ikke det indtastede postnr. Søg igen eller indtast den manuelt.",
            )
        return result

    async def lookup_postal_district(self, postal_code: str) -> str | None:
        """Find a postdistrikt through KDS when the legacy postcode API is down."""

        if not re.fullmatch(r"\d{4}", postal_code):
            raise ValueError("Postnr. skal bestå af præcis 4 cifre.")
        cached = self._postal_district_cache.get(postal_code)
        if cached is not None and cached.expires_at > self._now():
            return cached.value

        payload = await self._get_json(
            "soeg",
            params={"tekst": postal_code, "maal": "navngivenvejpostnummer", "maksimum": 10},
        )
        postal_district: str | None = None
        raw_results = payload.get("fund")
        if isinstance(raw_results, list):
            for raw in raw_results:
                item = _as_mapping(raw)
                if item is None or str(item.get("postnr") or "").strip() != postal_code:
                    continue
                postal_district = _clean_text(item.get("postdistrikt"))
                if postal_district:
                    break
        self._postal_district_cache[postal_code] = _CachedPostalDistrict(
            value=postal_district,
            expires_at=self._now() + timedelta(seconds=self.cache_ttl_seconds),
        )
        return postal_district


_settings = get_settings()
kds_address_service = KdsAddressService(
    base_url=_settings.kds_address_base_url,
    token=_settings.kds_address_token,
    timeout_seconds=_settings.kds_address_timeout_seconds,
    cache_ttl_seconds=_settings.kds_address_cache_seconds,
)
