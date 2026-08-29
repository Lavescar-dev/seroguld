from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

from app.config import Settings
from app.services.woocommerce import (
    DESC_FOOTER_DA_DEFAULT,
    DESC_FOOTER_MARKER_START,
    SPEC_STRIP_MARKER_START,
    _apply_description_footer,
    _apply_spec_strip,
    _build_badge_meta,
    _spec_strip_text,
    build_publish_payload,
)

CATEGORY_MAP = {
    "primary": {
        "taki": {"gold": 101, "silver": 102},
        "kulce": {"gold": 111, "silver": 112},
        "sikke": {"gold": 121},
        "gumus": {"silver": 102},
        "platin_pd": {"platinum": 131, "palladium": 132},
    },
    "karat": {"8": 201, "14": 202, "18": 203, "22": 204, "24": 205},
}

STONEX_MAP = {
    "metal_type": "stonex_metal_type",
    "metal_weight": "stonex_metal_weight",
    "metal_purity": "stonex_metal_purity",
}

BADGE_META = {
    "entries": [
        {"key": "_product_badge", "value": "Ny vare"},
        {"key": "_badge_end", "value_kind": "publish_date_plus_days", "days": 30, "format": "iso_date"},
    ]
}

AI_BUNDLE = (
    "SEO_TITLE: Guldarmbånd i gult guld 19,65 g - 22 kt\n"
    "SHORT_DESCRIPTION: Elegant armbånd.\n"
    "LONG_DESCRIPTION_HTML: <p>Dette armbånd er flot.</p>\n"
    "META_DESCRIPTION: Guldarmbånd med flade led.\n"
    "URL_SLUG: guldarmbaand-gult-guld-19-65g-22kt-xxxx\n"
)


def _settings(**overrides) -> Settings:
    values = dict(
        _env_file=None,
        database_url="sqlite+aiosqlite:///test.db",
        woocommerce_category_map_json=json.dumps(CATEGORY_MAP),
        woocommerce_stonex_meta_map_json=json.dumps(STONEX_MAP),
        woocommerce_badge_meta_json=json.dumps(BADGE_META),
    )
    values.update(overrides)
    return Settings(**values)


def _product(**overrides) -> SimpleNamespace:
    values = dict(
        id="pid-1",
        product_number="0004",
        reference_number="xxxx",
        product_type=SimpleNamespace(value="bracelet"),
        metal_type=SimpleNamespace(value="yellow_gold"),
        purity_karat="22K",
        purity_percentage=Decimal("91.60"),
        weight_grams=Decimal("19.65"),
        length_cm="20,00cm",
        width_mm=Decimal("26.11"),
        thickness_mm=Decimal("2.32"),
        diameter_mm=None,
        producer="Ukendt",
        inventory_category="taki",
        inventory_subcategory=None,
        woocommerce_product_id=None,
        ai_description=AI_BUNDLE,
        photos=[],
    )
    values.update(overrides)
    return SimpleNamespace(**values)


def _meta_map(payload: dict) -> dict[str, object]:
    return {item["key"]: item["value"] for item in payload["meta_data"]}


def test_full_maps_produce_categories_attributes_and_metas() -> None:
    payload, warnings = build_publish_payload(
        product=_product(),
        regular_price_dkk=Decimal("15543.00"),
        name=None,
        images=[{"id": 11}],
        settings=_settings(),
    )

    # Kategoriler: primer (taki/gold) ilk sırada + karat kategorisi; yaratma yok.
    assert payload["categories"] == [{"id": 101}, {"id": 204}]
    meta = _meta_map(payload)
    assert meta["_yoast_wpseo_primary_product_cat"] == "101"

    # Attributes — sitedeki 'Yderligere information' tablosu.
    attributes = {item["name"]: item["options"][0] for item in payload["attributes"]}
    assert attributes["Karat"] == "22 karat"
    assert attributes["Renhed"] == "0,916"
    assert attributes["Vægt"] == "19,65g"
    assert attributes["Længde"] == "20,00cm"
    assert attributes["Bredde"] == "26,11mm"
    assert attributes["Tykkelse"] == "2,32mm"
    assert attributes["Producent"] == "Ukendt"
    assert attributes["Vare nr."] == "xxxx"
    assert "Diameter" not in attributes  # boş alan atlanır

    # SEO title artık Yoast/RankMath meta'larına da gider.
    assert meta["_yoast_wpseo_title"].startswith("Guldarmbånd")
    assert meta["rank_math_title"] == meta["_yoast_wpseo_title"]
    assert meta["_yoast_wpseo_metadesc"] == "Guldarmbånd med flade led."

    # StoneX alanları harita anahtarlarıyla dolar.
    assert meta["stonex_metal_type"] == "Gult Guld"
    assert meta["stonex_metal_weight"] == "19,65"
    assert meta["stonex_metal_purity"] == "22 karat"

    # Badge: statik değer + 30 gün zamanlama.
    assert meta["_product_badge"] == "Ny vare"
    end_date = datetime.strptime(str(meta["_badge_end"]), "%Y-%m-%d").replace(tzinfo=timezone.utc)
    assert abs((end_date - datetime.now(timezone.utc)).days - 30) <= 1

    # Takı ürününde footer marker'la eklenir; DB'ye yazılmaz (payload-only).
    assert DESC_FOOTER_MARKER_START in payload["description"]
    assert "Vi garanterer altid p" in payload["description"]
    assert payload["images"] == [{"id": 11}]
    assert warnings == []


def test_empty_maps_degrade_gracefully_with_warnings() -> None:
    payload, warnings = build_publish_payload(
        product=_product(),
        regular_price_dkk=Decimal("100"),
        name=None,
        images=[],
        settings=_settings(
            woocommerce_category_map_json="",
            woocommerce_stonex_meta_map_json="",
            woocommerce_badge_meta_json="",
        ),
    )
    assert payload["categories"] == []
    meta = _meta_map(payload)
    assert "stonex_metal_type" not in meta
    assert "_product_badge" not in meta
    assert any("Kategori haritası boş" in warning for warning in warnings)
    assert any("StoneX meta haritası boş" in warning for warning in warnings)
    # Yayın engellenmez; temel alanlar yerinde.
    assert payload["status"] == "publish"
    assert payload["regular_price"] == "100.00"


def test_bar_product_uses_investment_profile_attributes_footer_and_no_karat_category() -> None:
    bar = _product(
        product_type=SimpleNamespace(value="bar"),
        inventory_category="kulce",
        purity_karat="24K",
        purity_percentage=Decimal("99.99"),
        weight_grams=Decimal("2.50"),
        length_cm=None,
        width_mm=None,
        thickness_mm=None,
        diameter_mm=None,
        producer="Valcambi Suisse",
    )
    payload, _ = build_publish_payload(
        product=bar,
        regular_price_dkk=Decimal("5000"),
        name=None,
        images=[],
        settings=_settings(),
    )
    assert payload["categories"] == [{"id": 111}]  # kulce/gold; karat kategorisi yok
    # Yatırım footer'ı (Størrelsesguide değil).
    assert DESC_FOOTER_MARKER_START in payload["description"]
    assert "Investering" in payload["description"]
    assert "Størrelsesguide" not in payload["description"]
    # Yatırım attribute formatı: Vægt gram, çıplak karat, Renhed promille, ölçü yok.
    attrs = {item["name"]: item["options"][0] for item in payload["attributes"]}
    assert attrs["Vægt"] == "2,50 gram"
    assert attrs["Karat"] == "24"
    assert attrs["Renhed"] == "999,9 promille (99,99%)"
    assert "Længde" not in attrs and "Bredde" not in attrs and "Tykkelse" not in attrs


def test_footer_is_idempotent_and_overridable() -> None:
    custom = "<p>Özel blok</p>"
    once = _apply_description_footer("<p>Metin</p>", custom)
    twice = _apply_description_footer(once, custom)
    assert twice.count(DESC_FOOTER_MARKER_START) == 1
    assert twice.count("Özel blok") == 1

    payload, _ = build_publish_payload(
        product=_product(),
        regular_price_dkk=Decimal("100"),
        name=None,
        images=[],
        settings=_settings(woocommerce_desc_footer_html=custom),
    )
    assert "Özel blok" in payload["description"]
    assert DESC_FOOTER_DA_DEFAULT not in payload["description"]

    disabled, _ = build_publish_payload(
        product=_product(),
        regular_price_dkk=Decimal("100"),
        name=None,
        images=[],
        settings=_settings(woocommerce_desc_footer_enabled=False),
    )
    assert DESC_FOOTER_MARKER_START not in disabled["description"]


def test_badge_meta_epoch_and_unknown_kind() -> None:
    now = datetime(2026, 8, 19, 12, 0, tzinfo=timezone.utc)
    meta, warnings = _build_badge_meta(
        {
            "entries": [
                {"key": "_start", "value_kind": "publish_date", "format": "epoch"},
                {"key": "_odd", "value_kind": "garip"},
            ]
        },
        now=now,
    )
    assert meta == [{"key": "_start", "value": str(int(now.timestamp()))}]
    assert any("garip" in warning for warning in warnings)


def test_platinum_product_resolves_platin_pd_category() -> None:
    platinum = _product(
        metal_type=SimpleNamespace(value="platinum"),
        inventory_category="platin_pd",
        purity_karat=None,
        purity_percentage=Decimal("95.00"),
    )
    payload, warnings = build_publish_payload(
        product=platinum,
        regular_price_dkk=Decimal("900"),
        name=None,
        images=[],
        settings=_settings(),
    )
    assert payload["categories"] == [{"id": 131}]
    assert not any("kategori" in warning.lower() for warning in warnings)


def test_spec_strip_added_to_both_descriptions_idempotently() -> None:
    once = _apply_spec_strip("<p>Metin</p>", "Vare nr. : 1427 Længde: 1,40cm")
    twice = _apply_spec_strip(once, "Vare nr. : 1427 Længde: 1,40cm")
    assert twice.count(SPEC_STRIP_MARKER_START) == 1
    assert twice.count("Vare nr. : 1427") == 1
    # A2: şerit paragrafın ALTINDA (paragraf → yeşil kutu → kapanış satırı).
    assert twice.index("<p>Metin</p>") == 0
    assert twice.index(SPEC_STRIP_MARKER_START) > twice.index("<p>Metin</p>")

    # Referans düzeni (R2-18): Vare nr. → Vægt → doldurulmuş ölçüler.
    pendant = _product(
        reference_number="1201",
        length_cm="1,40cm",
        width_mm=Decimal("1.10"),
        thickness_mm=Decimal("5.22"),
        diameter_mm=None,
    )
    assert _spec_strip_text(pendant) == "Vare nr. : 1201, Vægt: 19,65g Længde: 1,40cm, Bredde: 1,10mm, Tykkelse: 5,22mm"

    # Yalnız çaplı ürün (yüzük): sadece Diameter.
    ring = _product(reference_number="1427", length_cm=None, width_mm=None, thickness_mm=None, diameter_mm=Decimal("5.97"))
    assert _spec_strip_text(ring) == "Vare nr. : 1427, Vægt: 19,65g Diameter: 5,97mm"

    # Ölçüsüz ürün: yalnız Vare nr.
    plain = _product(reference_number="9000", length_cm=None, width_mm=None, thickness_mm=None, diameter_mm=None)
    assert _spec_strip_text(plain) == "Vare nr. : 9000, Vægt: 19,65g"

    payload, _ = build_publish_payload(
        product=pendant,
        regular_price_dkk=Decimal("100"),
        name=None,
        images=[],
        settings=_settings(),
    )
    strip = "Vare nr. : 1201, Vægt: 19,65g Længde: 1,40cm, Bredde: 1,10mm, Tykkelse: 5,22mm"
    # A2: şerit iki açıklamada da paragrafın ALTINDA; kısa açıklamada
    # kapanış satırı ("Detaljeret…") en sonda kalır.
    short = payload["short_description"]
    assert strip in short and strip in payload["description"]
    assert short.index("Elegant armbånd.") < short.index(SPEC_STRIP_MARKER_START)
    assert payload["description"].index(SPEC_STRIP_MARKER_START) > 0
    closing = "Detaljeret oplysninger ses længere nede under specifikationer."
    assert short.index(SPEC_STRIP_MARKER_START) < short.index(closing)


def test_category_override_beats_settings_map() -> None:
    product = _product(woocommerce_category_ids=[555, 204])
    payload, warnings = build_publish_payload(
        product=product,
        regular_price_dkk=Decimal("100"),
        name=None,
        images=[],
        settings=_settings(woocommerce_category_map_json="{}"),
    )
    assert payload["categories"] == [{"id": 555}, {"id": 204}]
    meta = _meta_map(payload)
    assert meta["_yoast_wpseo_primary_product_cat"] == "555"
    # Harita boş olsa bile override varken kategori uyarısı üretilmez.
    assert not any("Kategori" in warning for warning in warnings)


def test_payload_carries_sku_stock_and_min_price_meta() -> None:
    """R1-29 (SKU + stok=1) ve R1-28/33 (markup / minimum fiyat meta)."""
    product = _product(reference_number="S2593")
    product.purchase_price_dkk = Decimal("5000")
    settings = _settings()
    settings.woocommerce_stonex_meta_map_json = (
        '{"metal_type": "mt_key", "markup_percent": "markup_key", "minimum_price": "min_key"}'
    )
    settings.woocommerce_metal_markup_percent = "35"
    settings.woocommerce_minimum_margin_percent = "10"
    payload, warnings = build_publish_payload(
        product=product,
        regular_price_dkk=Decimal("100"),
        name=None,
        images=[],
        settings=settings,
    )
    assert payload["sku"] == "S2593"
    assert payload["manage_stock"] is True
    assert payload["stock_quantity"] == 1
    assert payload["stock_status"] == "instock"
    assert payload["sold_individually"] is True
    meta = {item["key"]: item["value"] for item in payload["meta_data"]}
    assert meta.get("markup_key") == "35"
    # minimum_price = alış × 1,10 (fixture alışı _product'tan gelir; sadece varlık + pozitiflik)
    assert "min_key" in meta and Decimal(meta["min_key"]) > 0
    assert not [w for w in warnings if "SKU" in w]


def test_new_badge_meta_marked_and_cleared() -> None:
    """R1-21: Nyhed rozeti — işaretli → _sg_nyhed=1 + bitiş; işaretsiz → temizleme."""
    marked, _ = build_publish_payload(
        product=_product(),
        regular_price_dkk=Decimal("100"),
        name=None,
        images=[],
        settings=_settings(woocommerce_new_badge_days=30),
        mark_as_new=True,
    )
    meta = _meta_map(marked)
    assert meta["_sg_nyhed"] == "1"
    from datetime import date

    until = date.fromisoformat(str(meta["_sg_nyhed_until"]))
    delta_days = (until - date.today()).days
    assert 29 <= delta_days <= 30

    cleared, _ = build_publish_payload(
        product=_product(),
        regular_price_dkk=Decimal("100"),
        name=None,
        images=[],
        settings=_settings(),
        mark_as_new=False,
    )
    meta = _meta_map(cleared)
    # Açık False → rozet meta'ları boş değerle temizlenir.
    assert meta["_sg_nyhed"] == "" and meta["_sg_nyhed_until"] == ""

    untouched, _ = build_publish_payload(
        product=_product(),
        regular_price_dkk=Decimal("100"),
        name=None,
        images=[],
        settings=_settings(),
    )
    meta = _meta_map(untouched)
    # None (alan gönderilmedi) → rozete HİÇ dokunulmaz; eski rozet silinmez.
    assert "_sg_nyhed" not in meta and "_sg_nyhed_until" not in meta


def test_spec_strip_wrapped_in_green_box() -> None:
    """R1-13/R1-32: şerit yeşil kutu div'iyle sarılır ve idempotent kalır."""
    payload, _ = build_publish_payload(
        product=_product(reference_number="1201"),
        regular_price_dkk=Decimal("100"),
        name=None,
        images=[],
        settings=_settings(),
    )
    short = payload["short_description"]
    assert 'class="sg-spec-box"' in short
    assert short.count("sg-spec-box") == 1
    assert "Vare nr. : 1201" in short
