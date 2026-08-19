from __future__ import annotations

from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.utils.cpr import cpr_birth_part
from app.services.pos_receipt_renderer import _ensure_pdf_font_names


def render_customer_statement_pdf(*, customer: Any, rows: list[dict[str, str]], period: str) -> bytes:
    regular, bold = _ensure_pdf_font_names()
    buffer = BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=28, leftMargin=28, topMargin=28, bottomMargin=28)
    styles = getSampleStyleSheet()
    styles["Title"].fontName = bold
    styles["Normal"].fontName = regular
    story = [
        Paragraph("SERO GULD - Müşteri Hesap Özeti", styles["Title"]),
        Spacer(1, 10),
        Paragraph(f"Müşteri: {customer.name}", styles["Normal"]),
        # Veri minimizasyonu: PDF'ye tam CPR yazılmaz, yalnız doğum tarihi bölümü.
        Paragraph(f"CPR: {cpr_birth_part(customer.cpr_number) or '-'}", styles["Normal"]),
        Paragraph(f"Dönem: {period}", styles["Normal"]),
        Spacer(1, 14),
    ]
    data = [["Tarih", "Tür", "Referans", "Gram", "Tutar (DKK)"]]
    data.extend([[row["date"], row["side"], row["reference"], row["weight"], row["amount"]] for row in rows])
    if len(data) == 1:
        data.append(["-", "Kayıt yok", "-", "-", "-"])
    table = Table(data, repeatRows=1, colWidths=[78, 86, 120, 72, 100])
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), bold),
        ("FONTNAME", (0, 1), (-1, -1), regular),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F4E7C5")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D6C7A4")),
        ("ALIGN", (3, 1), (-1, -1), "RIGHT"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAF8")]),
    ]))
    story.append(table)
    document.build(story)
    return buffer.getvalue()
