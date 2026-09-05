"""M3 — Woo hata yanıtlarında ham upstream/exception metni sızmamalı.

Eski davranış: bağlantı hatasında str(exc) (iç URL/host içerebilir) ve
upstream gövdesinden 500 char detail'e kopyalanıyordu. Yeni sözleşme:
istemciye kategorik mesaj (+ hata tipi), ham gövde/neden yalnız sunucu
logunda.
"""

import asyncio
import json
import logging

import httpx
import pytest
from fastapi import HTTPException

from app.services.woocommerce import WooCommerceService


class _ErrorResponseClient:
    """httpx.AsyncClient yerine geçer; .request çağrısını taklit eder."""

    def __init__(self, response=None, exc: Exception | None = None, **kwargs) -> None:
        self._response = response
        self._exc = exc

    async def __aenter__(self) -> "_ErrorResponseClient":
        return self

    async def __aexit__(self, *args) -> None:
        return None

    async def request(self, method, url, **kwargs):
        if self._exc is not None:
            raise self._exc
        assert self._response is not None
        return self._response

    async def aclose(self) -> None:
        return None


class _FakeUpstreamResponse:
    def __init__(self, status_code: int, text: str, payload=None) -> None:
        self.status_code = status_code
        self.text = text
        self._payload = payload
        self.headers = {}

    def json(self):
        if self._payload is None:
            raise json.JSONDecodeError("no json", self.text, 0)
        return self._payload


def _service(monkeypatch: pytest.MonkeyPatch, client: type) -> WooCommerceService:
    service = object.__new__(WooCommerceService)
    service.wc_base_url = "https://internal.example.dk/wp-json/wc/v3"
    service.consumer_key = "ck_test"
    service.consumer_secret = "cs_test"
    service.timeout = 5.0
    service.wp_base_url = "https://internal.example.dk"
    service.wp_app_username = "u"
    service.wp_app_password = "p"
    service._shared_client = None
    service._client_depth = 0
    monkeypatch.setattr("app.services.woocommerce.httpx.AsyncClient", client)
    return service


def test_connection_error_detail_is_categorical_not_raw(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    exc = httpx.ConnectError("connection refused to internal.example.dk")
    service = _service(monkeypatch, lambda **kw: _ErrorResponseClient(exc=exc))

    with caplog.at_level(logging.WARNING, logger="app.services.woocommerce"):
        with pytest.raises(HTTPException) as info:
            asyncio.run(service._wc_response("GET", "/orders"))

    assert info.value.status_code == 502
    assert "ulaşılamadı" in str(info.value.detail)
    assert "ConnectError" in str(info.value.detail)
    # İç host ve ham hata metni sızmaz.
    assert "internal.example.dk" not in str(info.value.detail)
    assert "connection refused" not in str(info.value.detail)
    # Tam neden sunucu logunda.
    assert any("internal.example.dk" in record.message for record in caplog.records)


def test_non_json_upstream_body_is_not_copied_into_detail(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    body = "<html>WordPress database error: table wp_posts is marked as crashed at /var/www/secret</html>"
    response = _FakeUpstreamResponse(500, body)
    service = _service(monkeypatch, lambda **kw: _ErrorResponseClient(response=response))

    with caplog.at_level(logging.WARNING, logger="app.services.woocommerce"):
        with pytest.raises(HTTPException) as info:
            asyncio.run(service._wc_response("GET", "/products"))

    assert info.value.status_code == 502
    detail = str(info.value.detail)
    assert "500" in detail
    assert "database error" not in detail
    assert "/var/www/secret" not in detail
    assert any("database error" in record.message for record in caplog.records)


def test_upstream_json_message_is_preserved_in_detail(monkeypatch: pytest.MonkeyPatch) -> None:
    response = _FakeUpstreamResponse(
        400,
        json.dumps({"message": "Invalid SKU.", "code": "invalid_sku"}),
        payload={"message": "Invalid SKU.", "code": "invalid_sku"},
    )
    service = _service(monkeypatch, lambda **kw: _ErrorResponseClient(response=response))

    with pytest.raises(HTTPException) as info:
        asyncio.run(service._wc_response("GET", "/products"))

    assert "Invalid SKU." in str(info.value.detail)


def test_shared_client_reuses_single_client_across_nested_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    """M3 — iç içe `_http_client()` çağrıları TEK client paylaşır; en dış
    çıkışta kapanır (publish foto+yazma zinciri tek bağlantı havuzu)."""

    created: list[object] = []
    closed: list[bool] = []

    class _CountingClient:
        def __init__(self, **kwargs) -> None:
            created.append(self)
            self.closed = False

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def aclose(self):
            self.closed = True
            closed.append(True)

        async def request(self, *args, **kwargs):
            return _FakeUpstreamResponse(200, "{}", payload={})

    service = _service(monkeypatch, _CountingClient)

    async def scenario():
        async with service._http_client():
            inner = service._http_client()
            async with inner:
                await service._wc_response("GET", "/orders")
            assert len(created) == 1
        assert len(created) == 1
        assert closed == [True]
        # Sonraki burst yeni client açar.
        async with service._http_client():
            pass
        assert len(created) == 2
        assert closed == [True, True]

    asyncio.run(scenario())
