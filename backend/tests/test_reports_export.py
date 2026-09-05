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

    # 2026-02-28 Cumartesi; Kopenhag kış saati UTC+1 → yerel gece yarısı 23:00Z
    start, end = _resolve_period_bounds("daily", now)
    assert start == datetime(2026, 2, 27, 23, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 2, 28, 23, 0, tzinfo=timezone.utc)

    # weekly artık ISO takvim haftası: Pazartesi 00:00 Kopenhag → şimdi
    start, end = _resolve_period_bounds("weekly", now)
    assert start == datetime(2026, 2, 22, 23, 0, tzinfo=timezone.utc)
    assert end == now

    start, end = _resolve_period_bounds("monthly", now)
    assert start == datetime(2026, 1, 31, 23, 0, tzinfo=timezone.utc)
    assert end == now


def test_resolve_period_bounds_daily_follows_dst():
    # Yaz saatinde (CEST, UTC+2) yerel gün UTC gece yarısından 22:00Z'de başlar;
    # eski UTC-midnight davranışı 02:00'e kayıyordu.
    now = datetime(2026, 7, 15, 12, 0, tzinfo=timezone.utc)

    start, end = _resolve_period_bounds("daily", now)
    assert start == datetime(2026, 7, 14, 22, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 7, 15, 22, 0, tzinfo=timezone.utc)


def test_csv_export_contains_header_and_rows():
    csv_payload = _build_csv_content(_sample_rows())
    assert "product_number,product_type,metal_type,status,purchase_price_dkk,sale_price_dkk,profit_dkk,purchase_date" in csv_payload
    assert "0048,Armbånd,Platin,for_sale,12146.09" in csv_payload
    assert "0049,Ring,Guld,sold,5000.00,6500.00,1500.00" in csv_payload


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


def test_xlsx_summary_uses_passed_summary_and_basis_note():
    import io as _io

    from openpyxl import load_workbook

    from app.schemas.report import ReportSummaryOut

    now = datetime(2026, 2, 28, 12, 0, tzinfo=timezone.utc)
    # Satır kohortunun kârı 1500; satış-bazlı özet 2500 — dosya özeti geçen
    # summary'yi (satış tarihi bazlı) kullanmalı.
    summary = ReportSummaryOut(
        period_start=datetime(2026, 2, 1, tzinfo=timezone.utc),
        period_end=now,
        purchased_count=2,
        sold_count=1,
        melted_count=0,
        total_purchase_value_dkk="17146.09",
        total_sale_value_dkk="6500.00",
        total_profit_dkk="2500.00",
    )
    payload = _build_xlsx_content(_sample_rows(), period="monthly", generated_at=now, summary=summary)
    sheet = load_workbook(_io.BytesIO(payload)).active
    assert "satış tarihi" in str(sheet["A4"].value)
    assert sheet["H6"].value == "2500.00"


def test_summary_excludes_soft_deleted_and_unsold_sale_amounts():
    import asyncio

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from app.api.reports import _summary_for_range
    from app.database import Base
    from app.models.enums import ProductStatusEnum
    from app.models.product import Product

    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            start = datetime(2026, 2, 1, tzinfo=timezone.utc)
            end = datetime(2026, 3, 1, tzinfo=timezone.utc)

            def product(number: str, **kwargs) -> Product:
                return Product(
                    product_number=number,
                    product_type="bracelet",
                    metal_type="silver",
                    weight_grams=Decimal("10"),
                    purchase_date=start,
                    gdpr_release_date=start,
                    **kwargs,
                )

            session.add_all(
                [
                    # Normal alım — sayılır
                    product("0100", status=ProductStatusEnum.FOR_SALE, purchase_price_dkk=100),
                    # Soft-deleted alım — summary ve export popülasyonu dışı
                    product(
                        "0101",
                        status=ProductStatusEnum.FOR_SALE,
                        purchase_price_dkk=999,
                        deleted_at=datetime(2026, 2, 2, tzinfo=timezone.utc),
                    ),
                    # Satılmış — satış + kâr sayılır
                    product(
                        "0102",
                        status=ProductStatusEnum.SOLD,
                        purchase_price_dkk=200,
                        sale_date=datetime(2026, 2, 10, tzinfo=timezone.utc),
                        sale_price_dkk=500,
                        profit_dkk=300,
                    ),
                    # sale_date dolu ama status FOR_SALE — eski status'suz
                    # toplam bunu da sayıyordu; artık sayılmaz
                    product(
                        "0103",
                        status=ProductStatusEnum.FOR_SALE,
                        purchase_price_dkk=300,
                        sale_date=datetime(2026, 2, 11, tzinfo=timezone.utc),
                        sale_price_dkk=700,
                        profit_dkk=400,
                    ),
                ]
            )
            await session.commit()

            summary = await _summary_for_range(session, start, end)

            assert summary.purchased_count == 3  # soft-deleted hariç
            assert Decimal(summary.total_purchase_value_dkk) == Decimal("600")  # 100+200+300
            assert summary.sold_count == 1
            assert Decimal(summary.total_sale_value_dkk) == Decimal("500")  # yalnız SOLD
            assert Decimal(summary.total_profit_dkk) == Decimal("300")

            # period=all: satış bazlı alanlar tüm zamanlara bakar
            all_time = await _summary_for_range(session, None, None)
            assert all_time.purchased_count == 3
            assert all_time.sold_count == 1
            assert Decimal(all_time.total_profit_dkk) == Decimal("300")

        await engine.dispose()

    asyncio.run(run())
