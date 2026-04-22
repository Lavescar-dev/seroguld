from __future__ import annotations

from collections import namedtuple
from datetime import datetime, timezone
from decimal import Decimal

from app.api.reports import (
    _build_csv_content,
    _build_pdf_content,
    _build_xlsx_content,
    _resolve_period_bounds,
)


ExportRow = namedtuple(
    "ExportRow",
    [
        "product_number",
        "product_type",
        "metal_type",
        "status",
        "purchase_price_dkk",
        "sale_price_dkk",
        "profit_dkk",
        "purchase_date",
    ],
)


def _sample_rows() -> list[ExportRow]:
    return [
        ExportRow(
            product_number="0048",
            product_type="bracelet",
            metal_type="platinum",
            status="for_sale",
            purchase_price_dkk=Decimal("12146.09"),
            sale_price_dkk=None,
            profit_dkk=None,
            purchase_date=datetime(2026, 2, 20, 10, 30, tzinfo=timezone.utc),
        ),
        ExportRow(
            product_number="0049",
            product_type="ring",
            metal_type="yellow_gold",
            status="sold",
            purchase_price_dkk=Decimal("5000.00"),
            sale_price_dkk=Decimal("6500.00"),
            profit_dkk=Decimal("1500.00"),
            purchase_date=datetime(2026, 2, 21, 11, 45, tzinfo=timezone.utc),
        ),
    ]


def test_resolve_period_bounds_supports_all_values():
    now = datetime(2026, 2, 28, 12, 0, tzinfo=timezone.utc)

    start, end = _resolve_period_bounds("all", now)
    assert start is None and end is None

    start, end = _resolve_period_bounds("daily", now)
    assert start == datetime(2026, 2, 28, 0, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 3, 1, 0, 0, tzinfo=timezone.utc)

    start, end = _resolve_period_bounds("weekly", now)
    assert start == datetime(2026, 2, 21, 12, 0, tzinfo=timezone.utc)
    assert end == now

    start, end = _resolve_period_bounds("monthly", now)
    assert start == datetime(2026, 2, 1, 0, 0, tzinfo=timezone.utc)
    assert end == now


def test_csv_export_contains_header_and_rows():
    csv_payload = _build_csv_content(_sample_rows())
    assert "product_number,product_type,metal_type,status,purchase_price_dkk,sale_price_dkk,profit_dkk,purchase_date" in csv_payload
    assert "0048,bracelet,platinum,for_sale,12146.09" in csv_payload
    assert "0049,ring,yellow_gold,sold,5000.00,6500.00,1500.00" in csv_payload


def test_xlsx_export_returns_zip_payload():
    now = datetime(2026, 2, 28, 12, 0, tzinfo=timezone.utc)
    payload = _build_xlsx_content(_sample_rows(), period="monthly", generated_at=now)
    # XLSX is a ZIP container, so it starts with PK
    assert payload.startswith(b"PK")
    assert len(payload) > 1000


def test_pdf_export_returns_pdf_payload():
    now = datetime(2026, 2, 28, 12, 0, tzinfo=timezone.utc)
    payload = _build_pdf_content(_sample_rows(), period="monthly", generated_at=now)
    assert payload.startswith(b"%PDF")
    assert len(payload) > 1000
