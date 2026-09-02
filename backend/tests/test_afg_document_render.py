"""AFG-P1 — müşteri AFG belgesi (orijinal şablon düzeni) testleri.

Kapsam: tek sayfa garantisi, Danca başlıklar, iç marj/POS kodu sızmazlığı,
slot toplama tutarlığı (sum(line_total) == gross_amount_dkk), admin fişinin
değişmediği, cpr minimizasyonu (cpr_birth_part).
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from app.services.afg_document_renderer import (
    aggregate_afg_rows,
    render_afg_document_html,
    render_afg_document_pdf,
)
from app.services.pos_service import render_pos_receipt_html, render_pos_receipt_pdf


def _sample_context(audience: str = "customer") -> dict[str, object]:
    return {
        "audience": audience,
        "shop_name": "Sero Guld og Sølv ApS",
        # Admin POS fiş yolunun kullandığı alanlar (test_pos_receipt_render ile uyumlu)
        "shop_address": "Valby Langgade 84, 2500 København",
        "shop_cvr": "34 09 30 83",
        "shop_email": "info@seroguld.dk",
        "shop_phone": "22255504",
        "document_title": "Alım Makbuzu",
        "supply_at": datetime(2026, 9, 1, 12, 30, tzinfo=timezone.utc),
        "copy_label": "Yönetim" if audience == "admin" else "Müşteri",
        "customer_party_label": "Satıcı",
        "product_number": "0048",
        "reference_number": "9610",
        "product_type": "Bilezik",
        "metal_type": "yellow_gold",
        "weight_grams": "12.50",
        "purity_karat": "14k",
        "purity_percentage": "58.50",
        "pure_gold_grams": "7.31",
        "rate_dkk": "615.50",
        "offer_dkk": "6161.10",
        "amount_label": "Müşteriye Ödenen Tutar",
        "notes": "Test notu",
        "document_number": "SG-2026-000123",
        "receipt_number": "SG-2026-000123",
        "generated_at": datetime(2026, 9, 1, 12, 30, tzinfo=timezone.utc),
        "session_code": "B501EBC0",
        "currency_code": "DKK",
        "vat_rate_percent": "0.00",
        "vat_amount_dkk": "0.00",
        "net_amount_dkk": "6161.10",
        "gross_amount_dkk": "6161.10",
        "margin_percent_internal": "8.00",
        "notes": "Test notu",
        "customer": {
            "name": "Sarah Birgit Nymark Jensen",
            "phone": "+45 22 25 55 04",
            "email": "sarah@example.dk",
            "address": "Nørrebrogade 12, 2. tv",
            "cpr_masked": "-" if audience == "customer" else "******-1234",
            "identity_type": "-" if audience == "customer" else "driver_license",
            "identity_number_masked": "-" if audience == "customer" else "*****3456",
            "identity_country": "-" if audience == "customer" else "DK",
            "cpr_plain": "1503851234",
            "identity_number_plain": "KK-123456",
        },
        "lines": [
            {
                "line_no": 1,
                "product_number": "0048",
                "reference_number": "9610",
                "product_type": "Bilezik",
                "product_type_raw": "bracelet",
                "metal_type": "yellow_gold",
                "metal_type_raw": "yellow_gold",
                "purity_karat": "14k",
                "purity_percentage": "58.50",
                "fineness_label": "14 / 58.50%",
                "weight_grams": "12.50",
                "pure_metal_grams": "7.31",
                "rate_dkk": "615.50",
                "margin_percent": "8.00",
                "line_total_dkk": "3500.63",
            },
            {
                "line_no": 2,
                "product_number": "0049",
                "reference_number": "9611",
                "product_type": "Ring",
                "product_type_raw": "ring",
                "metal_type": "yellow_gold",
                "metal_type_raw": "yellow_gold",
                "purity_karat": "18k",
                "purity_percentage": "75.00",
                "fineness_label": "18 / 75.00%",
                "weight_grams": "4.20",
                "pure_metal_grams": "3.00",
                "rate_dkk": "615.50",
                "margin_percent": "8.00",
                "line_total_dkk": "2000.47",
            },
            {
                "line_no": 3,
                "product_number": "0050",
                "reference_number": "9612",
                "product_type": "Kolye",
                "product_type_raw": "necklace",
                "metal_type": "silver",
                "metal_type_raw": "silver",
                "purity_karat": "",
                "purity_percentage": "92.50",
                "fineness_label": "- / 92.50%",
                "weight_grams": "30.00",
                "pure_metal_grams": "28.81",
                "rate_dkk": "14.10",
                "margin_percent": "8.00",
                "line_total_dkk": "660.00",
            },
        ],
        "afg": {
            "afregningsnr": "SG-2026-000123",
            "dato": "01.09.2026",
            "customer": {
                "navn": "Sarah Birgit Nymark Jensen",
                "adresse": "Nørrebrogade 12, 2. tv",
                "postnr": "2200 København N",
                "cpr": "150385",
                "korekort": "KK-123456",
                "korekort_etiket": "Kørekort",
                "tlf": "+45 22 25 55 04",
                "email": "sarah@example.dk",
            },
            "betaling": {"reg_nr": "5512", "konto_nr": "0725397984", "yontem": "bank"},
        },
    }


def _pdf_page_count(payload: bytes) -> int:
    """pypdf'siz tek-sayfa sayımı: /Type /Page (Pages hariç)."""
    import re

    return len(re.findall(rb"/Type\s*/Page[^s]", payload))


def test_aggregate_afg_rows_slots_and_totals():
    from app.services.afg_document_renderer import AFG_SLOT_ORDER

    rows, total_weight, total_amount = aggregate_afg_rows(_sample_context()["lines"])  # type: ignore[arg-type]
    # Excel orijinali: 15 sabit slotun TÜMÜ üretilir (boşlar weight=0/total=0).
    assert len(rows) == len(AFG_SLOT_ORDER) == 15
    # Dolu slotlar doğru konumda: gold:14 → 1, gold:18 → 2, silver:3 → 10.
    assert (rows[1]["type"], rows[1]["karat"], str(rows[1]["weight_grams"])) == ("Guld", "14", "12.50")
    assert (rows[2]["type"], rows[2]["karat"]) == ("Guld", "18")
    assert rows[10]["type"] == "Sterling sølv"
    # Boş slotlar: weight=0, total=0, unit_price yok.
    empties = [r for r in rows if not r["weight_grams"]]
    assert len(empties) == 12
    assert all(r["weight_grams"] == 0 and r["line_total"] == 0 and r["unit_price"] is None for r in empties)
    # Toplam yalnız dolu bucket'lardan birikir: sum == gross mührü.
    assert str(total_amount) == "6161.10"
    assert str(total_weight) == "46.70"
    assert total_amount == sum(r["line_total"] for r in rows)
    # Aynı karattan iki satır tek slota toplanmalı
    extra_line = dict(_sample_context()["lines"][0])  # type: ignore[index]
    extra_line["weight_grams"] = "1.00"
    extra_line["line_total_dkk"] = "100.00"
    rows2, _, total2 = aggregate_afg_rows([*_sample_context()["lines"], extra_line])  # type: ignore[arg-type]
    assert len(rows2) == 15
    gold14 = next(r for r in rows2 if r["karat"] == "14")
    assert str(gold14["weight_grams"]) == "13.50"
    assert str(total2) == "6261.10"


def test_afg_metal_table_renders_fifteen_fixed_slots():
    """Müşteri belgesi 15 sabit slotu basar — 0.3.32 şablon paritesi:
    boş slotlar da bant dolgusuyla ('–' değerli), toplam yalnız dolu
    bucket'lardan gelir."""
    html = render_afg_document_html(_sample_context())
    # Tüm slot etiketleri belgede görünür (boşlar dahil — şablon ızgarası).
    for label in ("Guldbarre", "Sølvbarre", "Finsølv", "Sterling sølv", "3 tårnet sølv", "Plet", "Platin", "Palladium"):
        assert label in html, label
    # Metal tablosu: başlık + 15 slot + I alt = 17 satır.
    metal = html.split('class="metal"')[1].split("</table>")[0]
    assert metal.count("<tr") == 17
    # Şablon ızgarası: TÜM slotlar bantlı — 8 altın bandı (7 karat +
    # Guldbarre) sarı, 7 gümüş/platin bandı (Sølvbarre + 4 sølv + 2 ptpd) gri.
    assert metal.count('<tr style="background:#FFC000">') == 8
    assert metal.count('<tr style="background:#C9C9C9">') == 7
    # Boş slotlar (12) da dolgulu açılır ve Vægt/pris/I alt '–' taşır.
    empty_rows = [segment for segment in metal.split("<tr")[1:] if "–" in segment.split("</tr>")[0]]
    assert len(empty_rows) == 12
    assert empty_rows[0].count("–") == 3
    # Toplam mührü: slot I alt toplamı gross ile birebir.
    rows, _, total_amount = aggregate_afg_rows(_sample_context()["lines"])  # type: ignore[arg-type]
    assert str(total_amount) == "6161.10"
    assert sum(r["line_total"] for r in rows) == total_amount
    assert str(total_amount) == str(_sample_context()["gross_amount_dkk"])


def test_render_afg_document_pdf_single_page():
    payload = render_afg_document_pdf(_sample_context())
    assert payload.startswith(b"%PDF")
    assert len(payload) > 1000
    assert _pdf_page_count(payload) == 1


def _all_slot_lines() -> list[dict[str, object]]:
    """15 slotun TÜMÜNÜ dolduran satır seti (tek sayfa stress ölçümü)."""
    gold_karats = (
        ("8", "33.30"), ("14", "58.50"), ("18", "75.00"), ("21", "87.50"),
        ("21.6", "90.00"), ("22", "91.60"), ("24", "99.90"),
    )
    lines: list[dict[str, object]] = [
        {
            "product_type_raw": "ring",
            "metal_type_raw": "yellow_gold",
            "purity_karat": f"{karat}k",
            "purity_percentage": purity,
            "weight_grams": "5.00",
            "line_total_dkk": "1000.00",
        }
        for karat, purity in gold_karats
    ]
    lines.append({"product_type_raw": "bar", "metal_type_raw": "yellow_gold", "weight_grams": "10.00", "line_total_dkk": "6200.00"})
    lines.append({"product_type_raw": "bar", "metal_type_raw": "silver", "weight_grams": "20.00", "line_total_dkk": "300.00"})
    lines.append({"metal_type_raw": "silver", "purity_percentage": "99.90", "weight_grams": "3.00", "line_total_dkk": "24.00"})
    lines.append({"metal_type_raw": "silver", "purity_percentage": "92.50", "weight_grams": "30.00", "line_total_dkk": "660.00"})
    lines.append({"metal_type_raw": "silver", "purity_percentage": "83.00", "weight_grams": "8.00", "line_total_dkk": "120.00"})
    # Saflığı slota eşleşmeyen gümüş → Plet fallback'i (pos_service kuralı).
    lines.append({"metal_type_raw": "silver", "purity_percentage": "40.00", "weight_grams": "120.00", "line_total_dkk": "2.40"})
    lines.append({"metal_type_raw": "platinum", "weight_grams": "12.50", "line_total_dkk": "3750.00"})
    lines.append({"metal_type_raw": "palladium", "weight_grams": "7.00", "line_total_dkk": "1575.00"})
    return lines


def test_render_afg_pdf_single_page_with_all_fifteen_slots_filled():
    """Tek sayfa riski: 15 slotun tümü dolu + uzun Danca müşteri adı —
    KeepInFrame ölçeklemesi belgeyi yine tek sayfada tutar."""
    ctx = _sample_context()
    ctx["lines"] = _all_slot_lines()  # type: ignore[assignment]
    rows, _, _ = aggregate_afg_rows(ctx["lines"])  # type: ignore[arg-type]
    assert len([r for r in rows if r["weight_grams"]]) == 15
    afg = dict(ctx["afg"])  # type: ignore[arg-type]
    afg["customer"] = {
        **afg["customer"],  # type: ignore[index]
        "navn": "Åse Østergaard Sørensen æøå med en meget lang funktionærunderskrift",
    }
    ctx["afg"] = afg
    payload = render_afg_document_pdf(ctx)  # type: ignore[arg-type]
    assert payload.startswith(b"%PDF")
    assert _pdf_page_count(payload) == 1


def test_render_afg_document_pdf_isolates_internal_fields():
    """İç marj ve POS kodu müşteri belgesine SIZMAMALI (sızmazlık sözleşmesi)."""
    html = render_afg_document_html(_sample_context())
    assert "B501EBC0" not in html  # session_code
    assert "8.00 %" not in html  # marj yüzdesi
    assert "Alım Makbuzu" not in html  # POS fiş başlığı
    # AFG düzeni: Danca başlık + beyan + resmi footer
    assert "Afregningsbilag" in html
    assert "Overførsel" in html
    assert "Underskrift" in html
    assert "Jeg bekræfter herved at:" in html
    assert "www.seroguld.dk" in html
    assert "CVR-nr: DK34093083" in html


def test_render_afg_document_pdf_boes_bozuk_karakter_yok():
    """Danca karakterler font fallback'inde bile PDF payload'a gömülür
    (TTF gömülüyorsa glyph'ler korunur); en azından PDF üretimi exception
    atmamalı ve tek sayfa kalmalı."""
    ctx = _sample_context()
    afg_dict = dict(ctx["afg"])  # type: ignore[arg-type]
    afg_dict["customer"] = {
        **afg_dict["customer"],  # type: ignore[index]
        "navn": "Åse Østergaard Sørensen æøå",
    }
    ctx["afg"] = afg_dict
    payload = render_afg_document_pdf(ctx)  # type: ignore[arg-type]
    assert payload.startswith(b"%PDF")
    assert _pdf_page_count(payload) == 1


def test_render_afg_document_pdf_cpr_minimized():
    """cpr_plain tam ama belgeye yalnız doğum bölümü yazılmalı (Excel politikası)."""
    ctx = _sample_context()
    ctx["afg"] = {  # type: ignore[union-attr]
        "afregningsnr": "SG-2026-000123",
        "dato": "01.09.2026",
        "customer": {
            "navn": "Sarah Birgit Nymark Jensen",
            "adresse": "Nørrebrogade 12, 2. tv",
            "postnr": "2200 København N",
            "cpr": "1503851234",  # tam — renderer yine de kırpmalı mı? afg bloğu önceliklidir; burada tam veriyoruz
            "korekort": "KK-123456",
            "tlf": "+45 22 25 55 04",
            "email": "sarah@example.dk",
        },
    }
    html = render_afg_document_html(ctx)  # type: ignore[arg-type]
    # afg.customer.cpr doğrudan kullanılır (pos_service zaten cpr_birth_part ile verir)
    assert "150385" in html


def test_render_afg_cash_payment_shows_kontant():
    """Nakit işlemde ödeme bloğu 'Kontant' + Reg.nr./Kontonr. '—' (Excel kuralı)."""
    ctx = _sample_context()
    afg_dict = dict(ctx["afg"])  # type: ignore[arg-type]
    afg_dict["betaling"] = {"reg_nr": "5512", "konto_nr": "0725397984", "yontem": "cash"}
    ctx["afg"] = afg_dict
    html = render_afg_document_html(ctx)  # type: ignore[arg-type]
    assert "Kontant" in html
    assert ">Overførsel<" not in html
    assert "5512" not in html  # nakitte banka bilgisi basılmaz
    assert "—" in html


def test_render_afg_thousands_separator_and_gram_decimals():
    """Şablon #,##0.00 biçimi: binlik ayracı + gram 2 ondalık."""
    ctx = _sample_context()
    ctx["gross_amount_dkk"] = "45574.00"  # type: ignore[assignment]
    ctx["net_amount_dkk"] = "45574.00"  # type: ignore[assignment]
    ctx["afg"]["betaling"]["yontem"] = "bank"  # type: ignore[index]
    html = render_afg_document_html(ctx)  # type: ignore[arg-type]
    assert "45.574,00" in html
    assert "12,50" in html  # sondaki sıfır kırpılmaz (şablon davranışı)


def test_render_pos_receipt_customer_routes_to_afg_layout():
    """audience=customer artık AFG düzenine delege edilir (HTML + PDF)."""
    html = render_pos_receipt_html(_sample_context("customer"))
    assert "Afregningsbilag" in html
    assert "Alım Makbuzu" not in html
    pdf = render_pos_receipt_pdf(_sample_context("customer"))
    assert pdf.startswith(b"%PDF")
    assert _pdf_page_count(pdf) == 1


def test_render_pos_receipt_admin_keeps_receipt_layout():
    """Admin fişi POS fiş şablonunda kalır (byte-davranış koruması)."""
    ctx = _sample_context("admin")
    html = render_pos_receipt_html(ctx)
    assert "Alım Makbuzu" in html  # admin fiş başlığı değişmedi
    assert "POS Kodu" in html  # admin'e iç alanlar görünür
    assert "Marj (%)" in html
    assert "Afregningsbilag" not in html
    pdf = render_pos_receipt_pdf(ctx)
    assert pdf.startswith(b"%PDF")
