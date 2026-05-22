"""ESC/POS thermal printer için ürün etiketi (62mm kese kâğıt etiket).

Kullanım:
    payload = build_thermal_product_label(product)
    # Frontend bu bytes'ı blob olarak indirir, Tauri host print queue'ya yollar.

Etiket içeriği:
- Üst: marka adı (SERO GULD)
- Stok no (büyük, mono)
- Ürün adı (truncate edilmiş)
- Saflık / Karat
- Ağırlık (g)
- Alış fiyatı (gizli, isteğe bağlı)
- Code128 barcode (product_number)
"""
from __future__ import annotations

from decimal import Decimal

from app.models.product import Product

# 62mm rulo etiket için ~32 char/line, Font A
LABEL_LINE_WIDTH = 32

ESC = b"\x1b"
GS = b"\x1d"
INIT = ESC + b"@"
LINE = b"\n"
CUT = GS + b"V\x00"
ALIGN_LEFT = ESC + b"a\x00"
ALIGN_CENTER = ESC + b"a\x01"
BOLD_ON = ESC + b"E\x01"
BOLD_OFF = ESC + b"E\x00"
SIZE_DOUBLE = GS + b"!\x11"
SIZE_NORMAL = GS + b"!\x00"
FEED_2 = b"\n\n"

# Barcode komutları (Code128)
def _barcode_code128(data: str) -> bytes:
    """GS k m d1...dk NUL — Code128 fonksiyonu A (66)."""
    payload = data.encode("ascii", errors="ignore")
    # Code128 set B prefix
    prefix = b"{B"
    body = prefix + payload
    return (
        GS + b"h\x50"           # HRI char height = 80
        + GS + b"w\x02"          # width modüler 2
        + GS + b"H\x02"          # HRI position = below
        + GS + b"k\x49" + bytes([len(body)]) + body
    )


def _truncate(text: str, width: int) -> str:
    if not text:
        return ""
    return text if len(text) <= width else text[: width - 1] + "."


def _encode(text: str) -> bytes:
    return text.encode("cp865", errors="replace")


def build_thermal_product_label(product: Product) -> bytes:
    parts: list[bytes] = []
    parts.append(INIT)

    # Başlık
    parts.append(ALIGN_CENTER)
    parts.append(BOLD_ON)
    parts.append(_encode("SERO GULD") + LINE)
    parts.append(BOLD_OFF)

    # Stok no büyük
    parts.append(SIZE_DOUBLE)
    parts.append(BOLD_ON)
    ref = (product.reference_number or product.product_number or "—")
    parts.append(_encode(ref) + LINE)
    parts.append(BOLD_OFF)
    parts.append(SIZE_NORMAL)

    parts.append(ALIGN_LEFT)

    # Ürün adı
    name = product.display_name or product.product_type.value if product.display_name or product.product_type else "—"
    parts.append(_encode(_truncate(str(name), LABEL_LINE_WIDTH)) + LINE)

    # Saflık / karat
    if product.purity_karat or product.purity_percentage is not None:
        purity_bits: list[str] = []
        if product.purity_karat:
            purity_bits.append(str(product.purity_karat))
        if product.purity_percentage is not None:
            purity_bits.append(f"{Decimal(product.purity_percentage):.1f}%")
        parts.append(_encode(" / ".join(purity_bits)) + LINE)

    # Ağırlık
    if product.weight_grams is not None:
        parts.append(_encode(f"Vægt: {Decimal(product.weight_grams):.2f} g") + LINE)

    # Üretici
    if product.producer:
        parts.append(_encode(f"Mark: {_truncate(product.producer, 24)}") + LINE)

    # Boşluk + barcode
    parts.append(LINE)
    parts.append(ALIGN_CENTER)
    parts.append(_barcode_code128(product.product_number or "0000"))
    parts.append(LINE)

    parts.append(FEED_2)
    parts.append(CUT)
    return b"".join(parts)
