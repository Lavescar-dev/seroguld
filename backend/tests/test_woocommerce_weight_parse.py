from __future__ import annotations

from decimal import Decimal

from app.api.products import _extract_weight_grams


def test_extract_weight_from_woo_weight_field():
    wc_product = {
        "name": "Test Product",
        "weight": "0.62",
        "attributes": [],
    }
    assert _extract_weight_grams(wc_product) == Decimal("0.62")


def test_extract_weight_from_weight_attribute_option():
    wc_product = {
        "name": "Y-moenster armlaenke i 14 karat guld",
        "weight": "",
        "attributes": [
            {"name": "Karat", "options": ["14 Karat"]},
            {"name": "Vaegt", "options": ["15,20g"]},
        ],
    }
    assert _extract_weight_grams(wc_product) == Decimal("15.20")


def test_extract_weight_from_text_fallback():
    wc_product = {
        "name": "Argor-Heraeus soelvbarre 1000g - 999",
        "weight": "",
        "attributes": [],
    }
    assert _extract_weight_grams(wc_product) == Decimal("1000.00")


def test_extract_weight_overrides_placeholder_raw_weight_with_text_weight():
    wc_product = {
        "name": "Argor-Heraeus soelvbarre 1000g - 999",
        "weight": "1",
        "attributes": [],
    }
    assert _extract_weight_grams(wc_product) == Decimal("1000.00")


def test_extract_weight_returns_none_when_unknown():
    wc_product = {
        "name": "Vedhaeng med kvart resat guldmoent i 22 karat guld",
        "weight": "",
        "attributes": [
            {"name": "Vaegt", "options": ["xxx"]},
        ],
    }
    assert _extract_weight_grams(wc_product) is None
