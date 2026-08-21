from decimal import Decimal
from types import SimpleNamespace

from app.services.ai_service import AIService


def test_build_prompt_contains_seo_sections_and_product_fields():
    service = AIService()
    fake_product = SimpleNamespace(
        product_type=SimpleNamespace(value="ring"),
        metal_type=SimpleNamespace(value="white_gold"),
        weight_grams=Decimal("7.64"),
        purity_karat="24K",
        purity_percentage=Decimal("99.90"),
        reference_number="9602",
        product_number="0048",
    )

    prompt = service._build_prompt(fake_product)

    assert "SEO_TITLE:" in prompt
    assert "SHORT_DESCRIPTION:" in prompt
    assert "LONG_DESCRIPTION_HTML:" in prompt
    assert "META_DESCRIPTION:" in prompt
    assert "URL_SLUG:" in prompt

    assert "ring" in prompt
    assert "hvidguld" in prompt
    assert "7.64 g" in prompt
    assert "24K" in prompt
    assert "99.90%" in prompt
    assert "9602" in prompt


def test_resolve_media_path_accepts_absolute_windows_and_posix_paths(tmp_path):
    """Windows'ta foto C:\\... mutlak yol saklanıyor; eskiden çözülemeyip
    foto sessizce atlanıyordu (AI görseli hiç görmüyordu)."""
    service = AIService()
    real = tmp_path / "urun_orig.jpg"
    real.write_bytes(b"jpeg-bytes")

    # tmp_path platforma göre mutlak (Windows'ta C:\..., POSIX'te /...).
    resolved = service._resolve_media_path_from_url(str(real))
    assert resolved is not None
    assert resolved.exists()

    # Var olmayan mutlak yol None döner (sessiz atlama yerine güvenli).
    assert service._resolve_media_path_from_url(str(tmp_path / "yok.jpg")) is None
    # Göreli/anlamsız değer None.
    assert service._resolve_media_path_from_url("olmayan-goreli") is None
