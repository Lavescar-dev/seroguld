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

# Canlı seroguld.dk/guldpriser, 03.09.2026, page_id=6738 — TEK birleşik sayfa:
# altın karatları + barlar + gümüş + plet + platin/palladium aynı tabloda.
GULDPRISER_COMBINED_HTML = (
    '<table id="table-dagens-priser"><tbody>'
    '<tr class="table-header"><th>Dagens Priser</th><th>Finhed%</th><th>Gram pris</th></tr>'
    '<tr class="even-guld"><td>8 karat</td><td>333%</td><td>273.00 DKK</td></tr>'
    '<tr class="odd-guld"><td>14 karat</td><td>585%</td><td>480.00 DKK</td></tr>'
    '<tr class="even-guld"><td>18 karat</td><td>750%</td><td>617.00 DKK</td></tr>'
    '<tr class="odd-guld"><td>21 karat</td><td>875%</td><td>719.00 DKK</td></tr>'
    '<tr class="even-guld"><td>21,6 karat</td><td>900%</td><td>735.00 DKK</td></tr>'
    '<tr class="odd-guld"><td>22 karat</td><td>916%</td><td>750.00 DKK</td></tr>'
    '<tr class="even-guld"><td>24 karat</td><td>999%</td><td>867.00 DKK</td></tr>'
    '<tr class="odd-guld"><td>Guldbarre</td><td>999,9%</td><td>873.00 DKK</td></tr>'
    '<tr><td colspan="3">&nbsp;</td></tr>'
    '<tr class="odd-soelv"><td>Sølv – 3 tårnet</td><td>830%</td><td>9.50 DKK</td></tr>'
    '<tr class="even-soelv"><td>Sølv – sterling</td><td>925%</td><td>10.60 DKK</td></tr>'
    '<tr class="odd-soelv"><td>Sølv – finsølv</td><td>999%</td><td>12.80 DKK</td></tr>'
    '<tr class="even-soelv"><td>Sølvbarre</td><td>999,9%</td><td>13.10 DKK</td></tr>'
    '<tr class="odd-soelv"><td>Pletsølv</td><td></td><td>20 kr/kg</td></tr>'
    '<tr><td colspan="3">&nbsp;</td></tr>'
    '<tr class="odd-other"><td>Platin</td><td></td><td>290.00 DKK</td></tr>'
    '<tr class="even-other"><td>Palladium</td><td></td><td>220.00 DKK</td></tr>'
    '</tbody></table>'
)

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


# ---------------------------------------------------------------------------
# Birleşik canlı sayfa (6738): barlar + Platin + Palladium + Pletsølv
# ---------------------------------------------------------------------------

def test_parse_combined_table_extracts_bars_pt_pd_plet() -> None:
    """Canlı birleşik tablo: 5 skaler metal satırının TAMAMI çekilir.

    Eski parser bu satırları sessizce atıyordu; bar fiyatları 24K/999'dan
    uyduruluyordu, Pt/Pd Stooq default'unda kalıyordu.
    """
    parsed = parse_priser_content(GULDPRISER_COMBINED_HTML)
    assert parsed["gold_bar_dkk"] == "873.00"
    assert parsed["silver_bar_dkk"] == "13.10"
    assert parsed["platinum_dkk"] == "290.00"
    assert parsed["palladium_dkk"] == "220.00"
    assert parsed["plet_dkk"] == "0.0200"


def test_combined_table_still_parses_karat_and_silver() -> None:
    """Birleşik sayfada karat/gümüş ayrıştırması bozulmaz (regresyon)."""
    parsed = parse_priser_content(GULDPRISER_COMBINED_HTML)
    gold = parsed["gold_rates_dkk"]
    assert gold["8"] == "273.00"
    assert gold["21.6"] == "735.00"
    assert gold["24"] == "867.00"
    silver = parsed["silver_rates_dkk"]
    assert silver["830"] == "9.50"
    assert silver["925"] == "10.60"
    assert silver["999"] == "12.80"


def test_plet_per_kg_is_converted_to_per_gram() -> None:
    """'kr/kg' hücresi 1000'e bölünerek DKK/g yazılır — 1000× şişme yok."""
    variants = {
        '<table><tr><td>Pletsølv</td><td></td><td>20 kr/kg</td></tr></table>': "0.0200",
        '<table><tr><td>Pletsølv</td><td></td><td>21 kr/kg</td></tr></table>': "0.0210",
        '<table><tr><td>Pletsølv</td><td></td><td>20 kr./kg</td></tr></table>': "0.0200",
        '<table><tr><td>Pletsølv</td><td></td><td>20,00 kr/kg</td></tr></table>': "0.0200",
    }
    for html, expected in variants.items():
        parsed = parse_priser_content(html)
        assert parsed.get("plet_dkk") == expected, html


def test_per_kg_value_is_not_accepted_for_non_plet_row() -> None:
    """Per-kg hücre yalnız Pletsølv hedefine — Sølvbarre '20 kr/kg' yazarsa
    silver_bar_dkk 20 olarak (1000×) yazılamaz."""
    html = '<table><tr><td>Sølvbarre</td><td>999,9%</td><td>20 kr/kg</td></tr></table>'
    parsed = parse_priser_content(html)
    assert "silver_bar_dkk" not in parsed
    assert parsed["silver_rates_dkk"] == {}


def test_bar_and_metal_rows_outside_band_are_rejected() -> None:
    """Bant dışı bar/Pt/Pd değerleri sessizce atlanır (mevcut profil korunur)."""
    parsed = parse_priser_content(
        '<table>'
        '<tr><td>Platin</td><td></td><td>5.00 DKK</td></tr>'
        '<tr><td>Pletsølv</td><td></td><td>500 kr/kg</td></tr>'
        '</table>'
    )
    assert "platinum_dkk" not in parsed
    # 500 kr/kg = 0.5 DKK/g → plet bandı (0.001–0.10) dışı → RED.
    assert "plet_dkk" not in parsed


def test_platin_label_does_not_match_palladium_or_plet() -> None:
    """Etiket ayrımı: 'Platin' yalnız platinum_dkk doldurur."""
    parsed = parse_priser_content(
        '<table>'
        '<tr><td>Platin</td><td></td><td>290.00 DKK</td></tr>'
        '<tr><td>Palladium</td><td></td><td>220.00 DKK</td></tr>'
        '</table>'
    )
    assert parsed["platinum_dkk"] == "290.00"
    assert parsed["palladium_dkk"] == "220.00"
    assert "plet_dkk" not in parsed
    assert "gold_bar_dkk" not in parsed


def test_empty_finhed_cell_is_dropped() -> None:
    """Boş finhed hücresi satırı bozmaz — 2 hücreli satır fiyatı bulunur."""
    parsed = parse_priser_content(
        '<table><tr><td>Palladium</td><td></td><td>220.00 DKK</td></tr></table>'
    )
    assert parsed["palladium_dkk"] == "220.00"


# ---------------------------------------------------------------------------
# fetch_wp_priser_rates: JSON-olmayan WP yanıtı 502 sınıfına düşer (422 değil)
# ---------------------------------------------------------------------------


class _FakeResponse:
    def raise_for_status(self) -> None:
        return None

    def json(self):
        import json

        raise json.JSONDecodeError("Expecting value", "<html>Bakım modu</html>", 0)


class _FakeClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def get(self, *_args, **_kwargs):
        return _FakeResponse()


class _FakeAsyncClient:
    def __init__(self, *_args, **_kwargs) -> None:
        pass

    async def __aenter__(self):
        return _FakeClient()

    async def __aexit__(self, *_args):
        return False


@pytest.mark.asyncio
async def test_non_json_wp_response_maps_to_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    """WP HTML/bakım sayfası döndürünce json.JSONDecodeError ham haliyle 422'ye
    düşmemeli — WPPriserUnavailable (502 sınıfı) yükselir."""
    from app.config import Settings
    from app.services import wp_priser_service

    settings = Settings(
        _env_file=None,
        database_url="sqlite+aiosqlite:///test.db",
        wordpress_base_url="https://wp.example",
    )
    monkeypatch.setattr(wp_priser_service, "get_settings", lambda: settings)
    monkeypatch.setattr(wp_priser_service.httpx, "AsyncClient", _FakeAsyncClient)

    with pytest.raises(wp_priser_service.WPPriserUnavailable) as exc_info:
        await wp_priser_service.fetch_wp_priser_rates()

    # Mesaj temiz: ham parser metni ("Expecting value") taşımaz.
    assert "Expecting value" not in str(exc_info.value)
    assert not isinstance(exc_info.value, ValueError)
