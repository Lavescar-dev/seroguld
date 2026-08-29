from __future__ import annotations

import pytest

from app.services.wp_priser_service import (
    parse_priser_content,
    _price_to_decimal,
)


# Canlı siteden alınmış gerçek rendered tablo biçimi (guldpriser, 29.08.2026).
GULDPRISER_HTML = """
<table><tbody>
<tr class="odd-guld"><td>8 karat</td><td>333%</td><td>280.00 DKK</td></tr>
<tr class="even-guld"><td>14 karat</td><td>585%</td><td>493.00 DKK</td></tr>
<tr><td>18 karat</td><td>750%</td><td>634.00 DKK</td></tr>
<tr><td>21 karat</td><td>875%</td><td>746.00 DKK</td></tr>
<tr><td>21,6 karat</td><td>900%</td><td>758.00 DKK</td></tr>
<tr><td>22 karat</td><td>916%</td><td>769.00 DKK</td></tr>
<tr><td>24 karat</td><td>999%</td><td>891.00 DKK</td></tr>
</tbody></table>
"""

# Canlı site (soelvpriser): "Sølv – " önekli etiketler, nokta ondalık.
SOELVPRISER_HTML = """
<table><tbody>
<tr><td>Sølv – 3 tårnet</td><td>830%</td><td>10.20 DKK</td></tr>
<tr><td>Sølv – sterling</td><td>925%</td><td>11.20 DKK</td></tr>
<tr><td>Sølv – finsølv</td><td>999%</td><td>13.20 DKK</td></tr>
</tbody></table>
"""


def test_parse_real_gold_table() -> None:
    """R2-06 — canlı Guldpriser tablosu: finyete % arada, nokta ondalık fiyat."""
    parsed = parse_priser_content(GULDPRISER_HTML)
    gold = parsed["gold_rates_dkk"]
    assert gold["8"] == "280.00"
    assert gold["14"] == "493.00"
    assert gold["18"] == "634.00"
    assert gold["21"] == "746.00"
    assert gold["21.6"] == "758.00"
    assert gold["22"] == "769.00"
    assert gold["24"] == "891.00"
    assert parsed["silver_rates_dkk"] == {}


def test_parse_real_silver_table() -> None:
    parsed = parse_priser_content(SOELVPRISER_HTML)
    silver = parsed["silver_rates_dkk"]
    assert silver["830"] == "10.20"
    assert silver["925"] == "11.20"
    assert silver["999"] == "13.20"


def test_parse_danish_thousands_and_comma() -> None:
    """Binlik nokta + ondalık virgül (1.234,56) çözümlenir."""
    parsed = parse_priser_content(
        '<table><tr><td>22 karat</td><td>916%</td><td>1.234,56 DKK</td></tr></table>'
    )
    assert parsed["gold_rates_dkk"]["22"] == "1234.56"


def test_purity_prose_without_dkk_is_rejected() -> None:
    """Saflık metni ("22 karat 9,16") fiyat sanılıp profile yazılamaz."""
    html = "<p>Guld AU: 22 karat 9,16 finhed — renere guld findes ikke.</p>"
    parsed = parse_priser_content(html)
    assert parsed["gold_rates_dkk"] == {}
    assert parsed["silver_rates_dkk"] == {}


def test_absurd_values_rejected_by_band() -> None:
    """Makullük bandı dışı değerler (ör. 3 DKK/g altın) reddedilir."""
    html = '<table><tr><td>24 karat</td><td>999%</td><td>3.00 DKK</td></tr>'
    assert parse_priser_content(html)["gold_rates_dkk"] == {}


def test_prose_fallback_with_dkk_suffix() -> None:
    """Tablosuz sayfa: etiket ve DKK'lı fiyat aynı metin parçasındaysa okunur."""
    html = "<p>8 karat guld pr. gram 280,00 DKK. Finsølv pr. gram 8,50 DKK.</p>"
    parsed = parse_priser_content(html)
    assert parsed["gold_rates_dkk"]["8"] == "280.00"
    assert parsed["silver_rates_dkk"]["999"] == "8.50"


def test_parse_priser_content_empty_returns_empty_maps() -> None:
    parsed = parse_priser_content("<p>Ingen priser her</p>")
    assert parsed["gold_rates_dkk"] == {}
    assert parsed["silver_rates_dkk"] == {}


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("280.00 DKK", "280.00"),
        ("1.234,56 DKK", "1234.56"),
        ("280,00 DKK", "280.00"),
        ("10.20 DKK", "10.20"),
        ("1.234 DKK", "1234"),
        ("1 234,56 DKK", "1234.56"),
    ],
)
def test_price_to_decimal(raw: str, expected: str) -> None:
    value = _price_to_decimal(raw)
    assert value is not None
    assert str(value) == expected


def test_price_to_decimal_requires_currency_suffix() -> None:
    assert _price_to_decimal("9,16 finhed") is None
    assert _price_to_decimal("") is None
