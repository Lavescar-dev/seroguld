from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.inventory import get_inventory_workspace
from app.api.v2_inventory import attach_library_photo_v2
from app.config import get_settings
from app.database import Base
from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum, RoleEnum
from app.models.product import Product
from app.models.user import User
from app.schemas.product import LibraryPhotoAttach
from app.utils.helpers import utc_now


def _admin() -> User:
    return User(email="depo-admin@example.com", password_hash="x", name="Admin", role=RoleEnum.ADMIN, is_active=True)


def _product(number: str, status: ProductStatusEnum) -> Product:
    return Product(
        product_number=number,
        display_name=f"Test {number}",
        product_type=ProductTypeEnum.RING,
        metal_type=MetalTypeEnum.YELLOW_GOLD,
        weight_grams=Decimal("2.00"),
        pure_gold_grams=Decimal("1.80"),
        unit_count=1,
        total_weight_grams=Decimal("2.00"),
        purchase_date=utc_now(),
        purchase_price_dkk=Decimal("500.00"),
        gdpr_release_date=utc_now(),
        is_gdpr_locked=False,
        status=status,
        inventory_category="taki",
        photos=[],
    )


async def _fresh_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    return engine, Session


@pytest.mark.asyncio
async def test_status_filter_reveals_melted_and_default_hides_it():
    engine, Session = await _fresh_session()
    async with Session() as session:
        admin = _admin()
        session.add(admin)
        session.add(_product("0001", ProductStatusEnum.IN_INVENTORY))
        session.add(_product("0002", ProductStatusEnum.MELTED))
        session.add(_product("0003", ProductStatusEnum.SOLD))
        await session.commit()

        # Default list: only active statuses (no sold/melted).
        default_ws = await get_inventory_workspace(db=session, _=admin)
        statuses = {r.status for r in default_ws.rows}
        assert "in_inventory" in statuses
        assert "melted" not in statuses and "sold" not in statuses

        # Explicit status=melted reveals the melted product.
        melted_ws = await get_inventory_workspace(status="melted", db=session, _=admin)
        assert [r.status for r in melted_ws.rows] == ["melted"]
        assert len(melted_ws.rows) == 1
    await engine.dispose()


@pytest.mark.asyncio
async def test_attach_library_photo(tmp_path, monkeypatch):
    engine, Session = await _fresh_session()
    async with Session() as session:
        admin = _admin()
        product = _product("0001", ProductStatusEnum.IN_INVENTORY)
        session.add(admin)
        session.add(product)
        await session.commit()

        # Fake pool file under the served media root.
        monkeypatch.setattr(get_settings(), "media_root_dir", str(tmp_path), raising=False)
        pool = tmp_path / "seed-library" / "depolama"
        pool.mkdir(parents=True)
        (pool / "depolama_001_g2.avif").write_bytes(b"avifdata")

        out = await attach_library_photo_v2(
            product.id, LibraryPhotoAttach(file="depolama_001_g2.avif"), db=session, admin=admin
        )
        assert len(out.photos) == 1
        assert out.photos[0].url == "/media/seed-library/depolama/depolama_001_g2.avif"
        assert out.photos[0].is_primary is True

        # Path traversal is rejected.
        with pytest.raises(Exception):
            await attach_library_photo_v2(
                product.id, LibraryPhotoAttach(file="../../secret.avif"), db=session, admin=admin
            )

        # Missing pool file -> 404.
        with pytest.raises(Exception):
            await attach_library_photo_v2(
                product.id, LibraryPhotoAttach(file="nope.avif"), db=session, admin=admin
            )
    await engine.dispose()
