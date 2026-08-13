from __future__ import annotations

import pytest

from app.api import v2
from app.schemas.desktop_views import UnicontaConfigOut
from app.services.uniconta_service import UnicontaClient, map_uniconta_invoice_to_dto


@pytest.mark.asyncio
async def test_query_puts_skip_and_take_in_uniconta_filter(monkeypatch: pytest.MonkeyPatch) -> None:
    client = UnicontaClient(company_id="55606", username="user", password="secret")
    calls: list[tuple[str, dict[str, object]]] = []

    async def fake_request(method: str, path: str, *, json_body: object | None = None, **_: object) -> list[dict[str, object]]:
        calls.append((path, json_body[0]))  # type: ignore[index]
        return []

    monkeypatch.setattr(client, "_request", fake_request)

    await client.get_sale_invoices(top=500, skip=1500)

    assert calls == [("/Query/Get/DebtorInvoiceClient", {"Skip": 1500, "Take": 500})]


@pytest.mark.asyncio
async def test_get_sale_invoices_forwards_skip(monkeypatch: pytest.MonkeyPatch) -> None:
    client = UnicontaClient(company_id="55606", username="user", password="secret")
    calls: list[tuple[int, int]] = []

    async def fake_query(entity: str, *, top: int, skip: int, **_: object) -> list[dict[str, object]]:
        calls.append((top, skip))
        return []

    monkeypatch.setattr(client, "query", fake_query)

    await client.get_sale_invoices(top=200, skip=400)

    assert calls == [(200, 400)]


def test_uniconta_config_contract_does_not_return_raw_secrets() -> None:
    assert "password" not in UnicontaConfigOut.model_fields
    assert "apiKey" not in UnicontaConfigOut.model_fields
    assert "passwordConfigured" in UnicontaConfigOut.model_fields


@pytest.mark.parametrize(
    ("total_amount", "expected_direction", "expected_type"),
    [
        (1250.0, "income", "Salgsfaktura"),
        (-1000.0, "expense", "Kreditnota"),
        (0.0, "neutral", "Salgsfaktura"),
    ],
)
def test_remote_invoice_mapping_preserves_signed_total_amount_and_date(
    total_amount: float,
    expected_direction: str,
    expected_type: str,
) -> None:
    mapped = map_uniconta_invoice_to_dto(
        {
            "PrimaryKeyId": 41,
            "InvoiceNumber": 8803,
            "Date": "2026-08-13T00:00:00Z",
            "Account": "CRM-1",
            "Name": "Test",
            "NetAmount": 1000.0,
            "VatAmount": 250.0,
            "TotalAmount": total_amount,
            "Currency": "DKK",
        }
    )

    assert mapped["fakturadato"] == "2026-08-13"
    assert mapped["total"] == total_amount
    assert mapped["signedTotalAmount"] == total_amount
    assert mapped["amountDirection"] == expected_direction
    assert mapped["type"] == expected_type


@pytest.mark.asyncio
async def test_invoice_endpoint_forwards_skip_to_remote_client(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[int, int]] = []

    class FakeClient:
        async def get_sale_invoices(self, *, top: int, skip: int) -> list[dict[str, object]]:
            calls.append((top, skip))
            return []

    monkeypatch.setattr(v2, "get_uniconta_client", lambda: FakeClient())

    response = await v2.get_uniconta_invoices_v2(limit=500, skip=1000, source="remote", db=None, _=None)  # type: ignore[arg-type]

    assert calls == [(500, 1000)]
    assert response.skip == 1000
    assert response.hasMore is False
