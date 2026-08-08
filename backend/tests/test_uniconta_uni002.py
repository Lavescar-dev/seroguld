from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.services import uniconta_service as service


class _FakeUnicontaClient:
    has_credentials = True

    def __init__(self, invoice_rows: list[dict[str, object]] | None = None) -> None:
        self.invoice_rows = list(invoice_rows or [])
        self.events: list[tuple[object, ...]] = []
        self.generated: list[dict[str, object]] = []

    async def query(
        self,
        entity: str,
        *,
        filters: list[dict[str, object]] | None = None,
        top: int = 100,
        skip: int = 0,
        order_by_desc: bool = False,
    ) -> list[dict[str, object]]:
        self.events.append(("query", entity, filters, top))
        if entity == "DebtorInvoiceClient":
            return list(self.invoice_rows)
        return []

    async def generate_debtor_invoice(self, **kwargs: object) -> dict[str, object]:
        self.events.append(("generate", kwargs.get("order_number")))
        self.generated.append(kwargs)
        invoice = {
            "InvoiceNumber": 9101,
            "OrderNumber": kwargs["order_number"],
            "Account": kwargs["order"]["Account"],  # type: ignore[index]
            "Date": "2026-08-08",
        }
        self.invoice_rows = [invoice]
        return invoice


def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        uniconta_send_email_on_finalize=False,
        uniconta_send_xml_on_finalize=False,
    )


def _pos_document(sequence_no: int) -> SimpleNamespace:
    return SimpleNamespace(
        sequence_no=sequence_no,
        uniconta_sync_status="failed",
        uniconta_invoice_number=None,
        uniconta_account=None,
        uniconta_invoice_date=None,
        uniconta_pdf_path=None,
        uniconta_synced_at=None,
        uniconta_sync_error="previous attempt failed",
        customer_name="Ada Example",
        customer_phone=None,
        customer_email=None,
        customer_address=None,
        notes="AFG Satin Alma",
        gross_amount_dkk=Decimal("125.00"),
    )


def _pos_session() -> SimpleNamespace:
    return SimpleNamespace(
        customer=SimpleNamespace(
            id="42",
            name="Ada Example",
            phone=None,
            email=None,
            postal_code=None,
            city=None,
        ),
        customer_id="42",
        notes=None,
        trade_side=None,
    )


async def _ensure_debtor(*args: object, **kwargs: object) -> str:
    return "CRM-42"


@pytest.mark.asyncio
async def test_sync_links_existing_remote_invoice_before_create(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakeUnicontaClient(
        [
            {
                "OrderNumber": 303,
                "Account": "CRM-42",
                "InvoiceNumber": 8803,
                "Date": "2026-08-08",
            }
        ]
    )
    monkeypatch.setattr(service, "get_uniconta_client", lambda: client)
    monkeypatch.setattr(service, "get_settings", _settings)
    monkeypatch.setattr(service, "ensure_debtor_for_customer", _ensure_debtor)

    document = _pos_document(303)
    result = await service.sync_pos_document_to_uniconta(
        None,
        document,
        pos_session=_pos_session(),
        pos_lines=[],
    )

    assert result["ok"] is True
    assert result["idempotent"] is True
    assert result["invoice_number"] == "8803"
    assert document.uniconta_sync_status == "synced"
    assert document.uniconta_invoice_number == "8803"
    assert client.generated == []
    assert client.events[0] == (
        "query",
        "DebtorInvoiceClient",
        [
            {"PropertyName": "OrderNumber", "FilterValue": "303"},
            {"PropertyName": "Account", "FilterValue": "CRM-42"},
        ],
        1,
    )


@pytest.mark.asyncio
async def test_retry_after_remote_create_local_state_loss_is_idempotent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeUnicontaClient()
    monkeypatch.setattr(service, "get_uniconta_client", lambda: client)
    monkeypatch.setattr(service, "get_settings", _settings)
    monkeypatch.setattr(service, "ensure_debtor_for_customer", _ensure_debtor)

    document = _pos_document(404)
    session = _pos_session()
    first = await service.sync_pos_document_to_uniconta(
        None,
        document,
        pos_session=session,
        pos_lines=[],
    )

    assert first["ok"] is True
    assert client.generated[0]["order_number"] == 404

    # Simulate a process crash after remote success but before local commit.
    document.uniconta_sync_status = "failed"
    document.uniconta_invoice_number = None
    document.uniconta_account = None
    document.uniconta_invoice_date = None
    document.uniconta_synced_at = None

    retry = await service.sync_pos_document_to_uniconta(
        None,
        document,
        pos_session=session,
        pos_lines=[],
    )

    assert retry["ok"] is True
    assert retry["idempotent"] is True
    assert retry["invoice_number"] == "9101"
    assert document.uniconta_sync_status == "synced"
    assert document.uniconta_invoice_number == "9101"
    assert len(client.generated) == 1
    assert [event[0] for event in client.events] == [
        "query",
        "generate",
        "query",
    ]
