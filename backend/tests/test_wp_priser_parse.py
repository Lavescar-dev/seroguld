from __future__ import annotations

from app.services.wp_priser_service import parse_priser_content


def test_parse_priser_content_extracts_gold_and_silver() -> None:
    """R2-06 — WP 'Priser' sayfası rendered içeriğinden karat/gümüş fiyatları."""
    html = """
    <h2>Sølv og guldpriser</h2>
    <p>8 karat guld pr. gram 280,00</p>
    <p>14 karat guld pr. gram 490,00</p>
    <p>18 karat guld pr. gram 630,00</p>
    <p>21,6 karat guld pr. gram 755,50</p>
    <p>24 karat guld pr. gram 838,00</p>
    <p>Finsølv pr. gram 8,50</p>
    <p>Sterling sølv pr. gram 7,87</p>
    <p>3 tårnet sølv pr. gram 7,06</p>
    <p>Priser over 1.000,00 kr. — 22 karat guld pr. gram 1.234,56</p>
    """
    parsed = parse_priser_content(html)
    gold = parsed["gold_rates_dkk"]
    assert gold["8"] == "280.00"
    assert gold["14"] == "490.00"
    assert gold["21.6"] == "755.50"
    assert gold["22"] == "1234.56"  # binlik nokta + ondalık virgül çözülür
    silver = parsed["silver_rates_dkk"]
    assert silver["999"] == "8.50"
    assert silver["925"] == "7.87"
    assert silver["830"] == "7.06"


def test_parse_priser_content_empty_returns_empty_maps() -> None:
    parsed = parse_priser_content("<p>Ingen priser her</p>")
    assert parsed["gold_rates_dkk"] == {}
    assert parsed["silver_rates_dkk"] == {}
