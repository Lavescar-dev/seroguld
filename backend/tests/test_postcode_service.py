from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.services.postcode_service import (
    DATASET_NOT_AVAILABLE,
    POSTCODE_DATASET_VERSION,
    DanishPostcodeService,
)


class FakeResponse:
    def __init__(self, *, status_code: int = 200, payload: object | None = None) -> None:
        self.status_code = status_code
        self._payload = payload
        self.content = b"{}" if payload is not None else b""

    def json(self) -> object:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeClient:
    def __init__(self, response: FakeResponse | None = None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error

    async def __aenter__(self) -> "FakeClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    async def get(self, url: str, *, headers: dict[str, str]) -> FakeResponse:
        if self.error is not None:
            raise self.error
        assert url.endswith("/1000")
        assert headers == {"Accept": "application/json"}
        return self.response or FakeResponse()


class FakeClientFactory:
    def __init__(self, *responses: FakeResponse, error: Exception | None = None) -> None:
        self.responses = list(responses)
        self.error = error
        self.calls = 0

    def __call__(self, **kwargs) -> FakeClient:
        assert kwargs["timeout"] == 4.0
        assert kwargs["follow_redirects"] is True
        index = min(self.calls, len(self.responses) - 1) if self.responses else 0
        response = self.responses[index] if self.responses else None
        self.calls += 1
        return FakeClient(response=response, error=self.error)


def _clock() -> datetime:
    return datetime(2026, 8, 8, 12, 0, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_network_lookup_records_source_version_and_fetched_at() -> None:
    factory = FakeClientFactory(
        FakeResponse(
            payload={
                "navn": "Kobenhavn V",
                "kommuner": [{"navn": "Kobenhavns Kommune"}],
                "regioner": [{"navn": "Region Hovedstaden"}],
            }
        )
    )
    service = DanishPostcodeService(client_factory=factory, clock=_clock)

    result = await service.lookup("DK-1000")

    assert result.postal_code == "1000"
    assert result.found is True
    assert result.available is True
    assert result.status == "FOUND"
    assert result.source == "dataforsyningen.dk"
    assert result.provenance == "network:dataforsyningen.dk"
    assert result.version == POSTCODE_DATASET_VERSION
    assert result.fetched_at == "2026-08-08T12:00:00+00:00"
    assert result.from_cache is False
    assert result.offline is False
    assert factory.calls == 1


@pytest.mark.asyncio
async def test_lookup_is_cache_first_and_caches_not_found_per_code() -> None:
    factory = FakeClientFactory(FakeResponse(status_code=404))
    service = DanishPostcodeService(client_factory=factory, clock=_clock)

    first = await service.lookup("1000")
    second = await service.lookup("1000")

    assert first.found is False
    assert first.available is True
    assert first.status == "NOT_FOUND"
    assert second.status == "CACHE"
    assert second.from_cache is True
    assert second.provenance == "cache:dataforsyningen.dk"
    assert second.fetched_at == first.fetched_at
    assert factory.calls == 1


@pytest.mark.asyncio
async def test_offline_refresh_falls_back_to_previous_cache() -> None:
    factory = FakeClientFactory(FakeResponse(payload={"navn": "Kobenhavn V"}))
    service = DanishPostcodeService(client_factory=factory, clock=_clock)
    online = await service.lookup("1000")
    factory.error = RuntimeError("offline")

    offline = await service.lookup("1000", force_refresh=True)

    assert offline.available is True
    assert offline.found is True
    assert offline.status == "OFFLINE_CACHE"
    assert offline.from_cache is True
    assert offline.offline is True
    assert offline.provenance == "offline-cache:dataforsyningen.dk"
    assert offline.fetched_at == online.fetched_at
    assert factory.calls == 2


@pytest.mark.asyncio
async def test_missing_cache_reports_dataset_not_available_without_db_write() -> None:
    factory = FakeClientFactory(error=RuntimeError("offline"))
    service = DanishPostcodeService(client_factory=factory, clock=_clock)

    result = await service.lookup("1000")

    assert result.available is False
    assert result.found is False
    assert result.status == DATASET_NOT_AVAILABLE
    assert result.error_code == DATASET_NOT_AVAILABLE
    assert result.provenance == "none"
    assert result.version == POSTCODE_DATASET_VERSION
    assert result.fetched_at is None
    assert result.offline is True
    assert factory.calls == 1


@pytest.mark.asyncio
async def test_kds_fallback_preserves_postal_lookup_when_legacy_source_is_down() -> None:
    factory = FakeClientFactory(error=RuntimeError("legacy source offline"))

    async def kds_fallback(postal_code: str) -> str | None:
        assert postal_code == "1000"
        return "København K"

    service = DanishPostcodeService(
        client_factory=factory,
        postal_district_fallback=kds_fallback,
        clock=_clock,
    )

    result = await service.lookup("1000")

    assert result.found is True
    assert result.available is True
    assert result.status == "KDS_FALLBACK"
    assert result.postal_district == "København K"
    assert result.source == "adressevaelger.dk"
    assert result.provenance == "fallback:adressevaelger.dk"
    assert factory.calls == 1


def test_invalid_postcode_is_rejected_before_network() -> None:
    factory = FakeClientFactory(error=RuntimeError("network must not run"))
    service = DanishPostcodeService(client_factory=factory, clock=_clock)

    with pytest.raises(ValueError, match="4 rakam"):
        import asyncio

        asyncio.run(service.lookup("12"))

    assert factory.calls == 0
