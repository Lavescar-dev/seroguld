from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.woocommerce_catalog import WooCommerceCatalogItem
from app.services.woocommerce import WooCommerceService
from app.services.woocommerce_catalog_service import update_catalog_item_content


async def _fresh():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


def _item() -> WooCommerceCatalogItem:
    return WooCommerceCatalogItem(
        woocommerce_product_id=501,
        name="Gammel ring",
        source_payload_sha256="x" * 64,
        source_payload_json={
            "id": 501,
            "name": "Gammel ring",
            "description": "<p>gammel beskrivelse</p>",
            "short_description": "<p>gammel kort</p>",
            "meta_data": [
                {"key": "_yoast_wpseo_title", "value": "Gammel SEO"},
                {"key": "rank_math_title", "value": "Gammel SEO"},
                {"key": "_yoast_wpseo_metadesc", "value": "Gammel meta"},
                {"key": "rank_math_description", "value": "Gammel meta"},
            ],
        },
    )


@pytest.mark.asyncio
async def test_content_update_persists_snapshot_and_writes_both_seo_plugin_keys(monkeypatch) -> None:
    """R1-16 regresyonu: (1) source_payload_json GERÇEKTEN persist edilir
    (JSON in-place mutasyon tuzağı — flag_modified şart); (2) SEO düzenlemesi
    HER İKİ eklenti anahtarına da yazılır (site eklentisi bilinmez)."""
    engine, Session = await _fresh()
    captured: dict = {}

    async def fake_wc_request(self, method, path, *, json_payload=None, params=None):
        captured["method"] = method
        captured["path"] = path
        captured["payload"] = json_payload
        # Woo yanıtı: gönderilen alanlar + mevcut meta'nın birleşimi
        return {
            "id": 501,
            "name": json_payload.get("name", "Gammel ring"),
            "description": json_payload.get("description", "<p>gammel beskrivelse</p>"),
            "short_description": json_payload.get("short_description", "<p>gammel kort</p>"),
            "meta_data": json_payload.get("meta_data", []),
        }

    monkeypatch.setattr(WooCommerceService, "_wc_request", fake_wc_request)

    async with Session() as db:
        item = _item()
        db.add(item)
        await db.commit()
        item_id = item.id

        out = await update_catalog_item_content(
            db,
            catalog_item_id=item_id,
            description_html="<p>ny beskrivelse</p>",
            seo_title="Ny SEO titel",
            meta_description="Ny metabeskrivelse",
        )
        assert out.description_html == "<p>ny beskrivelse</p>"

    # Woo'ya giden meta: her iki eklenti anahtarı + crm_meta_description
    sent_meta = {entry["key"]: entry["value"] for entry in captured["payload"]["meta_data"]}
    assert sent_meta["_yoast_wpseo_title"] == "Ny SEO titel"
    assert sent_meta["rank_math_title"] == "Ny SEO titel"
    assert sent_meta["_yoast_wpseo_metadesc"] == "Ny metabeskrivelse"
    assert sent_meta["rank_math_description"] == "Ny metabeskrivelse"
    assert sent_meta["crm_meta_description"] == "Ny metabeskrivelse"

    # TAZE session: identity map devre dışı — DB'de gerçekten ne var?
    async with Session() as db2:
        row = (
            await db2.execute(select(WooCommerceCatalogItem).where(WooCommerceCatalogItem.id == item_id))
        ).scalar_one()
        payload = row.source_payload_json
        assert payload["description"] == "<p>ny beskrivelse</p>"
        meta = {entry["key"]: entry["value"] for entry in payload["meta_data"]}
        assert meta["_yoast_wpseo_title"] == "Ny SEO titel"
        assert meta["rank_math_title"] == "Ny SEO titel"

    await engine.dispose()
