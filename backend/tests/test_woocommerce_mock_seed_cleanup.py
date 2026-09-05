"""A10 — Woo canlı import mock-seed temizliği güvenlik sözleşmesi.

Eski akış üç kez tehlikeliydi: 'R-%' jokeri gerçek ürünleri yakalayabiliyor,
hard delete ProductHistory dahil izleri fiziksel siliyordu ve silme Woo
fetch'inden ÖNCE commit ediliyordu. Bu testler yeni sözleşmeyi sabitler:
- preview ucu yalnız güvenli kriterlerin (notes mock/smoke, MNSM%) ID'sini
  verir; R- önekli GERÇEK ürün asla listede değildir,
- silme yalnız AÇIK ID listesiyle ve soft delete ile yapılır,
- Woo fetch'i patlarsa hiçbir ürün silinmez.
"""

from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal
from typing import Any

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.api.v2  # noqa: F401  # v2 <-> v2_woocommerce döngüsel import'u üretim sırasıyla çözülür
from app.api import products as products_api
from app.api.products import (
    _parse_uuid_id_list,
    get_mock_seed_preview,
    import_woocommerce_live_products,
)
from app.database import Base
from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum, RoleEnum
from app.models.product import Product
from app.models.product_history import ProductHistory
from app.models.user import User
from app.schemas.product import ProductWooImportRequest
from app.services.woocommerce_import_helpers import (
    delete_mock_seed_products,
    find_mock_seed_products,
)
from app.utils.helpers import utc_now


def _admin() -> User:
    return User(email="woo-admin@example.com", password_hash="x", name="Admin", role=RoleEnum.ADMIN, is_active=True)


def _product(number: str, *, reference: str | None = None, notes: str | None = None) -> Product:
    return Product(
        product_number=number,
        reference_number=reference,
        display_name=f"Test {number}",
        product_type=ProductTypeEnum.RING,
        metal_type=MetalTypeEnum.YELLOW_GOLD,
        weight_grams=Decimal("2.00"),
        pure_gold_grams=Decimal("1.80"),
        purchase_date=utc_now(),
        purchase_price_dkk=Decimal("500.00"),
        gdpr_release_date=utc_now(),
        is_gdpr_locked=False,
        status=ProductStatusEnum.IN_INVENTORY,
        notes=notes,
        photos=[],
    )


async def _fresh_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    return engine, Session


async def _seed_products(session: AsyncSession) -> dict[str, Product]:
    """Bir mock, bir smoke, bir MNSM, bir R- ÖNEKLİ GERÇEK ürün ve bir Woo bağlı mock ürünü."""
    admin = _admin()
    session.add(admin)
    rows = {
        "mock": _product("0001", notes="mock seed ürünü"),
        "smoke": _product("0002", notes="smoke test kaydı"),
        "mnsm": _product("0003", reference="MNSM-0042"),
        # Gerçek üretim ürünü — eski 'R-%' jokeri bunu da siliyordu.
        "real_r": _product("0004", reference="R-2026-117"),
        "woo_linked": _product("0005", notes="mock ama Woo'ya bağlı"),
    }
    rows["woo_linked"].woocommerce_product_id = 4242
    for row in rows.values():
        session.add(row)
    await session.commit()
    return rows


def test_preview_returns_only_safe_candidates():
    async def run():
        engine, Session = await _fresh_session()
        async with Session() as session:
            rows = await _seed_products(session)
            payload = await get_mock_seed_preview(db=session, _=None)
            ids = set(payload["product_ids"])
            assert payload["count"] == 3
            assert str(rows["mock"].id) in ids
            assert str(rows["smoke"].id) in ids
            assert str(rows["mnsm"].id) in ids
            # Kritik: R- önekli gerçek ürün ve Woo bağlı mock asla aday değil.
            assert str(rows["real_r"].id) not in ids
            assert str(rows["woo_linked"].id) not in ids
            assert all(item["woocommerce_product_id"] is None for item in payload["items"])
        await engine.dispose()

    asyncio.run(run())


def test_preview_and_find_agree_and_delete_nothing():
    async def run():
        engine, Session = await _fresh_session()
        async with Session() as session:
            await _seed_products(session)
            candidates = await find_mock_seed_products(session)
            assert len(candidates) == 3
            # Önizleme saf okuma: hiçbir kayıt soft delete işareti almaz.
            alive = list((await session.scalars(select(Product))).all())
            assert all(row.deleted_at is None for row in alive)
        await engine.dispose()

    asyncio.run(run())


def test_delete_with_explicit_ids_soft_deletes_and_keeps_history():
    async def run():
        engine, Session = await _fresh_session()
        async with Session() as session:
            rows = await _seed_products(session)
            admin = await session.scalar(select(User))

            requested = [rows["mock"].id, rows["real_r"].id]  # real_r kriter dışı
            deleted = await delete_mock_seed_products(session, product_ids=requested, performed_by=admin.id)

            # Yalnız kriterlere uyan AÇIK ID soft delete edildi.
            assert len(deleted) == 1
            assert deleted[0]["id"] == str(rows["mock"].id)

            # Temiz bir oturumdan doğrula: satır hâlâ var (hard delete yok)
            # ve deleted_at işaretli.
            async with Session() as verify:
                mock_row = await verify.get(Product, rows["mock"].id)
                real_row = await verify.get(Product, rows["real_r"].id)
                assert mock_row is not None
                assert mock_row.deleted_at is not None
                assert real_row is not None and real_row.deleted_at is None

                # ProductHistory FİZİKSEL SİLİNMEDİ; üstelik gerekçeli kayıt düştü.
                histories = list(
                    (
                        await verify.scalars(
                            select(ProductHistory).where(ProductHistory.product_id == rows["mock"].id)
                        )
                    ).all()
                )
                actions = {row.action for row in histories}
                assert "mock_seed_cleanup" in actions
                assert "deleted" in actions

            # Woo bağlı ürün açık istense bile korunur.
            deleted_linked = await delete_mock_seed_products(
                session, product_ids=[rows["woo_linked"].id], performed_by=admin.id
            )
            assert deleted_linked == []
        await engine.dispose()

    asyncio.run(run())


def test_delete_without_ids_is_noop():
    async def run():
        engine, Session = await _fresh_session()
        async with Session() as session:
            await _seed_products(session)
            assert await delete_mock_seed_products(session, product_ids=[]) == []
            alive = list((await session.scalars(select(Product))).all())
            assert len(alive) == 5
            assert all(row.deleted_at is None for row in alive if isinstance(row, Product))
        await engine.dispose()

    asyncio.run(run())


def test_parse_uuid_id_list_rejects_garbage():
    assert _parse_uuid_id_list(None) == []
    assert _parse_uuid_id_list("") == []
    good = str(uuid.uuid4())
    assert _parse_uuid_id_list(f" {good},, ") == [uuid.UUID(good)]
    with pytest.raises(HTTPException) as exc:
        _parse_uuid_id_list("not-a-uuid")
    assert exc.value.status_code == 422


class _ExplodingWooService:
    """Ağ hatasını temsil eder — fetch patlaması silme akışını tetiklememeli."""

    calls = 0

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    async def fetch_recent_published_products(self, limit: int) -> list[dict[str, Any]]:
        type(self).calls += 1
        raise HTTPException(status_code=502, detail="Woo erişilemiyor")


@pytest.mark.asyncio
async def test_import_failure_deletes_nothing(monkeypatch: pytest.MonkeyPatch):
    engine, Session = await _fresh_session()
    async with Session() as session:
        rows = await _seed_products(session)
        admin = await session.scalar(select(User))
        monkeypatch.setattr(products_api, "WooCommerceService", _ExplodingWooService)
        _ExplodingWooService.calls = 0

        with pytest.raises(HTTPException) as exc:
            await import_woocommerce_live_products(
                ProductWooImportRequest(limit=10, replace_mock_seed=True),
                mock_seed_product_ids=f"{rows['mock'].id},{rows['smoke'].id}",
                db=session,
                admin=admin,
            )
        assert exc.value.status_code == 502
        assert _ExplodingWooService.calls == 1

        # Kritik: fetch patladı — onaylı ID'ler dahi silinmedi.
        async with Session() as verify:
            for key in ("mock", "smoke", "mnsm", "real_r"):
                row = await verify.get(Product, rows[key].id)
                assert row is not None and row.deleted_at is None
    await engine.dispose()


class _EmptyWooService:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    async def fetch_recent_published_products(self, limit: int) -> list[dict[str, Any]]:
        return []


@pytest.mark.asyncio
async def test_import_deletes_only_confirmed_ids_after_fetch(monkeypatch: pytest.MonkeyPatch):
    engine, Session = await _fresh_session()
    async with Session() as session:
        rows = await _seed_products(session)
        admin = await session.scalar(select(User))
        monkeypatch.setattr(products_api, "WooCommerceService", _EmptyWooService)

        response = await import_woocommerce_live_products(
            ProductWooImportRequest(limit=10, replace_mock_seed=True),
            mock_seed_product_ids=f"{rows['mock'].id},{rows['smoke'].id},{rows['real_r'].id},{rows['woo_linked'].id}",
            db=session,
            admin=admin,
        )
        assert response.deleted_mock_seed == 2
        # Kriter dışı istekler için saydam hata satırı.
        assert any("atlandı" in message for message in response.errors)

        async with Session() as verify:
            for key in ("mock", "smoke"):
                row = await verify.get(Product, rows[key].id)
                assert row is not None and row.deleted_at is not None
            for key in ("real_r", "woo_linked", "mnsm"):
                row = await verify.get(Product, rows[key].id)
                assert row is not None and row.deleted_at is None
    await engine.dispose()


@pytest.mark.asyncio
async def test_import_replace_without_ids_deletes_nothing(monkeypatch: pytest.MonkeyPatch):
    engine, Session = await _fresh_session()
    async with Session() as session:
        rows = await _seed_products(session)
        admin = await session.scalar(select(User))
        monkeypatch.setattr(products_api, "WooCommerceService", _EmptyWooService)

        response = await import_woocommerce_live_products(
            ProductWooImportRequest(limit=10, replace_mock_seed=True),
            mock_seed_product_ids=None,
            db=session,
            admin=admin,
        )
        assert response.deleted_mock_seed == 0
        assert any("mock_seed_product_ids" in message for message in response.errors)

        async with Session() as verify:
            for key in ("mock", "smoke", "mnsm"):
                row = await verify.get(Product, rows[key].id)
                assert row is not None and row.deleted_at is None
    await engine.dispose()
