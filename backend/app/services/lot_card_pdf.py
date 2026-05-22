"""AfgMeltLot kartı PDF üretimi — vergi muhasebesi için.

A4 portrait, başlık + KPI bloğu + giderler + payout + line listesi tablosu.
"""
from __future__ import annotations

from decimal import Decimal
from io import BytesIO
from typing import Iterable

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.schemas.afg import AfgMeltLotLineOut, AfgMeltLotOut

_BRAND_DARK = colors.HexColor("#0b3d24")
_BRAND_ACCENT = colors.HexColor("#1F6B3F")
_MUTED = colors.HexColor("#6b7280")
_LIGHT_BG = colors.HexColor("#f5f5f2")
_AMBER = colors.HexColor("#c5a96d")


def _format_money(value) -> str:
    if value is None or value == "":
        return "—"
    try:
        d = Decimal(str(value))
    except (ValueError, ArithmeticError):
        return str(value)
    return f"{d:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".") + " DKK"


def _format_gram(value) -> str:
    if value is None or value == "":
        return "—"
    try:
        d = Decimal(str(value))
    except (ValueError, ArithmeticError):
        return str(value)
    return f"{d:.3f} g"


def _format_date(value) -> str:
    if value is None:
        return "—"
    return str(value)[:10]


def build_lot_card_pdf(lot: AfgMeltLotOut, lines: Iterable[AfgMeltLotLineOut]) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=f"Eritme Lot {lot.id}",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "title",
        parent=styles["Title"],
        fontSize=18,
        textColor=_BRAND_DARK,
        spaceAfter=4,
    )
    subtitle_style = ParagraphStyle(
        "subtitle",
        parent=styles["Normal"],
        fontSize=10,
        textColor=_MUTED,
        spaceAfter=14,
    )
    section_style = ParagraphStyle(
        "section",
        parent=styles["Heading4"],
        fontSize=11,
        textColor=_BRAND_ACCENT,
        spaceBefore=10,
        spaceAfter=6,
    )
    body_style = styles["BodyText"]

    bucket_label = "GULD / Altın" if lot.metal_bucket == "gold" else "SØLV / Gümüş"
    status_label = "FINALIZE" if lot.status == "finalized" else "DRAFT"

    story = [
        Paragraph(f"Eritme Lot Kartı — {bucket_label}", title_style),
        Paragraph(
            f"Durum: <b>{status_label}</b> · Gönderim {_format_date(lot.sent_date)} · "
            f"Alış başlangıcı {_format_date(lot.purchased_from_date)}",
            subtitle_style,
        ),
    ]

    # KPI tablosu — 2x3
    kpi_data = [
        ["Önceki Brüt", _format_gram(lot.before_weight_grams), "Önceki Has", _format_gram(lot.before_pure_gold_grams)],
        ["Sonraki Has", _format_gram(lot.after_pure_gold_grams), "Maliyet (Alış)", _format_money(lot.before_amount_dkk)],
        ["Toplam Gider", _format_money(lot.cost_total_dkk), "Payout", _format_money(lot.payout_total_dkk)],
        ["Tahmini Satış", _format_money(lot.estimated_sale_value_dkk), "Net Sonuç (Avance)", _format_money(lot.net_after_costs_dkk)],
    ]
    kpi_tbl = Table(kpi_data, colWidths=[40 * mm, 40 * mm, 40 * mm, 40 * mm])
    kpi_tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), _LIGHT_BG),
                ("BACKGROUND", (0, 0), (0, -1), colors.white),
                ("BACKGROUND", (2, 0), (2, -1), colors.white),
                ("LINEBELOW", (0, 0), (-1, -1), 0.4, _MUTED),
                ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
                ("FONTNAME", (3, 0), (3, -1), "Helvetica-Bold"),
                ("TEXTCOLOR", (0, 0), (0, -1), _MUTED),
                ("TEXTCOLOR", (2, 0), (2, -1), _MUTED),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(kpi_tbl)

    # Giderler bloğu
    story.append(Paragraph("Giderler & Satış Detayı", section_style))
    cost_data = [
        ["Forsikring (Sigorta)", _format_money(lot.insurance_dkk)],
        ["Forsendelse (Kargo)", _format_money(lot.shipping_dkk)],
        ["Affinering (Rafinasyon)", _format_money(lot.refining_dkk)],
        ["Satış Tarihi", _format_date(lot.sale_date)],
        ["Quote (EUR/g)", str(lot.quote_eur or "—")],
        ["Kur (DKK/EUR)", str(lot.exchange_rate_dkk or "—")],
    ]
    cost_tbl = Table(cost_data, colWidths=[60 * mm, 40 * mm])
    cost_tbl.setStyle(
        TableStyle(
            [
                ("LINEBELOW", (0, 0), (-1, -1), 0.3, _MUTED),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TEXTCOLOR", (0, 0), (0, -1), _MUTED),
                ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ]
        )
    )
    story.append(cost_tbl)

    if lot.notes:
        story.append(Paragraph(f"<b>Not:</b> {lot.notes}", body_style))

    # Line listesi
    line_list = list(lines)
    if line_list:
        story.append(Paragraph(f"Bağlı AFG Satırları ({len(line_list)})", section_style))
        line_data = [["AFG", "Satır", "Gram", "Has", "DKK", "Ürün No", "Müşteri"]]
        for ln in line_list:
            line_data.append(
                [
                    str(ln.document_number or ln.document_sequence_no),
                    f"#{ln.line_no}",
                    _format_gram(ln.weight_grams),
                    _format_gram(ln.pure_gold_grams),
                    _format_money(ln.line_total_dkk),
                    ln.product_number or ln.reference_number or "—",
                    (ln.customer_name or "—")[:32],
                ]
            )
        line_tbl = Table(
            line_data,
            colWidths=[24 * mm, 16 * mm, 22 * mm, 22 * mm, 30 * mm, 22 * mm, 38 * mm],
        )
        line_tbl.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), _BRAND_DARK),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _LIGHT_BG]),
                    ("ALIGN", (2, 1), (4, -1), "RIGHT"),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.append(line_tbl)
    else:
        story.append(Spacer(1, 6))
        story.append(Paragraph("<i>Bu lot'a henüz bağlı transaction line yok.</i>", body_style))

    # Footer note
    story.append(Spacer(1, 16))
    story.append(
        Paragraph(
            "<font color='#888'>Sero Guld og Sølv ApS · CVR 34093083 · Bogføringsloven §10 — minimum 5 yıl saklama</font>",
            body_style,
        )
    )

    doc.build(story)
    pdf = buf.getvalue()
    buf.close()
    _ = _AMBER  # unused color, keep import stable
    return pdf
