from __future__ import annotations

from decimal import Decimal

import httpx
import pytest

from app.services.metals_dev import MetalsDevService

# Canlı API'den kaydedilmiş gerçek yanıt şekli (değerler kırpıldı).
_LATEST_PAYLOAD = {
    "status": "success",
    "currency": "DKK",
    "unit": "g",
    "metals": {
        "gold": 899.6851,
        "silver": 13.0086,
        "platinum": 355.914,
        "palladium": 266.3138,
        "lbma_gold_am": 910.3196,
    },
    "currencies": {"EUR": 7.4759},
    "timestamps": {"metal": "2026-08-19T05:48:13.287Z"},
}


def _reset_cache() -> None:
    MetalsDevService._cache_rates = None
    MetalsDevService._cache_observed_at = None
    MetalsDevService._cache_expires_at = None


def _client_factory_for(payload, status_code=200):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, json=payload)

    def factory(**kwargs):
        kwargs.pop("timeout", None)
        return httpx.AsyncClient(transport=httpx.MockTransport(handler))

    return factory


def test_disabled_without_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    _reset_cache()
    service = MetalsDevService()
    service.api_key = ""
    assert service.enabled is False


@pytest.mark.asyncio
async def test_fetch_rates_parses_dkk_per_gram(monkeypatch: pytest.MonkeyPatch) -> None:
    _reset_cache()
    service = MetalsDevService(client_factory=_client_factory_for(_LATEST_PAYLOAD))
    service.api_key = "test-key"

    fetched = await service.fetch_rates()
    assert fetched is not None
    rates, observed_at = fetched
    assert rates["gold"] == Decimal("899.69")
    assert rates["platinum"] == Decimal("355.91")
    assert rates["palladium"] == Decimal("266.31")
    # timestamp alanı yoksa da observed_at üretilir; burada now() fallback.
    assert observed_at

    # İkinci çağrı cache'ten döner (ağ yok — MockTransport çağrılmaz diye
    # kanıtlayamayız ama cached_rates dolu olmalı).
    assert MetalsDevService.cached_rates() is not None
    _reset_cache()


@pytest.mark.asyncio
async def test_fetch_rates_rejects_bad_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    _reset_cache()
    service = MetalsDevService(client_factory=_client_factory_for({"status": "error"}))
    service.api_key = "test-key"
    assert await service.fetch_rates() is None
    assert MetalsDevService.cached_rates() is None


@pytest.mark.asyncio
async def test_fetch_rates_survives_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    _reset_cache()
    service = MetalsDevService(client_factory=_client_factory_for({}, status_code=503))
    service.api_key = "test-key"
    assert await service.fetch_rates() is None
    _reset_cache()
