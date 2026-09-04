from __future__ import annotations

from decimal import Decimal

import httpx
import pytest

from app.services.ecb_fx import EcbFxService

# Canlı ECB SDMX csvdata yanıtından kaydedilmiş gerçek şekil (kolonlar başlık
# adıyla bulunur; sıra garanti edilmez).
_ECB_CSV = (
    "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\n"
    "EXR.D.DKK.EUR.SP00.A,D,DKK,EUR,SP00,A,2026-08-18,7.4759\n"
)


def _reset_cache() -> None:
    EcbFxService._cache_fx = None
    EcbFxService._cache_observed_at = None
    EcbFxService._cache_expires_at = None


def _client_factory_for(text: str, status_code: int = 200):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, text=text)

    def factory(**kwargs):
        kwargs.pop("timeout", None)
        return httpx.AsyncClient(transport=httpx.MockTransport(handler))

    return factory


@pytest.mark.asyncio
async def test_fetch_fx_parses_by_header_name() -> None:
    _reset_cache()
    service = EcbFxService(client_factory=_client_factory_for(_ECB_CSV))
    fetched = await service.fetch_fx()
    assert fetched is not None
    value, observed_at = fetched
    assert value == Decimal("7.4759")
    assert observed_at == "2026-08-18"
    assert EcbFxService.cached_fx() is not None
    _reset_cache()


@pytest.mark.asyncio
async def test_fetch_fx_handles_reordered_columns() -> None:
    _reset_cache()
    csv_text = "OBS_VALUE,TIME_PERIOD,KEY\n7.4600,2026-08-17,EXR.D.DKK.EUR.SP00.A\n"
    service = EcbFxService(client_factory=_client_factory_for(csv_text))
    fetched = await service.fetch_fx()
    assert fetched is not None
    assert fetched[0] == Decimal("7.4600")
    _reset_cache()


@pytest.mark.asyncio
async def test_fetch_fx_returns_none_on_error() -> None:
    _reset_cache()
    service = EcbFxService(client_factory=_client_factory_for("", status_code=503))
    assert await service.fetch_fx() is None
    assert EcbFxService.cached_fx() is None


@pytest.mark.asyncio
async def test_fetch_fx_logs_network_failure(caplog) -> None:
    """Kaynak düşüşü sessiz None'a inmez — log'da iz kalır."""
    _reset_cache()

    def handler(request: httpx.Request):
        raise httpx.ConnectError("ecb kapalı")

    def factory(**kwargs):
        kwargs.pop("timeout", None)
        return httpx.AsyncClient(transport=httpx.MockTransport(handler))

    service = EcbFxService(client_factory=factory)
    with caplog.at_level("WARNING", logger="app.services.ecb_fx"):
        assert await service.fetch_fx() is None

    assert any("ECB EUR/DKK kuru çekilemedi" in record.message for record in caplog.records)
    _reset_cache()


@pytest.mark.asyncio
async def test_fetch_fx_rejects_garbage_csv() -> None:
    _reset_cache()
    service = EcbFxService(client_factory=_client_factory_for("not,a,sdmx\n1,2,3\n"))
    assert await service.fetch_fx() is None
    _reset_cache()
