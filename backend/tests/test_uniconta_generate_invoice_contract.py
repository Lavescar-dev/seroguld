from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.config import Settings
from app.services import uniconta_service as uniconta_module
from app.services.uniconta_service import UnicontaClient, UnicontaError


class _FakeResponse:
    def __init__(self, status_code: int, *, text: str = "", payload: dict[str, Any] | None = None) -> None:
        self.status_code = status_code
        self.text = text if text else ("" if payload is None else str(payload))
        self._payload = payload

    def json(self) -> dict[str, Any]:
        if self._payload is None:
            raise ValueError("No JSON")
        return self._payload


class _FakeAsyncClient:
    calls: list[dict[str, Any]] = []
    next_response: _FakeResponse = _FakeResponse(200, payload={"Err": 0})

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def post(self, url: str, **kwargs: Any) -> _FakeResponse:
        type(self).calls.append({"url": url, **kwargs})
        return type(self).next_response


def _service(monkeypatch: pytest.MonkeyPatch, **flag_overrides: Any) -> UnicontaService:
    monkeypatch.setattr(
        uniconta_module,
        "get_settings",
        lambda: Settings(
            _env_file=None,
            database_url="sqlite+aiosqlite:///test.db",
            uniconta_api_url="https://api.uniconta.test",
            uniconta_username="user",
            uniconta_password="pass",
            uniconta_company_id="1",
            **flag_overrides,
        ),
    )
    monkeypatch.setattr(uniconta_module.httpx, "AsyncClient", _FakeAsyncClient)
    _FakeAsyncClient.calls = []
    _FakeAsyncClient.next_response = _FakeResponse(200, payload={"Err": 0})
    service = UnicontaClient()

    async def fake_token(client: Any) -> str:
        return "token"

    monkeypatch.setattr(service, "ensure_token", fake_token)
    return service


def _generate(service: UnicontaClient) -> dict[str, Any]:
    return asyncio.run(
        service.generate_debtor_invoice(
            order={"Account": "123", "Name": "Test Kunde"},
            lines=[{"Item": None, "Text": "Guld · 22g", "Qty": 1.0, "Price": 100.0}],
            order_number=42,
        )
    )


def test_2xx_plain_text_error_surfaces_as_application_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Uniconta uygulama hatalarını 2xx + düz metinle dönebiliyor; bu artık
    'JSON parse hatası' değil, gerçek neden olarak raporlanır."""
    service = _service(monkeypatch)
    _FakeAsyncClient.next_response = _FakeResponse(200, text="ArgumentMissing")
    with pytest.raises(UnicontaError) as exc:
        _generate(service)
    message = str(exc.value)
    assert "uygulama hatası" in message and "ArgumentMissing" in message
    assert "JSON parse" not in message


def test_default_body_shape_is_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _service(monkeypatch)
    _generate(service)
    call = _FakeAsyncClient.calls[-1]
    body = call["json"]
    assert body["OrderNumber"] == 42
    assert "OrderNumber" not in body["Order"]
    assert body["Lines"][0]["Item"] is None
    assert call["headers"]["Accept"] == "application/pdf"


def test_flags_change_body_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _service(
        monkeypatch,
        uniconta_ordernumber_in_order=True,
        uniconta_omit_null_item=True,
        uniconta_accept_json=True,
    )
    _generate(service)
    call = _FakeAsyncClient.calls[-1]
    body = call["json"]
    # OrderNumber Order'ın içine taşınır, kök seviyede olmaz.
    assert body["Order"]["OrderNumber"] == 42
    assert "OrderNumber" not in body
    # None Item anahtarı satırlardan atılır.
    assert "Item" not in body["Lines"][0]
    assert body["Lines"][0]["Text"] == "Guld · 22g"
    assert call["headers"]["Accept"] == "application/json"
