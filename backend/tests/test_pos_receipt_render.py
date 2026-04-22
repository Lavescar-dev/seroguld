from __future__ import annotations

from datetime import datetime, timezone

from app.services.pos_service import render_pos_receipt_html, render_pos_receipt_pdf


def _sample_context(audience: str = "customer") -> dict[str, object]:
    return {
        "audience": audience,
        "copy_label": "Müşteri" if audience == "customer" else "Yönetim",
        "shop_name": "Sero Guld ApS",
        "shop_address": "Valby Langgade 84, 2500 København",
        "shop_cvr": "34 09 30 83",
        "shop_email": "kontakt@seroguld.dk",
        "shop_phone": "+45 30 40 50 60",
        "document_type": "purchase_receipt",
        "document_title": "Alım Makbuzu",
        "document_number": "SG-2026-000123",
        "receipt_number": "SG-2026-000123",
        "generated_at": datetime(2026, 2, 28, 12, 30, tzinfo=timezone.utc),
        "supply_at": datetime(2026, 2, 28, 12, 30, tzinfo=timezone.utc),
        "session_code": "B501EBC0",
        "trade_side": "buy_from_customer",
        "customer_party_label": "Satıcı",
        "product_number": "0048",
        "reference_number": "9610",
        "product_type": "bracelet",
        "metal_type": "palladium",
        "weight_grams": "22.05",
        "purity_karat": "950",
        "purity_percentage": "95.00",
        "pure_gold_grams": "20.95",
        "rate_dkk": "615.50",
        "margin_percent_internal": "8.00",
        "offer_dkk": "12146.09",
        "currency_code": "DKK",
        "vat_rate_percent": "0.00",
        "vat_amount_dkk": "0.00",
        "net_amount_dkk": "12146.09",
        "gross_amount_dkk": "12146.09",
        "amount_label": "Müşteriye Ödenen Tutar",
        "notes": "Test notu",
        "customer": {
            "name": "Mock Musteri",
            "phone": "+45 11 22 33 44",
            "email": "mock@example.com",
            "address": "-" if audience == "customer" else "Kobenhavn",
            "cpr_masked": "-" if audience == "customer" else "******-1234",
            "identity_type": "-" if audience == "customer" else "passport",
            "identity_number_masked": "-" if audience == "customer" else "*****1234",
            "identity_country": "-" if audience == "customer" else "DK",
        },
    }


def test_render_pos_receipt_html_customer_copy():
    html = render_pos_receipt_html(_sample_context("customer"))
    assert "<!DOCTYPE html>" in html
    assert "SG-2026-000123" in html
    assert "Alım Makbuzu" in html
    assert "Kopya: Müşteri" in html
    assert "Müşteriye Ödenen Tutar: 12146.09 DKK" in html


def test_render_pos_receipt_html_admin_copy():
    html = render_pos_receipt_html(_sample_context("admin"))
    assert "Kopya: Yönetim" in html
    assert "passport" in html
    assert "Kobenhavn" in html


def test_render_pos_receipt_html_renders_all_lines():
    ctx = _sample_context("admin")
    ctx["lines"] = [
        {
            "line_no": 1,
            "product_number": "0101",
            "reference_number": "9681",
            "product_type": "Bilezik",
            "metal_type": "Sarı Altın",
            "fineness_label": "22K / 91.60%",
            "weight_grams": "12.50",
            "pure_metal_grams": "11.45",
            "rate_dkk": "615.50",
            "margin_percent": "8.00",
            "line_total_dkk": "6500.00",
        },
        {
            "line_no": 2,
            "product_number": "0102",
            "reference_number": "9682",
            "product_type": "Yüzük",
            "metal_type": "Beyaz Altın",
            "fineness_label": "18K / 75.00%",
            "weight_grams": "8.00",
            "pure_metal_grams": "6.00",
            "rate_dkk": "615.50",
            "margin_percent": "8.00",
            "line_total_dkk": "5646.09",
        },
    ]

    html = render_pos_receipt_html(ctx)
    assert "0101" in html
    assert "0102" in html
    assert "Sarı Altın" in html
    assert "Beyaz Altın" in html
    assert "6500.00 DKK" in html
    assert "5646.09 DKK" in html


def test_render_pos_receipt_pdf_payload():
    payload = render_pos_receipt_pdf(_sample_context("customer"))
    assert payload.startswith(b"%PDF")
    assert len(payload) > 1000
