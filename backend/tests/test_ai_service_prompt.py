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

    # JSON schema structured output: prompt alan adlarını + öneri alanlarını içerir.
    assert "seo_title" in prompt
    assert "short_description" in prompt
    assert "long_description_html" in prompt
    assert "meta_description" in prompt
    assert "url_slug" in prompt
    assert "suggested_producer" in prompt

    assert "ring" in prompt
    assert "hvidguld" in prompt
    assert "7.64 g" in prompt
    assert "24K" in prompt
    assert "99.90%" in prompt
    assert "9602" in prompt

    # response_format şeması strict JSON schema; SEO + öneri alanları zorunlu.
    fmt = service._response_format()
    assert fmt["type"] == "json_schema"
    assert fmt["json_schema"]["strict"] is True
    props = fmt["json_schema"]["schema"]["properties"]
    for key in ("seo_title", "short_description", "long_description_html", "meta_description", "url_slug", "suggested_producer", "suggested_stone", "suggested_subtype"):
        assert key in props


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
