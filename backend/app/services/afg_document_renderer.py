"""AFG (Afregningsbilag) müşteri belgesi — orijinal Excel şablon düzeninde.

R2-16'yı tamamlayan AFG-P1: müşteri kopyası artık POS fiş şablonundan değil,
`referans/Afregningsbilag ( alis frontumuz).xlsm` şablonunun print alanıyla
(C4:H55) aynı düzeni taşıyan bağımsız bir renderer'dan üretilir. LibreOffice /
Office bağımlılığı YOKTUR — müşteri Windows kurulumunda saf reportlab çalışır.

Düzen (şablonla hizalı):
- Başlık "Afregningsbilag" + sağ blok Afregningsnr./Dato
- Marka bloğu (logo + "Sero Guld" + "Din professionelle forhandler")
- Müşteri bloğu: Navn/Adresse/Postnr. + CPR nr./Kørekort·pas/Tlf./E-mail
- Metal tablosu: sabit slot sırası (7 altın karat + Guldbarre + Sølvbarre +
  Finsølv/Sterling/3 tårnet/Plet + Platin/Palladium); yalnız dolu satırlar
  basılır (18705a9'daki Excel `_apply_afg_row_visibility` ile aynı davranış).
  Altın satırları şablon sarısı, gümüş satırları şablon grisi.
- Ödeme bloğu: Overførsel/Reg.nr./Kontonr. + Subtotal/Moms/I alt
- Underskrift + R2-09 üç maddelik beyan (`AFG_DECLARATION_*` tek kaynağı)
- Resmi footer (CVR/tel/e-posta) — invoice_seller_* ayarlarından

Tek sayfa garantisi iki katmanlı: satırlar 15 sabit slota toplanır ve tüm
story tek `KeepInFrame(mode="shrink")` içinde ölçeklenir. CPR yalnız doğum-
tarihi bölümüyle yazılır (`cpr_birth_part` — Excel yoluyla aynı minimizasyon).
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import (
    KeepInFrame,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.flowables import HRFlowable

from app.config import get_settings
from app.services.pos_value_helpers import AFG_DECLARATION_HEADER, AFG_DECLARATION_ITEMS
from app.utils.cpr import cpr_birth_part

# Şablondaki karat satırı sarısı (document_artifact_service.AFG_GOLD_FILL_ARGB
# ile aynı değer) ve gümüş bloğu grisi.
GOLD_FILL = colors.HexColor("#FFC000")
SILVER_FILL = colors.HexColor("#C9C9C9")
GRID_COLOR = colors.HexColor("#7A7A7A")

# Sabit AFG slot sırası — Excel şablonundaki satır düzeniyle (22-37) hizalı.
AFG_SLOT_ORDER: tuple[str, ...] = (
    "gold:8",
    "gold:14",
    "gold:18",
    "gold:21",
    "gold:21.6",
    "gold:22",
    "gold:24",
    "bar:gold",
    "bar:silver",
    "silver:2",
    "silver:3",
    "silver:4",
    "silver:5",
    "ptpd:platinum",
    "ptpd:palladium",
)

# slot → (Type etiketi, Karat/% Finhed hücresi, Lødighed hücresi, altın mı)
AFG_SLOT_LABELS: dict[str, tuple[str, str, str, bool]] = {
    "gold:8": ("Guld", "8", "333", True),
    "gold:14": ("Guld", "14", "585", True),
    "gold:18": ("Guld", "18", "750", True),
    "gold:21": ("Guld", "21", "875", True),
    "gold:21.6": ("Guld", "21,6", "900", True),
    "gold:22": ("Guld", "22", "916", True),
    "gold:24": ("Guld", "24", "999", True),
    "bar:gold": ("Guldbarre", "24", "999,9", True),
    "bar:silver": ("Sølvbarre", "", "999", False),
    "silver:2": ("Finsølv", "", "999", False),
    "silver:3": ("Sterling sølv", "", "925", False),
    "silver:4": ("3 tårnet sølv", "", "830", False),
    "silver:5": ("Plet", "", "", False),
    "ptpd:platinum": ("Platin", "", "950", False),
    "ptpd:palladium": ("Palladium", "", "500", False),
}

_GOLD_SLOT_BY_KARAT: tuple[tuple[str, Decimal], ...] = tuple(
    (slot_key, Decimal(slot_key.split(":")[1])) for slot_key in AFG_SLOT_ORDER if slot_key.startswith("gold:")
)
_SILVER_SLOT_BY_PURITY: tuple[tuple[str, Decimal], ...] = (
    ("silver:2", Decimal("99.90")),
    ("silver:3", Decimal("92.50")),
    ("silver:4", Decimal("83.00")),
)
_GOLD_SLOT_BY_PURITY: tuple[tuple[str, Decimal], ...] = (
    ("gold:8", Decimal("33.30")),
    ("gold:14", Decimal("58.50")),
    ("gold:18", Decimal("75.00")),
    ("gold:21", Decimal("87.50")),
    ("gold:21.6", Decimal("90.00")),
    ("gold:22", Decimal("91.60")),
    ("gold:24", Decimal("99.90")),
)


def _to_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError):
        return None


def _da_amount(value: Decimal | str | int | float | None, *, dash: str | None = None) -> str:
    """Danca biçim + binlik ayracı (#,##0.00 → 45.574,00) — şablon formatı.
    value None/"": dash (varsayılan boş)."""
    if value is None or value == "":
        return dash if dash is not None else ""
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError):
        return str(value)
    quantized = number.quantize(Decimal("0.01"))
    negative = quantized < 0
    whole, _, frac = f"{abs(quantized):f}".partition(".")
    groups: list[str] = []
    while len(whole) > 3:
        groups.insert(0, whole[-3:])
        whole = whole[:-3]
    groups.insert(0, whole)
    sign = "-" if negative else ""
    return f"{sign}{'.'.join(groups)},{frac or '00'}"


def _da_grams(value: Decimal | str | int | float | None) -> str:
    """Gram gösterimi — 2 ondalık sabit (şablon F kolonu #,##0.00); 0/boş "-"""
    number = _to_decimal(value)
    if number is None or number == 0:
        return "-"
    return _da_amount(number)


def _classify_line(line: dict[str, Any]) -> str:
    """Receipt satırını AFG slot anahtarına eşler.

    `product_type_raw`/`metal_type_raw` ham enum'lardır (pos_service ekler);
    eski context'lerde metal_type yine ham enum, product_type görüntü etiketi
    olabilir — her iki durum da desteklenir.
    """
    product_type_raw = str(line.get("product_type_raw") or line.get("product_type") or "").strip().lower()
    metal_type_raw = str(line.get("metal_type_raw") or line.get("metal_type") or "").strip().lower()

    if product_type_raw in {"bar", "barre"}:
        return "bar:gold" if metal_type_raw in {"yellow_gold", "white_gold", "gold"} else "bar:silver"
    if metal_type_raw == "platinum":
        return "ptpd:platinum"
    if metal_type_raw == "palladium":
        return "ptpd:palladium"

    purity = _to_decimal(line.get("purity_percentage"))
    karat_raw = str(line.get("purity_karat") or "").strip().lower().rstrip("k").strip()
    karat_number = _to_decimal(karat_raw)

    if metal_type_raw == "silver":
        if purity is not None:
            # Per-mille fallback: >100 olan değerler binlik yazımdır (999 → 99.90
            # Finsølv); pos_service._infer ile aynı Plet fallback'i.
            scaled = purity / Decimal("10") if purity > Decimal("100") else purity
            for slot_key, slot_purity in _SILVER_SLOT_BY_PURITY:
                if scaled == slot_purity:
                    return slot_key
        return "silver:5"  # Plet — saflıkla eşleşmez (şablon kuralı)

    # Altın (yellow_gold/white_gold/bilinmeyen): önce karat, sonra saflık.
    if karat_number is not None:
        for slot_key, slot_karat in _GOLD_SLOT_BY_KARAT:
            if karat_number == slot_karat:
                return slot_key
    if purity is not None:
        for slot_key, slot_purity in _GOLD_SLOT_BY_PURITY:
            if purity == slot_purity:
                return slot_key
    # Sınıflandırılamayan altın: kendi karat/saflık etiketini taşıyan jenerik slot.
    fallback = karat_raw or (str(purity) if purity is not None else "?")
    return f"gold:other:{fallback}"


def aggregate_afg_rows(
    lines: list[dict[str, Any]] | None,
) -> tuple[list[dict[str, Any]], Decimal, Decimal]:
    """Receipt satırlarını sabit AFG slotlarına paketler (Excel 22-37 modeli).

    Dönüş: (şablon sırasında dolu satırlar, toplam gram, toplam tutar).
    Toplamlar transaction toplamlarıyla birebir eşleşmeli
    (sum(line_total_dkk) == gross_amount_dkk) — testte mühürlenir.
    """
    buckets: dict[str, dict[str, Any]] = {}
    for line in lines or []:
        slot_key = _classify_line(line)
        weight = _to_decimal(line.get("weight_grams")) or Decimal("0")
        total = _to_decimal(line.get("line_total_dkk")) or Decimal("0")
        bucket = buckets.setdefault(slot_key, {"weight": Decimal("0"), "total": Decimal("0")})
        bucket["weight"] += weight
        bucket["total"] += total

    rows: list[dict[str, Any]] = []
    total_weight = Decimal("0")
    total_amount = Decimal("0")

    def _row_from_bucket(slot_key: str, bucket: dict[str, Any], *, label: str, karat: str, lodighed: str, is_gold: bool) -> dict[str, Any]:
        weight = bucket["weight"]
        total = bucket["total"]
        unit_price = (total / weight) if weight > 0 else None
        return {
            "type": label,
            "karat": karat,
            "lodighed": lodighed,
            "weight_grams": weight,
            "unit_price": unit_price,
            "line_total": total,
            "is_gold": is_gold,
        }

    for slot_key in AFG_SLOT_ORDER:
        bucket = buckets.pop(slot_key, None)
        if bucket is None:
            continue
        label, karat, lodighed, is_gold = AFG_SLOT_LABELS[slot_key]
        row = _row_from_bucket(slot_key, bucket, label=label, karat=karat, lodighed=lodighed, is_gold=is_gold)
        rows.append(row)
        total_weight += row["weight_grams"]
        total_amount += row["line_total"]

    # Sınıflandırılamayan jenerik altın satırları şablon sırasının sonuna eklenir.
    for slot_key in sorted(buckets):
        if not slot_key.startswith("gold:other:"):
            continue
        karat_raw = slot_key.split(":", 2)[-1].replace(".", ",")
        row = _row_from_bucket(slot_key, buckets[slot_key], label="Guld", karat=karat_raw, lodighed="", is_gold=True)
        rows.append(row)
        total_weight += row["weight_grams"]
        total_amount += row["line_total"]

    return rows, total_weight, total_amount


def _afg_view(context: dict[str, Any]) -> dict[str, Any]:
    """PDF ve HTML'in paylaştığı ortak görüntü modeli."""
    settings = get_settings()
    afg = context.get("afg") if isinstance(context.get("afg"), dict) else {}
    customer_ctx = context.get("customer") if isinstance(context.get("customer"), dict) else {}
    afg_customer = afg.get("customer") if isinstance(afg.get("customer"), dict) else {}

    lines = context.get("lines") if isinstance(context.get("lines"), list) else []
    rows, total_weight, total_amount = aggregate_afg_rows(lines)
    if isinstance(afg.get("rows"), list) and afg["rows"]:
        rows = afg["rows"]
        total_weight = sum((_to_decimal(r.get("weight_grams")) or Decimal("0") for r in rows), Decimal("0"))
        total_amount = sum((_to_decimal(r.get("line_total")) or Decimal("0") for r in rows), Decimal("0"))

    document_number = str(afg.get("afregningsnr") or context.get("document_number") or "-")
    generated_at = context.get("generated_at")
    dato = str(afg.get("dato") or "")
    if not dato:
        if hasattr(generated_at, "strftime"):
            dato = generated_at.strftime("%d.%m.%Y")
        else:
            dato = str(generated_at or "-")

    betaling = afg.get("betaling") if isinstance(afg.get("betaling"), dict) else {}
    # Ödeme yöntemi: nakitte Excel yoluyla aynı görüntü — 'Kontant' etiketi,
    # Reg.nr./Kontonr. '—' (document_artifact_afg.py C40/D41/D42 kuralı).
    payment_method = str(betaling.get("yontem") or "bank").strip().lower()
    is_cash = payment_method == "cash"
    payment_label = "Kontant" if is_cash else "Overførsel"
    reg_number = "" if is_cash else str(betaling.get("reg_nr") or settings.afg_bank_reg_number or "").strip()
    account_number = "" if is_cash else str(betaling.get("konto_nr") or settings.afg_bank_account_number or "").strip()
    reg_display = "—" if is_cash else reg_number
    konto_display = "—" if is_cash else account_number

    vat_rate = context.get("vat_rate_percent")

    customer = {
        "navn": str(afg_customer.get("navn") or customer_ctx.get("name") or "-"),
        "adresse": str(afg_customer.get("adresse") or customer_ctx.get("address") or "-"),
        "postnr": str(afg_customer.get("postnr") or "-"),
        "cpr": str(afg_customer.get("cpr") or cpr_birth_part(customer_ctx.get("cpr_plain")) or "-"),
        "korekort": str(afg_customer.get("korekort") or customer_ctx.get("identity_number_plain") or "-"),
        "korekort_etiket": str(afg_customer.get("korekort_etiket") or "Kørekort/pas"),
        "tlf": str(afg_customer.get("tlf") or customer_ctx.get("phone") or "-"),
        "email": str(afg_customer.get("email") or customer_ctx.get("email") or "-"),
    }

    footer_line1 = str(
        afg.get("footer_line1")
        or (
            # Şablon C53 footer'ı 'Sero Guld' kısa adıyla başlar.
            f"{settings.invoice_seller_name.split(' og')[0]} - {settings.invoice_seller_address_line1} - "
            f"{settings.invoice_seller_postal_code} {settings.invoice_seller_city} - "
            f"{settings.invoice_seller_country} - CVR-nr: {settings.invoice_seller_cvr}"
        )
    )
    footer_line2 = str(
        afg.get("footer_line2")
        or f"Tlf.: {settings.invoice_seller_phone} - E-mail: {settings.invoice_seller_email} - {settings.invoice_seller_website}"
    )

    return {
        "afregningsnr": document_number,
        "dato": dato,
        "customer": customer,
        "rows": rows,
        "total_weight": total_weight,
        "total_amount": total_amount,
        "subtotal": context.get("net_amount_dkk"),
        "moms": context.get("vat_amount_dkk"),
        "moms_rate": vat_rate if vat_rate is not None else "0",
        "ialt": context.get("gross_amount_dkk"),
        "overfoersel": context.get("gross_amount_dkk"),
        "payment_label": payment_label,
        "is_cash": is_cash,
        "reg_nr": reg_number,
        "konto_nr": account_number,
        "reg_display": reg_display,
        "konto_display": konto_display,
        "shop_name": context.get("shop_name") or settings.invoice_seller_name,
        "footer_line1": footer_line1,
        "footer_line2": footer_line2,
        "declaration_header": AFG_DECLARATION_HEADER,
        "declaration_items": AFG_DECLARATION_ITEMS,
        "logo_path": afg.get("logo_path"),
    }


def render_afg_document_pdf(context: dict[str, Any]) -> bytes:
    """Müşteri AFG PDF'i — orijinal şablon düzeninde, tek sayfa."""
    from app.services.pos_receipt_renderer import _ensure_pdf_font_names

    view = _afg_view(context)
    font_regular, font_bold = _ensure_pdf_font_names()
    payload_holder = BytesIO()
    document = SimpleDocTemplate(
        payload_holder,
        pagesize=A4,
        leftMargin=30,
        rightMargin=30,
        topMargin=26,
        bottomMargin=24,
        title="Afregningsbilag",
        author=view["shop_name"],
    )
    styles = getSampleStyleSheet()
    body = ParagraphStyle("afg-body", parent=styles["Normal"], fontName=font_regular, fontSize=9, leading=12)
    body_bold = ParagraphStyle("afg-bold", parent=body, fontName=font_bold)
    title_style = ParagraphStyle("afg-title", parent=styles["Title"], fontName=font_bold, fontSize=19, leading=23, spaceAfter=0)
    small = ParagraphStyle("afg-small", parent=body, fontSize=8, leading=11)

    story: list[Any] = []
    story.append(Paragraph("Afregningsbilag", title_style))
    story.append(Spacer(1, 4))
    story.append(
        Table(
            [
                ["Afregningsnr.", view["afregningsnr"]],
                ["Dato:", view["dato"]],
            ],
            colWidths=[70, 120],
            style=TableStyle(
                [
                    ("FONTNAME", (0, 0), (-1, -1), font_regular),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("ALIGN", (0, 0), (0, -1), "RIGHT"),
                    ("ALIGN", (1, 0), (1, -1), "LEFT"),
                ]
            ),
            hAlign="RIGHT",
        )
    )
    story.append(Spacer(1, 6))

    # Marka bloğu: logo varsa görsel, yoksa yazı markası (şablondaki C13/C14).
    logo_path = view.get("logo_path")
    if logo_path and Path(str(logo_path)).exists():
        from reportlab.platypus import Image as _Image

        brand_img = _Image(str(logo_path), width=64, height=64)
        brand_img.hAlign = "CENTER"
        story.append(brand_img)
        story.append(Spacer(1, 2))
    brand_text = f"<para align='center'><b>{view['shop_name'].replace(' og Sølv ApS', '')}</b></para>"
    story.append(Paragraph(brand_text, body_bold))
    story.append(
        Paragraph(
            "<para align='center'><i>Din professionelle forhandler</i></para>",
            body,
        )
    )
    story.append(Spacer(1, 10))

    customer = view["customer"]
    story.append(
        Table(
            [
                ["Navn:", Paragraph(str(customer["navn"]), body), "CPR nr.", Paragraph(str(customer["cpr"]), body)],
                ["Adresse:", Paragraph(str(customer["adresse"]), body), customer["korekort_etiket"], Paragraph(str(customer["korekort"]), body)],
                ["Postnr.:", Paragraph(str(customer["postnr"]), body), "Tlf.", Paragraph(str(customer["tlf"]), body)],
                ["", "", "E-mail", Paragraph(str(customer["email"]), body)],
            ],
            colWidths=[54, 230, 78, 144],
            style=TableStyle(
                [
                    ("FONTNAME", (0, 0), (-1, -1), font_regular),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 2),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                    ("TOPPADDING", (0, 0), (-1, -1), 1),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                ]
            ),
            hAlign="LEFT",
        )
    )
    story.append(Spacer(1, 8))
    story.append(_afg_metal_table(view, font_regular, font_bold))
    story.append(Spacer(1, 12))

    # Ödeme bloğu — şablon 40-43: sol Overførsel/Reg.nr./Kontonr., sağ Subtotal/Moms/I alt.
    story.append(
        Table(
            [
                [Paragraph(f"<b>{view['payment_label']}</b>", body_bold), _da_amount(view["overfoersel"]), "", "Subtotal", _da_amount(view["subtotal"])],
                [Paragraph("<b>Reg.nr.</b>", body_bold), Paragraph(str(view["reg_display"] or ""), body), "", "Moms", _da_amount(view["moms"])],
                [Paragraph("<b>Kontonr.:</b>", body_bold), Paragraph(str(view["konto_display"] or ""), body), "", Paragraph("<b>I alt</b>", body_bold), _da_amount(view["ialt"])],
            ],
            colWidths=[70, 150, 20, 70, 96],
            style=TableStyle(
                [
                    ("FONTNAME", (0, 0), (-1, -1), font_regular),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LINEBELOW", (3, 2), (4, 2), 0.8, GRID_COLOR),
                    ("LEFTPADDING", (0, 0), (-1, -1), 1),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                ]
            ),
            hAlign="LEFT",
        )
    )
    story.append(Spacer(1, 16))
    story.append(Paragraph("Underskrift: ______________________________", body))
    story.append(Spacer(1, 8))
    story.append(Paragraph(str(view["declaration_header"]), body))
    for item in view["declaration_items"]:
        story.append(Paragraph(item, small))
    story.append(Spacer(1, 14))
    story.append(HRFlowable(width="100%", thickness=1.4, color=colors.black))
    story.append(Spacer(1, 4))
    shop_bold_name = str(view["shop_name"]).split(" og")[0]
    rest_of_line1 = str(view["footer_line1"])[len(shop_bold_name):]
    story.append(Paragraph(f"<b>{shop_bold_name}</b>{rest_of_line1}", small))
    story.append(Paragraph(f"<para align='center'>{view['footer_line2']}</para>", small))

    frame_story = [
        KeepInFrame(
            mode="shrink",
            maxWidth=A4[0] - 60,  # left/right margin 30+30
            maxHeight=A4[1] - 50,  # top/bottom margin 26+24
            content=story,
        )
    ]
    document.build(frame_story)
    payload_holder.seek(0)
    return payload_holder.getvalue()


def _afg_metal_table(view: dict[str, Any], font_regular: str, font_bold: str) -> Table:
    header = ["Type", "Karat / % Finhed", "Lødighed", "Vægt i g", "Enhedspris / g", "I alt"]
    data: list[list[Any]] = [header]
    styles: list[tuple[Any, ...]] = [
        ("FONTNAME", (0, 0), (-1, -1), font_regular),
        ("FONTNAME", (0, 0), (-1, 0), font_bold),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8E8E8")),
        ("GRID", (0, 0), (-1, -1), 0.4, GRID_COLOR),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
    ]
    for row in view["rows"]:
        weight = _to_decimal(row.get("weight_grams"))
        total = _to_decimal(row.get("line_total"))
        if not total and not weight:
            continue  # boş slot — Excel `_apply_afg_row_visibility` kuralı
        data.append(
            [
                str(row.get("type", "")),
                str(row.get("karat", "")),
                str(row.get("lodighed", "")),
                _da_grams(weight),
                _da_amount(row.get("unit_price"), dash=""),
                _da_amount(total, dash=""),
            ]
        )
        fill = GOLD_FILL if row.get("is_gold") else SILVER_FILL
        styles.append(("BACKGROUND", (0, len(data) - 1), (-1, len(data) - 1), fill))

    data.append(
        [
            "I alt",
            "",
            "",
            _da_grams(view["total_weight"]) if view["total_weight"] else "",
            "",
            _da_amount(view["total_amount"], dash=""),
        ]
    )
    last = len(data) - 1
    styles.extend(
        [
            ("FONTNAME", (0, last), (-1, last), font_bold),
            ("SPAN", (0, last), (2, last)),
            ("LINEABOVE", (0, last), (-1, last), 0.9, GRID_COLOR),
        ]
    )
    table = Table(data, colWidths=[82, 66, 54, 62, 78, 64], hAlign="LEFT")
    table.setStyle(TableStyle(styles))
    return table


def render_afg_document_html(context: dict[str, Any]) -> str:
    """Müşteri AFG belgesinin HTML karşılığı (önizleme == e-posta eki düzeni)."""
    view = _afg_view(context)
    customer = view["customer"]
    rows_html: list[str] = []
    for row in view["rows"]:
        weight = _to_decimal(row.get("weight_grams"))
        total = _to_decimal(row.get("line_total"))
        if not total and not weight:
            continue
        fill = "#FFC000" if row.get("is_gold") else "#C9C9C9"
        rows_html.append(
            f"<tr style=\"background:{fill}\">"
            f"<td>{row.get('type', '')}</td>"
            f"<td>{row.get('karat', '')}</td>"
            f"<td>{row.get('lodighed', '')}</td>"
            f"<td>{_da_grams(weight)}</td>"
            f"<td>{_da_amount(row.get('unit_price'), dash='')}</td>"
            f"<td>{_da_amount(total, dash='')}</td>"
            "</tr>"
        )
    rows_html.append(
        "<tr class=\"total\">"
        "<td><b>I alt</b></td><td></td><td></td>"
        f"<td>{_da_grams(view['total_weight']) if view['total_weight'] else ''}</td><td></td>"
        f"<td><b>{_da_amount(view['total_amount'], dash='')}</b></td>"
        "</tr>"
    )
    declaration_items = "".join(f"<div>{item}</div>" for item in view["declaration_items"])
    return f"""<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8" />
  <title>Afregningsbilag {view['afregningsnr']}</title>
  <style>
    @page {{ size: A4; margin: 12mm; }}
    body {{ font-family: Arial, sans-serif; margin: 24px; color: #111; }}
    .wrap {{ max-width: 700px; margin: 0 auto; }}
    h1 {{ text-align: center; font-size: 22px; margin: 0 0 8px; }}
    .nr {{ text-align: right; font-size: 12px; line-height: 1.5; }}
    .brand {{ text-align: center; margin: 10px 0 4px; }}
    .brand .name {{ font-weight: 700; font-size: 16px; }}
    .brand .tag {{ font-style: italic; font-size: 12px; }}
    .customer {{ width: 100%; font-size: 12px; margin: 14px 0; }}
    .customer td {{ padding: 1px 4px; vertical-align: top; }}
    table.metal {{ width: 100%; border-collapse: collapse; font-size: 11px; }}
    table.metal th, table.metal td {{ border: 1px solid #7a7a7a; padding: 3px 5px; }}
    table.metal th {{ background: #e8e8e8; text-align: left; }}
    table.metal td:not(:first-child) {{ text-align: right; }}
    table.metal tr.total td {{ border-top: 2px solid #333; }}
    table.pay {{ width: 100%; margin-top: 14px; font-size: 12px; }}
    table.pay td {{ padding: 3px 4px; }}
    .und {{ margin-top: 22px; font-size: 12px; }}
    .decl {{ font-size: 11px; margin-top: 8px; line-height: 1.5; }}
    footer {{ border-top: 1.5px solid #000; margin-top: 18px; padding-top: 4px; font-size: 11px; }}
    @media print {{ body {{ margin: 0; }} }}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Afregningsbilag</h1>
    <div class="nr">Afregningsnr. <b>{view['afregningsnr']}</b><br />Dato: {view['dato']}</div>
    <div class="brand">
      <div class="name">{view['shop_name'].split(' og')[0]}</div>
      <div class="tag">Din professionelle forhandler</div>
    </div>
    <table class="customer">
      <tr><td>Navn:</td><td>{customer['navn']}</td><td>CPR nr.</td><td>{customer['cpr']}</td></tr>
      <tr><td>Adresse:</td><td>{customer['adresse']}</td><td>{customer['korekort_etiket']}</td><td>{customer['korekort']}</td></tr>
      <tr><td>Postnr.:</td><td>{customer['postnr']}</td><td>Tlf.</td><td>{customer['tlf']}</td></tr>
      <tr><td></td><td></td><td>E-mail</td><td>{customer['email']}</td></tr>
    </table>
    <table class="metal">
      <tr><th>Type</th><th>Karat / % Finhed</th><th>Lødighed</th><th>Vægt i g</th><th>Enhedspris / g</th><th>I alt</th></tr>
      {''.join(rows_html)}
    </table>
    <table class="pay">
      <tr><td><b>{view['payment_label']}</b></td><td>{_da_amount(view['overfoersel'])}</td><td></td><td>Subtotal</td><td>{_da_amount(view['subtotal'])}</td></tr>
      <tr><td><b>Reg.nr.</b></td><td>{view['reg_display']}</td><td></td><td>Moms</td><td>{_da_amount(view['moms'])}</td></tr>
      <tr><td><b>Kontonr.:</b></td><td>{view['konto_display']}</td><td></td><td><b>I alt</b></td><td><b>{_da_amount(view['ialt'])}</b></td></tr>
    </table>
    <div class="und">Underskrift: ______________________________</div>
    <div class="decl">
      <div>{view['declaration_header']}</div>
      {declaration_items}
    </div>
    <footer><b>{str(view['footer_line1']).split(' - ')[0]}</b> - {' - '.join(str(view['footer_line1']).split(' - ')[1:])}<br />{view['footer_line2']}</footer>
  </div>
</body>
</html>"""
