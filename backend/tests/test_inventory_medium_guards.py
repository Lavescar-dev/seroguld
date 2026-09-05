"""M1-inventory-be MEDIUM dalga düzeltmeleri.

Kapsam:
- PUT /market-prices artık INVENTORY_MARKET_RATE_PROFILE_JSON'i de günceller
  (drawer ile tek yazı yolu) ve ETKİN değeri döner — sessiz no-op yok.
- update_product terminal durum guard'ı servis katmanında (üç uç tek sözleşme).
- update_status FOR_SALE'den çıkışta Woo yayın bayraklarını temizler; SOLD'da
  satış fiyatı > 0 doğrulanır.
- Workbook import/preview bozuk dosyada 422 / blocking_errors döner (500 yok).
- Şablon eksikliğinde mutasyonlar 500 ile ölmez (guard'lı projeksiyon senkronu,
  workbook GET 503 fallback'i, v2 fiyat ucunda env snapshot/restore).
- attach_library_photo_v2 mime'i sonekten türetir, görüntü olmayan dosyayı reddeder.
- Woo canlı import ham exception metnini sızmaz.
"""

from __future__ import annotations

import io
import json
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from starlette.datastructures import UploadFile

from app.api import inventory as inventory_api
from app.api import products as products_api
from app.api import v2_inventory as v2_api
from app.config import Settings
from app.database import Base
from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum, RoleEnum
from app.models.product import Product
from app.models.user import User
from app.schemas.inventory import InventoryMarketPricesUpdate
from app.schemas.product import LibraryPhotoAttach, ProductStatusUpdate, ProductUpdate, ProductWooImportRequest
from app.services.product_service import update_product, update_status
from app.utils.helpers import utc_now


def _admin() -> User:
    return User(email="medium-admin@example.com", password_hash="x", name="Admin", role=RoleEnum.ADMIN, is_active=True)


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


async def _noop_sync(db, *, admin) -> None:
    return None


def _settings(profile_json: str = "") -> Settings:
    return Settings(
        _env_file=None,
        database_url="sqlite+aiosqlite:///test.db",
        market_rates_live_enabled=False,
        gold_price_live_enabled=True,
        inventory_market_gold_dkk=Decimal("615.50"),
        inventory_market_silver_dkk=Decimal("7.80"),
        inventory_market_platinum_dkk=Decimal("280"),
        inventory_market_palladium_dkk=Decimal("335"),
        inventory_market_rate_profile_json=profile_json,
    )


# ---------------------------------------------------------------------------
# F1/F3 — PUT market-prices JSON profilini günceller (tek yazı yolu)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_put_market_prices_updates_profile_json(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import market_rate_profile as mrp

    saved_env: dict[str, str] = {}

    def fake_upsert(_path: object, values: dict[str, str]) -> None:
        saved_env.update(values)

    monkeypatch.setattr(mrp, "upsert_env_values", fake_upsert)
    # Fake upsert'ın yazdığı JSON'u geri okur — gerçek cache_clear + env akışı.
    monkeypatch.setattr(mrp, "get_settings", lambda: _settings(saved_env.get("INVENTORY_MARKET_RATE_PROFILE_JSON", "")))
    monkeypatch.setattr(mrp.get_settings, "cache_clear", lambda: None, raising=False)
    monkeypatch.setattr(
        inventory_api,
        "get_effective_market_rate_profile_cached",
        lambda: mrp.get_manual_market_rate_profile(),
    )

    stored = json.dumps(
        {
            "gold_rates_dkk": {"8": "205", "24": "612.00"},
            "silver_rates_dkk": {"999": "8.10", "925": "7.40"},
            "platinum_dkk": "300.00",
            "palladium_dkk": "340.00",
        }
    )
    saved_env["INVENTORY_MARKET_RATE_PROFILE_JSON"] = stored

    result = await inventory_api.put_inventory_market_prices(
        InventoryMarketPricesUpdate(
            gold=Decimal("700"),
            silver=Decimal("9"),
            platinum=Decimal("310"),
            palladium=Decimal("350"),
        ),
        db=None,
        _=None,
    )

    # Yanıt ETKİN değeri taşır: '200 döndü ama fiyat değişmedi' no-op'u yok.
    assert result.gold == Decimal("700.00")
    assert result.silver == Decimal("9.00")
    assert result.platinum == Decimal("310.00")

    written = json.loads(saved_env["INVENTORY_MARKET_RATE_PROFILE_JSON"])
    # Skalerler profilin kanonik matris anahtarlarına yazıldı...
    assert written["gold_rates_dkk"]["24"] == "700.00"
    assert written["silver_rates_dkk"]["999"] == "9.00"
    assert written["platinum_dkk"] == "310.00"
    # ...mevcut karat-özel değerler KORUNDU (ölçekli yeniden türetim yok).
    assert written["gold_rates_dkk"]["8"] == "205.00"
    assert written["silver_rates_dkk"]["925"] == "7.40"
    # Tek yazı yolu env skalerlerini de güncel tutar.
    assert saved_env["INVENTORY_MARKET_GOLD_DKK"] == "700.00"
    assert saved_env["INVENTORY_MARKET_PLATINUM_DKK"] == "310.00"


# ---------------------------------------------------------------------------
# F5 — terminal durum guard'ı servis katmanında
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_product_rejects_terminal_status_at_service_level() -> None:
    engine, Session = await _fresh_session()
    async with Session() as session:
        admin = _admin()
        product = _product("0001", ProductStatusEnum.SOLD)
        session.add_all([admin, product])
        await session.commit()

        for payload in (
            ProductUpdate(notes="satılmış ürüne not"),
            ProductUpdate(purchase_price_dkk=Decimal("1")),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await update_product(session, product, payload, admin.id)
            assert exc_info.value.status_code == 400
            assert "Terminal" in str(exc_info.value.detail)
    await engine.dispose()


# ---------------------------------------------------------------------------
# F11 — Woo yayın bayrağı temizliği + satış fiyatı doğrulaması
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_leaving_for_sale_clears_woo_publish_flags() -> None:
    engine, Session = await _fresh_session()
    async with Session() as session:
        admin = _admin()
        melted = _product("0001", ProductStatusEnum.FOR_SALE)
        melted.is_published_to_site = True
        melted.published_at = utc_now()
        sold = _product("0002", ProductStatusEnum.FOR_SALE)
        sold.is_published_to_site = True
        sold.published_at = utc_now()
        session.add_all([admin, melted, sold])
        await session.commit()

        updated_melt = await update_status(
            session,
            melted,
            ProductStatusUpdate(status=ProductStatusEnum.MELTED, melt_reason="Test eritme"),
            admin.id,
        )
        assert updated_melt.is_published_to_site is False
        assert updated_melt.published_at is None

        updated_sold = await update_status(
            session,
            sold,
            ProductStatusUpdate(status=ProductStatusEnum.SOLD, sale_price_dkk=Decimal("800")),
            admin.id,
        )
        assert updated_sold.is_published_to_site is False
        assert updated_sold.published_at is None
    await engine.dispose()


@pytest.mark.asyncio
async def test_sold_rejects_non_positive_sale_price_at_service_level() -> None:
    engine, Session = await _fresh_session()
    async with Session() as session:
        admin = _admin()
        product = _product("0001", ProductStatusEnum.FOR_SALE)
        session.add_all([admin, product])
        await session.commit()

        # Pydantic (gt=0) API sınırında keser; servis guard'ı doğrudan çağrıları
        # da kapsar — model_construct ile validasyon atlanır.
        payload = ProductStatusUpdate.model_construct(
            status=ProductStatusEnum.SOLD,
            sale_price_dkk=Decimal("0"),
            buyer_customer_id=None,
            melt_reason=None,
            expected_updated_at=None,
        )
        with pytest.raises(HTTPException) as exc_info:
            await update_status(session, product, payload, admin.id)
        assert exc_info.value.status_code == 422
    await engine.dispose()


# ---------------------------------------------------------------------------
# F4 — şablon eksikliğinde mutasyon/okuma uçları ölmez
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_guarded_sync_survives_missing_template(monkeypatch: pytest.MonkeyPatch) -> None:
    async def missing_template(db, *, admin) -> None:
        raise FileNotFoundError("Referans workbook bulunamadı: Depolama.xlsx")

    monkeypatch.setattr(v2_api, "_sync_inventory_projection", missing_template)
    # Yükseltmemeli: mutasyon geçer, projeksiyon atlanır.
    await v2_api.sync_inventory_projection_guarded(None, admin=None)


@pytest.mark.asyncio
async def test_workbook_get_503_when_no_template_and_no_artifact(monkeypatch: pytest.MonkeyPatch) -> None:
    engine, Session = await _fresh_session()
    async with Session() as session:
        async def missing(db, workspace, *, create_snapshot):
            raise FileNotFoundError("Referans workbook bulunamadı: Depolama.xlsx")

        async def no_record(db, key):
            return None

        monkeypatch.setattr(v2_api, "sync_inventory_workbook_artifact", missing)
        monkeypatch.setattr(v2_api, "get_artifact_record", no_record)

        with pytest.raises(HTTPException) as exc_info:
            await v2_api.get_depolama_workbook_v2(db=session, _=None)
        assert exc_info.value.status_code == 503
    await engine.dispose()


# ---------------------------------------------------------------------------
# F6/F7 — bozuk workbook: 422 / blocking_errors (ham 500 yok)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_workbook_reconcile_preview_returns_blocking_errors_for_garbage() -> None:
    engine, Session = await _fresh_session()
    async with Session() as session:
        upload = UploadFile(file=io.BytesIO(b"not-an-xlsx"), filename="bozuk.xlsx")
        out = await v2_api.post_depolama_workbook_reconcile_preview_v2(workbook=upload, db=session, _=None)
        # Dry-run sözleşmesi: mutasyonsuz güvenli önizleme 500 ile ölmez.
        assert out.editable is False
        assert out.blocking_errors and "Excel" in out.blocking_errors[0]
    await engine.dispose()


@pytest.mark.asyncio
async def test_workbook_import_rejects_garbage_with_422() -> None:
    engine, Session = await _fresh_session()
    async with Session() as session:
        upload = UploadFile(file=io.BytesIO(b"not-an-xlsx"), filename="bozuk.xlsx")
        with pytest.raises(HTTPException) as exc_info:
            await v2_api.post_depolama_workbook_import_v2(workbook=upload, db=session, _=None)
        assert exc_info.value.status_code == 422
        assert "Excel" in str(exc_info.value.detail)
    await engine.dispose()


@pytest.mark.asyncio
async def test_workbook_import_rejects_empty_file_with_422() -> None:
    engine, Session = await _fresh_session()
    async with Session() as session:
        upload = UploadFile(file=io.BytesIO(b""), filename="bos.xlsx")
        with pytest.raises(HTTPException) as exc_info:
            await v2_api.post_depolama_workbook_import_v2(workbook=upload, db=session, _=None)
        assert exc_info.value.status_code == 422
        assert "Boş" in str(exc_info.value.detail)
    await engine.dispose()


# ---------------------------------------------------------------------------
# F8 — v2 fiyat ucunda env snapshot/restore
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_v2_market_prices_restores_env_when_sync_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    engine, Session = await _fresh_session()
    async with Session() as session:
        restored: list[object] = []

        async def fake_legacy(payload, db=None, _=None):
            return "RESULT"

        async def fake_workspace(q=None, db=None, _=None):
            return object()

        async def failing_sync(db, workspace, *, create_snapshot, force_sync, commit=True):
            raise OSError("artifact yazılamadı")

        monkeypatch.setattr(v2_api, "put_legacy_inventory_market_prices", fake_legacy)
        monkeypatch.setattr(v2_api, "get_legacy_inventory_workspace", fake_workspace)
        monkeypatch.setattr(v2_api, "ensure_inventory_artifact", failing_sync)
        monkeypatch.setattr(v2_api, "snapshot_inventory_environment", lambda: "SNAP")
        monkeypatch.setattr(v2_api, "restore_inventory_environment", lambda snap: restored.append(snap))

        with pytest.raises(OSError):
            await v2_api.put_depolama_market_prices_v2(payload=None, db=session, _=None)
        assert restored == ["SNAP"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_v2_market_prices_keeps_env_when_template_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    engine, Session = await _fresh_session()
    async with Session() as session:
        restored: list[object] = []

        async def fake_legacy(payload, db=None, _=None):
            return "RESULT"

        async def fake_workspace(q=None, db=None, _=None):
            return object()

        async def missing_template(db, workspace, *, create_snapshot, force_sync, commit=True):
            raise FileNotFoundError("Referans workbook bulunamadı: Depolama.xlsx")

        monkeypatch.setattr(v2_api, "put_legacy_inventory_market_prices", fake_legacy)
        monkeypatch.setattr(v2_api, "get_legacy_inventory_workspace", fake_workspace)
        monkeypatch.setattr(v2_api, "ensure_inventory_artifact", missing_template)
        monkeypatch.setattr(v2_api, "snapshot_inventory_environment", lambda: "SNAP")
        monkeypatch.setattr(v2_api, "restore_inventory_environment", lambda snap: restored.append(snap))

        # Şablon eksikliği fiyat yazımını geri ALMAZ: yalnız projeksiyon atlanır.
        result = await v2_api.put_depolama_market_prices_v2(payload=None, db=session, _=None)
        assert result == "RESULT"
        assert restored == []
    await engine.dispose()


# ---------------------------------------------------------------------------
# F2 (ek) — attach_library_photo_v2 mime türetimi + uzantı allowlist'i
# ---------------------------------------------------------------------------


class _FakeMediaSettings:
    def __init__(self, root) -> None:
        self._root = root

    def media_root_path(self):
        return self._root


@pytest.mark.asyncio
async def test_attach_library_photo_derives_mime_and_rejects_non_image(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(v2_api, "_sync_inventory_projection", _noop_sync)
    monkeypatch.setattr("app.config.get_settings", lambda: _FakeMediaSettings(tmp_path))
    pool = tmp_path / "seed-library" / "depolama"
    pool.mkdir(parents=True)
    (pool / "foto.png").write_bytes(b"pngdata")
    (pool / "manifest.json").write_text("{}")

    engine, Session = await _fresh_session()
    async with Session() as session:
        admin = _admin()
        product = _product("0001", ProductStatusEnum.IN_INVENTORY)
        session.add_all([admin, product])
        await session.commit()

        # Havuzdaki görüntü olmayan dosya (.json) reddedilir.
        with pytest.raises(HTTPException) as exc_info:
            await v2_api.attach_library_photo_v2(
                product.id, LibraryPhotoAttach(file="manifest.json"), db=session, admin=admin
            )
        assert exc_info.value.status_code == 422

        # Mime sonekten türetilir; AVIF varyantı yalnız AVIF dosyada var.
        out = await v2_api.attach_library_photo_v2(
            product.id, LibraryPhotoAttach(file="foto.png"), db=session, admin=admin
        )
        assert out.photos[0].url == "/media/seed-library/depolama/foto.png"
        assert out.photos[0].mime_type == "image/png"
        assert out.photos[0].avif_url is None
    await engine.dispose()


# ---------------------------------------------------------------------------
# F9 — Woo canlı import ham exception metni sızmaz
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_woo_import_does_not_leak_raw_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(v2_api, "_sync_inventory_projection", _noop_sync)
    engine, Session = await _fresh_session()
    async with Session() as session:
        admin = _admin()
        session.add(admin)
        await session.commit()

        class FakeWoo:
            async def fetch_recent_published_products(self, limit):
                return [{"id": 42, "name": "Test ürünü"}]

        def boom(*args, **kwargs):
            raise RuntimeError("gizli-db-baglanti-detayi")

        monkeypatch.setattr(products_api, "WooCommerceService", lambda: FakeWoo())
        monkeypatch.setattr(products_api, "extract_wc_price_dkk", boom)

        response = await products_api.import_woocommerce_live_products(
            ProductWooImportRequest(limit=5),
            mock_seed_product_ids=None,
            db=session,
            admin=admin,
        )

        assert response.created == 0
        assert response.updated == 0
        assert response.errors and response.errors[0].startswith("wc_id=42:")
        assert "gizli-db-baglanti-detayi" not in response.errors[0]
        assert "ürün işlenemedi" in response.errors[0]
    await engine.dispose()
