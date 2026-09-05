from __future__ import annotations

from datetime import datetime
from html import escape as _html_escape
from io import BytesIO
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from app.services.pos_value_helpers import display_metal_type_da

_PDF_FONT_READY: tuple[str, str] | None = None


def _ensure_pdf_font_names() -> tuple[str, str]:
    global _PDF_FONT_READY
    if _PDF_FONT_READY is not None:
        return _PDF_FONT_READY

    regular_name = "DejaVuSans"
    bold_name = "DejaVuSans-Bold"
    registered = set(pdfmetrics.getRegisteredFontNames())
    if regular_name in registered and bold_name in registered:
        _PDF_FONT_READY = (regular_name, bold_name)
        return _PDF_FONT_READY

    regular_candidates = [
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/dejavu/DejaVuSans.ttf"),
        # Windows müşteri kurulumu — DejaVu yoksa Arial ø/æ/å içeren bir yedektir.
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/segoeui.ttf"),
    ]
    bold_candidates = [
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf"),
    ]

    regular_path = next((path for path in regular_candidates if path.exists()), None)
    bold_path = next((path for path in bold_candidates if path.exists()), None)
    if regular_path and bold_path:
        try:
            if regular_name not in registered:
                pdfmetrics.registerFont(TTFont(regular_name, str(regular_path)))
            if bold_name not in registered:
                pdfmetrics.registerFont(TTFont(bold_name, str(bold_path)))
            _PDF_FONT_READY = (regular_name, bold_name)
            return _PDF_FONT_READY
        except Exception:
            pass

    _PDF_FONT_READY = ("Helvetica", "Helvetica-Bold")
    return _PDF_FONT_READY


def _format_datetime(value: Any) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    return str(value or "-")


def _esc(value: Any) -> str:
    """HTML/XML metin kaçışı — kullanıcı kaynaklı TÜM değerler için zorunlu.

    Stored XSS fix: müşteri ad/adres/telefon/e-posta/korekort, notlar ve
    marka/şube alanları serbest metindir; kaçışsız f-string gömümü stored
    XSS'e açıktır (ör. '<img src=x onerror=...>' müşteri adı). Aynı kaçış
    reportlab Paragraph mini-XML parser'ı için de geçerlidir ('<' içeren
    ad parser'ı düşürür) — quote=True reportlab 4.x'te güvenli.

    DİKKAT: yalnız Paragraph(...) İÇİNE ve HTML f-string'lerine uygulayın;
    reportlab Table düz string hücreleri entity parse ETMEZ — orada kaçış
    çıktıyı bozar ('&amp;' diye basar). afg_document_renderer._esc ikizidir.
    """
    return _html_escape(str(value), quote=True)


def render_pos_receipt_html(context: dict[str, Any]) -> str:
    # AFG-P1: müşteri kopyası orijinal şablon düzeninde (Afregningsbilag)
    # basılır; admin fişi değişmez. Önizleme == e-posta eki düzeni.
    if context.get("audience") == "customer":
        from app.services.afg_document_renderer import render_afg_document_html

        return render_afg_document_html(context)
    generated_at_str = _format_datetime(context.get("generated_at"))
    supply_at_str = _format_datetime(context.get("supply_at"))
    customer = context["customer"]
    raw_lines = context.get("lines") if isinstance(context.get("lines"), list) else []
    lines = raw_lines or [
        {
            "line_no": 1,
            "product_number": context.get("product_number", "-"),
            "reference_number": context.get("reference_number", "-"),
            "product_type": context.get("product_type", "-"),
            "metal_type": context.get("metal_type", "-"),
            "weight_grams": context.get("weight_grams", "-"),
            "purity_karat": context.get("purity_karat", "-"),
            "purity_percentage": context.get("purity_percentage", "-"),
            "fineness_label": f"{context.get('purity_karat', '-')} / {context.get('purity_percentage', '-')}%",
            "pure_metal_grams": context.get("pure_gold_grams", "-"),
            "rate_dkk": context.get("rate_dkk", "-"),
            "margin_percent": context.get("margin_percent_internal", "-"),
            "line_total_dkk": context.get("gross_amount_dkk", "-"),
        }
    ]
    line_rows = "".join(
        (
            "<tr>"
            f"<td>{_esc(line.get('line_no', '-'))}</td>"
            f"<td>{_esc(line.get('product_number', '-'))}</td>"
            f"<td>{_esc(line.get('reference_number', '-'))}</td>"
            f"<td>{_esc(line.get('product_type', '-'))}</td>"
            f"<td>{_esc(display_metal_type_da(line.get('metal_type')))}</td>"
            f"<td>{_esc(line.get('fineness_label', '-'))}</td>"
            f"<td>{_esc(line.get('weight_grams', '-'))} g</td>"
            f"<td>{_esc(line.get('pure_metal_grams', '-'))} g</td>"
            f"<td>{_esc(line.get('rate_dkk', '-'))}</td>"
            f"<td>{_esc(line.get('margin_percent', '-'))}%</td>"
            f"<td>{_esc(line.get('line_total_dkk', '-'))} {_esc(context['currency_code'])}</td>"
            "</tr>"
        )
        for line in lines
    )
    return f"""<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{_esc(context['receipt_number'])}</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; color: #1a1a1a; }}
    .wrap {{ max-width: 860px; margin: 0 auto; border: 1px solid #ddd; border-radius: 12px; padding: 20px; }}
    .top {{ display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #8e7556; padding-bottom: 12px; }}
    h1 {{ margin: 0; font-size: 24px; }}
    .muted {{ color: #666; font-size: 12px; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 14px; }}
    th, td {{ border: 1px solid #ddd; padding: 8px; font-size: 13px; text-align: left; }}
    th {{ background: #f4eee3; }}
    .line-table th, .line-table td {{ font-size: 11px; padding: 6px; }}
    .line-table td {{ white-space: nowrap; }}
    .total {{ margin-top: 14px; padding: 12px; background: #f4eee3; border-radius: 8px; font-size: 18px; font-weight: 700; }}
    .note {{ margin-top: 12px; font-size: 12px; color: #555; }}
    @media print {{
      body {{ margin: 0; }}
      .wrap {{ border: none; border-radius: 0; padding: 8px; max-width: 100%; }}
      .line-table th, .line-table td {{ font-size: 10px; padding: 4px; }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div>
        <h1>{_esc(context['shop_name'])}</h1>
        <div class="muted">{_esc(context['shop_address'])}</div>
        <div class="muted">CVR: {_esc(context['shop_cvr'])}</div>
        <div class="muted">Tel: {_esc(context['shop_phone'])} · E-posta: {_esc(context['shop_email'])}</div>
      </div>
      <div style="text-align:right;">
        <h1>{_esc(context['document_title'])}</h1>
        <div class="muted">No: {_esc(context['document_number'])}</div>
        <div class="muted">Düzenleme: {_esc(generated_at_str)}</div>
        <div class="muted">Teslim/İşlem: {_esc(supply_at_str)}</div>
        <div class="muted">Kopya: {_esc(context['copy_label'])}</div>
      </div>
    </div>

    <table class="line-table">
      <tr><th>{_esc(context['customer_party_label'])}</th><td>{_esc(customer['name'])}</td><th>Telefon</th><td>{_esc(customer['phone'])}</td></tr>
      <tr><th>E-posta</th><td>{_esc(customer['email'])}</td><th>CPR</th><td>{_esc(customer['cpr_masked'])}</td></tr>
      <tr><th>Kimlik Tipi</th><td>{_esc(customer['identity_type'])}</td><th>Kimlik No</th><td>{_esc(customer['identity_number_masked'])}</td></tr>
      <tr><th>Kimlik Ülkesi</th><td>{_esc(customer['identity_country'])}</td><th>Adres</th><td>{_esc(customer['address'])}</td></tr>
    </table>

    <table>
      <thead>
        <tr>
          <th>Kalem</th><th>Ürün No</th><th>Referans</th><th>Tip</th><th>Metal</th><th>Ayar / Finelik</th><th>Gram</th><th>Has Gram</th><th>Kur (DKK/g)</th><th>Avance %</th><th>Satır Tutarı</th>
        </tr>
      </thead>
      <tbody>
        {line_rows}
      </tbody>
    </table>

    <table>
      <tr><th>Kur (DKK/g)</th><td>{_esc(context['rate_dkk'])}</td><th>Marj (%)</th><td>{_esc(context['margin_percent_internal'])}</td></tr>
      <tr><th>Ara Toplam</th><td>{_esc(context['net_amount_dkk'])} {_esc(context['currency_code'])}</td><th>KDV Oranı</th><td>{_esc(context['vat_rate_percent'])}%</td></tr>
      <tr><th>KDV Tutarı</th><td>{_esc(context['vat_amount_dkk'])} {_esc(context['currency_code'])}</td><th>POS Kodu</th><td>{_esc(context['session_code'])}</td></tr>
      <tr><th>Saf Gram</th><td>{_esc(context['pure_gold_grams'])}</td><th>Kalem Sayısı</th><td>{_esc(context.get('line_count', len(lines)))}</td></tr>
    </table>

    <div class="total">{_esc(context.get('amount_label', 'Toplam Tutar'))}: {_esc(context['gross_amount_dkk'])} {_esc(context['currency_code'])}</div>
    <div class="note">Not: {_esc(context['notes'])}</div>
  </div>
</body>
</html>"""


def render_pos_receipt_pdf(context: dict[str, Any]) -> bytes:
    # AFG-P1: müşteri kopyası orijinal şablon düzeninde (Afregningsbilag)
    # üretilir; admin fişi mevcut POS fiş şablonunda kalır.
    if context.get("audience") == "customer":
        from app.services.afg_document_renderer import render_afg_document_pdf

        return render_afg_document_pdf(context)
    payload = BytesIO()
    font_regular, font_bold = _ensure_pdf_font_names()
    document = SimpleDocTemplate(
        payload,
        pagesize=A4,
        leftMargin=24,
        rightMargin=24,
        topMargin=24,
        bottomMargin=24,
    )
    styles = getSampleStyleSheet()
    styles["Normal"].fontName = font_regular
    styles["Title"].fontName = font_bold
    styles["Heading3"].fontName = font_bold
    customer = context["customer"]
    raw_lines = context.get("lines") if isinstance(context.get("lines"), list) else []
    lines = raw_lines or [
        {
            "line_no": 1,
            "product_number": context.get("product_number", "-"),
            "reference_number": context.get("reference_number", "-"),
            "product_type": context.get("product_type", "-"),
            "metal_type": context.get("metal_type", "-"),
            "weight_grams": context.get("weight_grams", "-"),
            "purity_karat": context.get("purity_karat", "-"),
            "purity_percentage": context.get("purity_percentage", "-"),
            "fineness_label": f"{context.get('purity_karat', '-')} / {context.get('purity_percentage', '-')}%",
            "pure_metal_grams": context.get("pure_gold_grams", "-"),
            "rate_dkk": context.get("rate_dkk", "-"),
            "margin_percent": context.get("margin_percent_internal", "-"),
            "line_total_dkk": context.get("gross_amount_dkk", "-"),
        }
    ]

    generated_at_str = _format_datetime(context.get("generated_at"))
    supply_at_str = _format_datetime(context.get("supply_at"))

    elements: list[Any] = []
    elements.append(Paragraph(f"<b>{_esc(context['shop_name'])}</b>", styles["Title"]))
    elements.append(
        Paragraph(
            f"{_esc(context['shop_address'])} · CVR: {_esc(context['shop_cvr'])} · Tel: {_esc(context['shop_phone'])} · E-posta: {_esc(context['shop_email'])}",
            styles["Normal"],
        )
    )
    elements.append(Spacer(1, 8))
    elements.append(Paragraph(f"<b>{_esc(context['document_title'])}:</b> {_esc(context['document_number'])}", styles["Normal"]))
    elements.append(Paragraph(f"<b>Düzenleme:</b> {_esc(generated_at_str)}", styles["Normal"]))
    elements.append(Paragraph(f"<b>Teslim/İşlem:</b> {_esc(supply_at_str)}", styles["Normal"]))
    elements.append(
        Paragraph(
            f"<b>Kopya:</b> {_esc(context['copy_label'])}",
            styles["Normal"],
        )
    )
    elements.append(Spacer(1, 10))

    customer_table = Table(
        [
            [context["customer_party_label"], customer["name"], "Telefon", customer["phone"]],
            ["E-posta", customer["email"], "CPR", customer["cpr_masked"]],
            ["Kimlik Tipi", customer["identity_type"], "Kimlik No", customer["identity_number_masked"]],
            ["Kimlik Ülkesi", customer["identity_country"], "Adres", customer["address"]],
        ],
        colWidths=[95, 155, 95, 155],
    )
    customer_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#c9c1b3")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1ede6")),
                ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f1ede6")),
                ("FONTNAME", (0, 0), (-1, -1), font_regular),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    elements.append(customer_table)
    elements.append(Spacer(1, 10))

    product_rows: list[list[Any]] = [
        ["Kalem", "Ürün No", "Ref", "Tip", "Metal", "Ayar/Finelik", "Gram", "Has G", "Kur", "Av%", "Tutar"],
    ]
    for line in lines:
        product_rows.append(
            [
                line.get("line_no", "-"),
                line.get("product_number", "-"),
                line.get("reference_number", "-"),
                line.get("product_type", "-"),
                display_metal_type_da(line.get("metal_type")),
                line.get("fineness_label", "-"),
                f"{line.get('weight_grams', '-')} g",
                f"{line.get('pure_metal_grams', '-')} g",
                line.get("rate_dkk", "-"),
                f"{line.get('margin_percent', '-')}%",
                f"{line.get('line_total_dkk', '-')} {context['currency_code']}",
            ]
        )

    product_table = Table(
        product_rows,
        colWidths=[20, 38, 38, 44, 42, 56, 40, 40, 38, 30, 56],
        repeatRows=1,
    )
    product_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#6F5B45")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#c9c1b3")),
                ("FONTNAME", (0, 0), (-1, 0), font_bold),
                ("FONTNAME", (0, 1), (-1, -1), font_regular),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("FONTSIZE", (0, 0), (-1, 0), 8),
                ("FONTSIZE", (0, 1), (-1, -1), 7),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    elements.append(product_table)
    elements.append(Spacer(1, 10))

    calc_table = Table(
        [
            ["Kur (DKK/g)", context["rate_dkk"], "Marj (%)", context["margin_percent_internal"]],
            [
                "Ara Toplam",
                f"{context['net_amount_dkk']} {context['currency_code']}",
                "KDV Oranı",
                f"{context['vat_rate_percent']}%",
            ],
            [
                "KDV Tutarı",
                f"{context['vat_amount_dkk']} {context['currency_code']}",
                "POS Kodu",
                context["session_code"],
            ],
            ["Saf Gram", context["pure_gold_grams"], "Kalem Sayısı", str(context.get("line_count", len(lines)))],
        ],
        colWidths=[95, 120, 95, 120],
    )
    calc_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#c9c1b3")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1ede6")),
                ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f1ede6")),
                ("FONTNAME", (0, 0), (-1, -1), font_regular),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    elements.append(calc_table)
    elements.append(Spacer(1, 10))
    elements.append(
        Paragraph(
            f"<b>{_esc(context.get('amount_label', 'Toplam Tutar'))}:</b> {_esc(context['gross_amount_dkk'])} {_esc(context['currency_code'])}",
            styles["Heading3"],
        )
    )
    elements.append(Paragraph(f"Not: {_esc(context['notes'])}", styles["Normal"]))

    document.build(elements)
    payload.seek(0)
    return payload.getvalue()
