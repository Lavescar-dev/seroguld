from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api import v2_inventory
from app.database import Base
from app.models.enums import MetalTypeEnum, ProductTypeEnum, RoleEnum
from app.models.product import Product
from app.models.user import User
from app.schemas.inventory import (
    InventoryMarketPricesOut,
    InventoryWorkspaceOut,
    InventoryWorkspaceSummaryOut,
)
from app.schemas.product import ProductCreate
from app.services import document_artifact_service


def _empty_workspace() -> InventoryWorkspaceOut:
    return InventoryWorkspaceOut(
        market_prices=InventoryMarketPricesOut(
            gold=Decimal("1"),
            silver=Decimal("1"),
            platinum=Decimal("1"),
            palladium=Decimal("1"),
        ),
        summary=InventoryWorkspaceSummaryOut(),
        rows=[],
    )


@pytest.mark.asyncio
async def test_inventory_snapshot_uses_datetime_for_document_artifact(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, object]] = []

    async def fake_get_record(_session, _artifact_key):
        return None

    async def fake_store(_session, **kwargs):
        calls.append(kwargs)
        return document_artifact_service.WorkbookArtifactBundle(
            artifact=SimpleNamespace(),
            content=kwargs["content"],
        )

    monkeypatch.setattr(document_artifact_service, "get_artifact_record", fake_get_record)
    monkeypatch.setattr(document_artifact_service, "_store_artifact", fake_store)
    monkeypatch.setattr(document_artifact_service, "_build_inventory_workbook_bytes", lambda *_args, **_kwargs: b"xlsx")

    await document_artifact_service.sync_inventory_workbook_artifact(
        SimpleNamespace(),
        _empty_workspace(),
        create_snapshot=True,
    )

    assert len(calls) == 2
    snapshot = next(call for call in calls if call["version_kind"] == "snapshot")
    assert isinstance(snapshot["updated_at"], datetime)
    assert snapshot["updated_at"].tzinfo is not None
    assert isinstance(snapshot["artifact_key"], str)
    assert ".snapshot." in snapshot["artifact_key"]


@pytest.mark.asyncio
async def test_failed_inventory_projection_rolls_back_new_product(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with Session() as db:
        admin = User(
            email="inventory-admin@example.com",
            password_hash="not-used-in-this-test",
            name="Inventory Admin",
            role=RoleEnum.ADMIN,
            is_active=True,
        )
        db.add(admin)
        await db.commit()

        async def fail_projection(*_args, **_kwargs):
            raise RuntimeError("projection failed")

        monkeypatch.setattr(v2_inventory, "ensure_inventory_artifact", fail_projection)
        payload = ProductCreate(
            display_name="Atomic test bracelet",
            reference_number="ATOMIC",
            product_type=ProductTypeEnum.JEWELRY,
            metal_type=MetalTypeEnum.YELLOW_GOLD,
            weight_grams=Decimal("19.65"),
            purity_percentage=Decimal("91.6"),
            purchase_date=datetime(2025, 12, 31, tzinfo=timezone.utc),
            purchase_price_dkk=Decimal("13755"),
            inventory_category="taki",
        )

        with pytest.raises(RuntimeError, match="projection failed"):
            await v2_inventory.post_depolama_product_v2(payload=payload, db=db, admin=admin)

    async with Session() as verification:
        product_count = await verification.scalar(select(func.count(Product.id)))
        assert product_count == 0

    await engine.dispose()
