"""ESC/POS 80mm thermal receipt builder.

80mm kağıt ≈ 48 karakter/satır (font A, 12 dpi).
Çıktı raw ESC/POS bytes — frontend bunu /dev/usb/lp0 veya benzeri printera
yönlendirir (Tauri host plugin ya da OS yazıcı kuyruğu üzerinden).

Kullanım:
    bytes_ = build_thermal_receipt_from_detail(detail)
"""
from __future__ import annotations

from decimal import Decimal
from typing import Iterable

from app.schemas.pos import PosDocumentDetailOut

LINE_WIDTH = 48  # 80mm standart, Font A (12x24)

# ESC/POS komutları
ESC = b"\x1b"
GS = b"\x1d"
INIT = ESC + b"@"
LINE = b"\n"
CUT = GS + b"V\x00"  # Full cut
ALIGN_LEFT = ESC + b"a\x00"
ALIGN_CENTER = ESC + b"a\x01"
ALIGN_RIGHT = ESC + b"a\x02"
BOLD_ON = ESC + b"E\x01"
BOLD_OFF = ESC + b"E\x00"
SIZE_DOUBLE = GS + b"!\x11"  # 2x width + 2x height
SIZE_NORMAL = GS + b"!\x00"
FEED_3 = b"\n\n\n"


def _truncate(text: str, width: int) -> str:
    return text if len(text) <= width else text[: width - 1] + "…"


def _row(left: str, right: str, width: int = LINE_WIDTH) -> str:
    left = left or ""
    right = right or ""
    if len(left) + len(right) + 1 > width:
        left = _truncate(left, width - len(right) - 1)
    pad = max(1, width - len(left) - len(right))
    return f"{left}{' ' * pad}{right}"


def _format_money(value: str | Decimal | float | None) -> str:
    if value is None or value == "":
        return "0,00"
    try:
        d = Decimal(str(value))
    except (ValueError, ArithmeticError):
        return str(value)
    return f"{d:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def _encode_line(text: str) -> bytes:
    return text.encode("cp865", errors="replace")  # Nordic dansk codepage


def build_thermal_receipt_from_detail(detail: PosDocumentDetailOut) -> bytes:
    """PosDocumentDetail'den ESC/POS bytes üret."""
    parts: list[bytes] = []
    parts.append(INIT)

    # Header
    parts.append(ALIGN_CENTER)
    parts.append(SIZE_DOUBLE)
    parts.append(BOLD_ON)
    parts.append(_encode_line("SERO GULD") + LINE)
    parts.append(BOLD_OFF)
    parts.append(SIZE_NORMAL)
    parts.append(_encode_line("Afregningsbilag") + LINE)
    parts.append(_encode_line("Valby Langgade 84") + LINE)
    parts.append(_encode_line("2500 Valby · CVR 34093083") + LINE)
    parts.append(LINE)

    parts.append(ALIGN_LEFT)
    parts.append(_encode_line("-" * LINE_WIDTH) + LINE)
    parts.append(_encode_line(_row("AFG.NR.", str(detail.document_number or "-"))) + LINE)
    parts.append(_encode_line(_row("DATO", str(detail.issued_at or "-")[:10])) + LINE)
    if getattr(detail, "customer_name", None):
        parts.append(_encode_line(_row("KUNDE", _truncate(detail.customer_name, LINE_WIDTH - 7))) + LINE)
    if getattr(detail, "customer_phone", None):
        parts.append(_encode_line(_row("TLF", detail.customer_phone)) + LINE)
    parts.append(_encode_line("-" * LINE_WIDTH) + LINE)

    # Lines
    line_items: Iterable = getattr(detail, "lines", []) or []
    for line in line_items:
        label = getattr(line, "purity_label", None) or getattr(line, "type_label", "") or "-"
        gram = getattr(line, "weight_grams", "") or ""
        total = getattr(line, "line_total_dkk", "") or ""
        left = _truncate(str(label), 24)
        gram_str = f"{gram} g" if gram else ""
        right = f"{gram_str:>10}  {_format_money(total):>10}"
        parts.append(_encode_line(_row(left, right)) + LINE)

    parts.append(_encode_line("-" * LINE_WIDTH) + LINE)
    parts.append(BOLD_ON)
    parts.append(SIZE_DOUBLE)
    parts.append(_encode_line(_row("TOTAL", _format_money(getattr(detail, "gross_amount_dkk", "")), width=LINE_WIDTH // 2)) + LINE)
    parts.append(SIZE_NORMAL)
    parts.append(BOLD_OFF)
    parts.append(LINE)
    parts.append(ALIGN_CENTER)
    parts.append(_encode_line("Tak for handlen") + LINE)
    parts.append(_encode_line("seroguld.dk") + LINE)
    parts.append(FEED_3)
    parts.append(CUT)
    return b"".join(parts)
