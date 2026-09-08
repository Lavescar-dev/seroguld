from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api import products as products_api
from app.api.products import ai_describe
from app.database import Base
from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum, RoleEnum
from app.models.product import Product
from app.models.product_history import ProductHistory
from app.models.user import User
from app.services.ai_service import AIUsageSummary
from app.services.product_service import to_product_out
from app.utils.helpers import utc_now


def _admin() -> User:
    return User(email="ai-admin@example.com", password_hash="x", name="Admin", role=RoleEnum.ADMIN, is_active=True)


def _product(number: str, photo_count: int) -> Product:
    # Foto alanları CRM'in gerçek foto sözleşmesini taklit eder: okunabilir bir
    # yol/data URL varsa AI fotoyu analiz eder, hiçbiri okunamazsa 0 döner.
    photos = [
        {
            "id": f"photo-{index}",
            "url": f"/media/foto-{index}.jpg",
            "filename": f"foto-{index}.jpg",
            "original_path": f"/media/foto-{index}.avif",
        }
        for index in range(photo_count)
    ]
    now = utc_now()
    return Product(
        product_number=number,
        reference_number=f"S{number}",
        # Sentetik isim — gerçek müşteri/ürün verisi değil.
        display_name=f"Testove TESTSEN halskæde {number}",
        product_type=ProductTypeEnum.NECKLACE,
        metal_type=MetalTypeEnum.YELLOW_GOLD,
        purity_karat="14K",
        purity_percentage=Decimal("58.50"),
        weight_grams=Decimal("2.39"),
        pure_gold_grams=Decimal("1.40"),
        unit_count=1,
        total_weight_grams=Decimal("2.39"),
        length_cm="45,00cm",
        purchase_date=now,
        purchase_price_dkk=Decimal("900.00"),
        gdpr_release_date=now,
        is_gdpr_locked=False,
        status=ProductStatusEnum.IN_INVENTORY,
        inventory_category="taki",
        photos=photos,
    )


def _usage() -> AIUsageSummary:
    return AIUsageSummary(
        provider="test",
        model="test-model",
        pricing_key=None,
        prompt_tokens=10,
        completion_tokens=5,
        total_tokens=15,
        input_cost_usd=Decimal("0.0001"),
        output_cost_usd=Decimal("0.0002"),
        total_cost_usd=Decimal("0.0003"),
        raw_usage={},
    )


def _fake_ai_service(images_analyzed: int):
    class _FakeAIService:
        async def generate_description_with_usage(self, *, product: Product):
            return "SEO_TITLE: Testove TESTSEN halskæde\nURL_SLUG: testove-testsen", _usage(), images_analyzed

    return _FakeAIService


async def _fresh():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.mark.asyncio
@pytest.mark.parametrize("photo_count,images_analyzed", [(2, 2), (2, 0), (0, 0)])
async def test_ai_describe_response_carries_images_analyzed(
    photo_count: int, images_analyzed: int, monkeypatch: pytest.MonkeyPatch
):
    """ai-describe yanıtı AIUsageLog'a yazılan foto sayacını da taşır (UI uyarısı için)."""
    monkeypatch.setattr(products_api, "AIService", _fake_ai_service(images_analyzed))

    engine, Session = await _fresh()
    async with Session() as db:
        admin = _admin()
        db.add(admin)
        product = _product("0001", photo_count)
        db.add(product)
        await db.commit()

        result = await ai_describe(product_id=product.id, db=db, admin=admin)

        assert result.images_analyzed == images_analyzed
        # UI uyarısı "ürünün fotoğrafı var AMA sayaç 0" koşuluyla çalışır;
        # yanıttaki foto listesi gerçek sayıyı taşımak zorunda.
        assert len(result.photos) == photo_count
        assert result.ai_description.startswith("SEO_TITLE:")
        assert result.ai_description_approved is False

        # Geçmiş notu sayacı ikinci kez doğrular (fotoğraf okunamadı senaryosu).
        entry = await db.scalar(
            select(ProductHistory).where(ProductHistory.action == "ai_generated").order_by(ProductHistory.created_at.desc())
        )
        assert entry is not None
        if images_analyzed:
            assert entry.notes == f"AI açıklama üretildi ({images_analyzed} fotoğraf analiz edildi)"
        else:
            assert entry.notes == "AI açıklama üretildi (fotoğraf gönderilemedi — yalnız metin)"


@pytest.mark.asyncio
async def test_images_analyzed_defaults_to_none_outside_ai_generation():
    """Sayaç yalnız AI üretim yanıtında dolar; diğer ProductOut'larda None kalır."""
    engine, Session = await _fresh()
    async with Session() as db:
        product = _product("0002", 1)
        db.add(product)
        await db.commit()

        assert to_product_out(product).images_analyzed is None
