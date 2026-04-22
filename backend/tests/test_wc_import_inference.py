from __future__ import annotations

from app.models.enums import MetalTypeEnum, ProductTypeEnum
from app.api.products import _infer_metal_type_details, _infer_product_type_details


def test_coin_is_aliased_to_bar_with_source_tag():
    wc_product = {
        "name": "Maple Leaf 1oz guldmønt (2024)",
        "categories": [{"name": "Guldmønter", "slug": "guldmoenter"}],
        "attributes": [],
        "short_description": "",
        "description": "",
    }

    product_type, source_type, review_reasons = _infer_product_type_details(wc_product)
    metal_type, metal_review_reasons = _infer_metal_type_details(wc_product)

    assert product_type == ProductTypeEnum.BAR
    assert source_type == "coin"
    assert review_reasons == []
    assert metal_type == MetalTypeEnum.YELLOW_GOLD
    assert metal_review_reasons == []


def test_white_gold_detected_from_name():
    wc_product = {
        "name": "Ørehængere med diamanter i 14 karat hvidguld",
        "categories": [{"name": "Smykker", "slug": "smykker"}],
        "attributes": [],
        "short_description": "",
        "description": "",
    }

    metal_type, review_reasons = _infer_metal_type_details(wc_product)
    assert metal_type == MetalTypeEnum.WHITE_GOLD
    assert review_reasons == []


def test_unknown_type_and_metal_require_manual_review():
    wc_product = {
        "name": "Mystery Collectible",
        "categories": [{"name": "Special", "slug": "special"}],
        "attributes": [],
        "short_description": "",
        "description": "Rare collectible item.",
    }

    product_type, source_type, type_review_reasons = _infer_product_type_details(wc_product)
    metal_type, metal_review_reasons = _infer_metal_type_details(wc_product)

    assert product_type == ProductTypeEnum.JEWELRY
    assert source_type is None
    assert "type_unknown" in type_review_reasons

    assert metal_type == MetalTypeEnum.YELLOW_GOLD
    assert "metal_unknown" in metal_review_reasons

