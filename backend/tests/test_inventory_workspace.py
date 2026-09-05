"""A4 depolama workspace düzeltmeleri.

Kapsam: NULL kategorili üründe NameError yok (fix 1), summary/total_rows
limit'ten bağımsız (fix 2), LIKE joker escape, datetime tarih sınırları ve
satırda updated_at (fix 4'ün frontend'i için optimistic concurrency taşıyıcısı).
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.inventory import get_inventory_workspace
from app.database import Base
from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum, RoleEnum
from app.models.product import Product
from app.models.user import User
from app.utils.helpers import utc_now


def _admin() -> User:
    return User(email="ws-admin@example.com", password_hash="x", name="Admin", role=RoleEnum.ADMIN, is_active=True)


def _product(
    number: str,
    *,
    inventory_category: str | None = "taki",
    notes: str | None = None,
    purchase_date: datetime | None = None,
    status: ProductStatusEnum = ProductStatusEnum.IN_INVENTORY,
) -> Product:
    return Product(
        product_number=number,
        display_name=f"Test {number}",
        product_type=ProductTypeEnum.RING,
        metal_type=MetalTypeEnum.YELLOW_GOLD,
        weight_grams=Decimal("2.00"),
        pure_gold_grams=Decimal("1.80"),
        unit_count=1,
        total_weight_grams=Decimal("2.00"),
        purchase_date=purchase_date or utc_now(),
        purchase_price_dkk=Decimal("500.00"),
        gdpr_release_date=utc_now(),
        is_gdpr_locked=False,
        status=status,
        inventory_category=inventory_category,
        notes=notes,
        photos=[],
    )


async def _fresh_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    return engine, Session


@pytest.mark.asyncio
async def test_null_category_product_does_not_break_workspace():
    """inventory_category=None satırı tüm workspace'i 500 etmemeli (NameError).

    Regresyon: infer_inventory_categories import edilmemişti; NULL kategorili
    tek ürün TÜM liste + workbook üretimini düşürüyordu.
    """
    engine, Session = await _fresh_session()
    async with Session() as session:
        session.add(_admin())
        session.add(_product("0001", inventory_category=None))
        session.add(_product("0002", inventory_category="gumus"))
        await session.commit()

        ws = await get_inventory_workspace(db=session, _=None)
        assert ws.total_rows == 2
        null_row = next(r for r in ws.rows if r.product_number == "0001")
        # RING + YELLOW_GOLD → türetilen kategori 'taki' (görüntüleme düzeyinde)
        assert null_row.main_category == "taki"
    await engine.dispose()


@pytest.mark.asyncio
async def test_summary_and_total_rows_cover_full_dataset_beyond_limit():
    """limit sayfa boyutunu sınırlar ama summary/total_rows tüm veriyi sayar."""
    engine, Session = await _fresh_session()
    async with Session() as session:
        session.add(_admin())
        for i in range(3):
            session.add(_product(f"00{i + 1}"))
        await session.commit()

        ws = await get_inventory_workspace(limit=1, db=session, _=None)
        assert len(ws.rows) == 1
        assert ws.total_rows == 3
        assert ws.summary.total_items == 3

        full = await get_inventory_workspace(db=session, _=None)
        assert len(full.rows) == 3
        assert full.total_rows == 3
        assert full.summary.total_items == 3
        # Sayfalanmış summary tam kümeyle aynı
        assert ws.summary.total_spot_value_dkk == full.summary.total_spot_value_dkk
    await engine.dispose()


@pytest.mark.asyncio
async def test_query_escapes_like_jokers():
    """'%', '_' arama girdisi joker değil literal davranmalı."""
    engine, Session = await _fresh_session()
    async with Session() as session:
        session.add(_admin())
        session.add(_product("0001", notes="indirim %100 kampanya"))
        session.add(_product("0002", notes="indirim 100X kampanya"))
        session.add(_product("0003", notes="abc kodlu"))
        await session.commit()

        ws = await get_inventory_workspace(q="%100", db=session, _=None)
        # Joker escape'siz '%%100%' deseni her '100' içeren satırı yakalardı
        assert [r.product_number for r in ws.rows] == ["0001"]

        ws_under = await get_inventory_workspace(q="a_c", db=session, _=None)
        # 'a_c' literal: 'abc' eşleşmez, 'a_c' içeren yok
        assert ws_under.rows == []
    await engine.dispose()


@pytest.mark.asyncio
async def test_date_filters_compare_as_datetime():
    engine, Session = await _fresh_session()
    async with Session() as session:
        session.add(_admin())
        session.add(_product("0001", purchase_date=datetime(2026, 1, 15, 10, 0, tzinfo=timezone.utc)))
        session.add(_product("0002", purchase_date=datetime(2026, 3, 2, 10, 0, tzinfo=timezone.utc)))
        await session.commit()

        ws_jan = await get_inventory_workspace(date_from="2026-01-01", date_to="2026-01-31", db=session, _=None)
        assert [r.product_number for r in ws_jan.rows] == ["0001"]

        ws_from_feb = await get_inventory_workspace(date_from="2026-02-01", db=session, _=None)
        assert [r.product_number for r in ws_from_feb.rows] == ["0002"]

        ws_to_jan = await get_inventory_workspace(date_to="2026-01-31", db=session, _=None)
        assert [r.product_number for r in ws_to_jan.rows] == ["0001"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_rows_carry_updated_at_for_concurrency():
    """Satır updated_at taşımalı — düzenleme yolu expected_updated_at göndersin."""
    engine, Session = await _fresh_session()
    async with Session() as session:
        admin = _admin()
        product = _product("0001")
        session.add(admin)
        session.add(product)
        await session.commit()
        await session.refresh(product)
        assert product.updated_at is not None

        ws = await get_inventory_workspace(db=session, _=None)
        row = ws.rows[0]
        assert row.updated_at is not None
        assert datetime.fromisoformat(row.updated_at) == product.updated_at
    await engine.dispose()
