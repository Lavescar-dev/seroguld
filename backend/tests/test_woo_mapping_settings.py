from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.api.settings import _validated_json_field


def test_valid_json_is_compacted_to_single_line() -> None:
    raw = '{\n  "primary": {"taki": {"gold": 101}},\n  "karat": {"14": 202}\n}'
    result = _validated_json_field("Kategori haritası", raw, dict)
    assert "\n" not in result
    assert result == '{"primary":{"taki":{"gold":101}},"karat":{"14":202}}'


def test_empty_json_field_persists_as_empty_string() -> None:
    assert _validated_json_field("Kategori haritası", "   ", dict) == ""


def test_invalid_json_raises_422_with_location() -> None:
    with pytest.raises(HTTPException) as exc:
        _validated_json_field("StoneX meta haritası", '{"metal_type": }', dict)
    assert exc.value.status_code == 422
    assert "StoneX meta haritası" in str(exc.value.detail)


def test_wrong_json_shape_raises_422() -> None:
    with pytest.raises(HTTPException) as exc:
        _validated_json_field("Badge meta tanımı", '["liste"]', dict)
    assert exc.value.status_code == 422


def test_new_settings_fields_have_safe_defaults() -> None:
    from app.config import Settings

    settings = Settings(_env_file=None, database_url="sqlite+aiosqlite:///test.db")
    assert settings.woocommerce_category_map_json == ""
    assert settings.woocommerce_stonex_meta_map_json == ""
    assert settings.woocommerce_badge_meta_json == ""
    assert settings.woocommerce_desc_footer_html == ""
    assert settings.woocommerce_desc_footer_enabled is True
    assert settings.woocommerce_primary_term_meta_key == "_yoast_wpseo_primary_product_cat"


def test_installer_allowlists_carry_new_keys() -> None:
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    for script in ("scripts/build-windows-runtime.ps1", "scripts/release-windows-native.ps1"):
        content = (root / script).read_text(encoding="utf-8")
        for key in (
            "WOOCOMMERCE_CATEGORY_MAP_JSON",
            "WOOCOMMERCE_STONEX_META_MAP_JSON",
            "WOOCOMMERCE_BADGE_META_JSON",
            "WOOCOMMERCE_DESC_FOOTER_HTML",
            "WOOCOMMERCE_DESC_FOOTER_ENABLED",
            "WOOCOMMERCE_PRIMARY_TERM_META_KEY",
        ):
            assert key in content, f"{script}: {key} allowlist'te yok"
