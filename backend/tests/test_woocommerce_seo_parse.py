from types import SimpleNamespace

from app.services.woocommerce import (
    WooCommerceService,
    missing_required_seo_fields,
    _normalize_long_description_html,
    _parse_ai_description_seo_bundle,
    _sanitize_slug,
)


def test_parse_ai_description_seo_bundle_extracts_sections():
    text = """
SEO_TITLE:
Elegant palladium-smykke i 950 karat – 22,05 g

SHORT_DESCRIPTION:
Eksklusivt palladium-smykke i 950 karat med en vægt på 22,05 g.

LONG_DESCRIPTION_HTML:
```html
<p>Lang HTML beskrivelse</p>
<ul><li>Metal: palladium</li></ul>
```

META_DESCRIPTION:
Kort SEO meta beskrivelse.

URL_SLUG:
Palladium Smykke 22,05g Ref 9610
""".strip()

    parsed = _parse_ai_description_seo_bundle(text)

    assert parsed["seo_title"] == "Elegant palladium-smykke i 950 karat – 22,05 g"
    assert parsed["short_description"].startswith("Eksklusivt palladium-smykke")
    assert parsed["long_description_html"].startswith("<p>Lang HTML beskrivelse</p>")
    assert parsed["meta_description"] == "Kort SEO meta beskrivelse."
    assert parsed["url_slug"] == "palladium-smykke-22-05g-ref-9610"


def test_parse_ai_description_seo_bundle_returns_empty_for_plain_text():
    parsed = _parse_ai_description_seo_bundle("Dette er normal tekst uden SEO sektioner.")
    assert parsed == {}


def test_missing_required_seo_fields_reports_all_when_plain_text():
    missing = missing_required_seo_fields("Dette er normal tekst uden SEO sektioner.")
    assert missing == [
        "SEO Title",
        "Kısa Açıklama",
        "Uzun Açıklama (HTML)",
        "Meta Description",
        "URL Slug",
    ]


def test_sanitize_slug_handles_danish_chars():
    assert _sanitize_slug("Ægte Ørering Årgang 2026") == "aegte-oerering-aargang-2026"


def test_normalize_long_description_html_wraps_plain_text_into_paragraphs():
    raw = """
Dette er første afsnit.

Dette er andet afsnit.

<ul>
<li>Metal: guld</li>
</ul>
Se flere billeder i produktgalleriet.
""".strip()

    normalized = _normalize_long_description_html(raw)

    assert "<p>Dette er første afsnit.</p>" in normalized
    assert "<p>Dette er andet afsnit.</p>" in normalized
    assert "<ul>" in normalized
    assert "<li>Metal: guld</li>" in normalized
    assert "</ul>" in normalized
    assert "<p>Se flere billeder i produktgalleriet.</p>" in normalized


def test_default_slug_and_consistency_check():
    service = WooCommerceService()
    product = SimpleNamespace(
        product_type=SimpleNamespace(value="earring"),
        metal_type=SimpleNamespace(value="yellow_gold"),
        purity_karat="22K",
        weight_grams="29.83",
        reference_number="9605",
        product_number="0048",
    )
    slug = service._default_slug(product)
    assert "oereringe" in slug
    assert "ref-9605" in slug
    assert service._is_slug_consistent(slug, product)
    assert not service._is_slug_consistent("gult-guld-22k-oreinge", product)
