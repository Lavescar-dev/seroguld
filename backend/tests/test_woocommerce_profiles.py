from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

from app.services.woocommerce import _build_attributes, _spec_strip_text
from app.services.woocommerce_profiles import (
    PROFILE_BAR,
    PROFILE_COIN,
    PROFILE_JEWELRY,
    PROFILE_PLATINUM,
    effective_publish_profile,
    resolve_publish_profile,
)


def _p(**over):
    base = dict(
        product_number="0001",
        reference_number="1201",
        product_type=SimpleNamespace(value="jewelry"),
        metal_type=SimpleNamespace(value="yellow_gold"),
        purity_karat="14K",
        purity_percentage=Decimal("58.50"),
        weight_grams=Decimal("1.15"),
        length_cm="1,40cm",
        width_mm=Decimal("1.10"),
        thickness_mm=Decimal("5.22"),
        diameter_mm=None,
        producer="JAR",
        inventory_category="taki",
        inventory_subcategory=None,
        woocommerce_publish_profile=None,
        production_year=None,
    )
    base.update(over)
    return SimpleNamespace(**base)


def _attrs(product):
    return {item["name"]: item["options"][0] for item in _build_attributes(product)}


def test_resolve_profiles_by_category_and_metal():
    assert resolve_publish_profile(_p()) == PROFILE_JEWELRY
    assert resolve_publish_profile(_p(inventory_category="kulce", product_type=SimpleNamespace(value="bar"))) == PROFILE_BAR
    assert resolve_publish_profile(_p(inventory_category="gumus", inventory_subcategory="barrer", metal_type=SimpleNamespace(value="silver"))) == PROFILE_BAR
    assert resolve_publish_profile(_p(inventory_category="gumus", inventory_subcategory="monter", metal_type=SimpleNamespace(value="silver"))) == PROFILE_COIN
    assert resolve_publish_profile(_p(inventory_category="gumus", inventory_subcategory="smykker", metal_type=SimpleNamespace(value="silver"))) == PROFILE_JEWELRY
    assert resolve_publish_profile(_p(metal_type=SimpleNamespace(value="platinum"), inventory_category="platin_pd")) == PROFILE_PLATINUM


def test_operator_override_wins():
    # Gold coin CRM'de taki'ye türer; operatör 'coin' seçer.
    coin = _p(woocommerce_publish_profile="coin")
    assert effective_publish_profile(coin) == PROFILE_COIN
    # Geçersiz override türetime düşer.
    assert effective_publish_profile(_p(woocommerce_publish_profile="xxx")) == PROFILE_JEWELRY


def test_jewelry_attributes_and_strip():
    attrs = _attrs(_p())
    assert attrs["Karat"] == "14 Karat"
    assert attrs["Renhed"] == "0,585"
    assert attrs["Vægt"] == "1,15g"
    assert attrs["Længde"] == "1,40cm"
    assert _spec_strip_text(_p()) == "Vare nr. : 1201 Vægt: 1,15g Længde: 1,40cm Bredde: 1,10mm Tykkelse: 5,22mm"


def test_jewelry_attributes_length_auto_cm():
    # Birimsiz ham sayı: attribute tablosunda da 'cm' eklenir (X5, spec şeridiyle aynı kural).
    attrs = _attrs(_p(length_cm="42,6"))
    assert attrs["Længde"] == "42,6cm"
    # Aralıklı serbest metin olduğu gibi kalır.
    attrs2 = _attrs(_p(length_cm="18-19cm"))
    assert attrs2["Længde"] == "18-19cm"


def test_gold_coin_attributes_include_dimensions_and_year():
    coin = _p(
        woocommerce_publish_profile="coin",
        purity_karat="24K",
        purity_percentage=Decimal("99.99"),
        weight_grams=Decimal("31.10"),
        length_cm=None,
        width_mm=None,
        thickness_mm=Decimal("2.95"),
        diameter_mm=Decimal("32.70"),
        producer="US Mint",
        production_year=2024,
    )
    attrs = _attrs(coin)
    assert attrs["Vægt"] == "31,10 gram"
    assert attrs["Karat"] == "24"  # çıplak
    assert attrs["Renhed"] == "999,9 promille (99,99%)"
    assert attrs["Diameter"] == "32,70mm"
    assert attrs["Tykkelse"] == "2,95mm"
    assert attrs["Producent"] == "US Mint"
    assert attrs["Årstal"] == "2024"


def test_platinum_uses_aedelmetal_not_karat():
    plat = _p(
        metal_type=SimpleNamespace(value="platinum"),
        inventory_category="platin_pd",
        purity_karat="",
        purity_percentage=Decimal("99.95"),
        weight_grams=Decimal("31.10"),
        length_cm=None,
        width_mm=None,
        thickness_mm=None,
        diameter_mm=None,
        producer="Münze Österreich",
    )
    attrs = _attrs(plat)
    assert attrs["Ædelmetal"] == "Platin"
    assert "Karat" not in attrs
    assert attrs["Renhed"] == "999,5 promille (99,95%)"
    assert attrs["Vægt"] == "31,10 gram"
    assert "Diameter" not in attrs  # platin minimal (ölçü yok)
