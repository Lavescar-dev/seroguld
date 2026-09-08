"""R1-B Tier 0 — sundhedskort barkod katmanı testleri.

Sentetik görüntüler zxing-cpp'nin KENDİ encoder'ıyla üretilir (gerçek kart
verisi repoya asla girmez): Code 128 → PNG baytları → decode_identity_barcode.
"""

from __future__ import annotations

import base64
import io

import pytest
from PIL import Image
import zxingcpp

from app.services.identity_barcode_service import (
    decode_identity_barcode,
    parse_sundhedskort_barcode,
)

# mod-11'i GEÇEN sentetik CPR (0*4+1*3+0*2+1*7+0*6+1*5+1*4+1*3+9*2+9*1 = 33 % 11 = 0)
VALID_CPR = "0101011119"
# mod-11'i geçmeyen ama biçimi doğru sentetik CPR
UNVERIFIED_CPR = "0101901234"


def _code128_png_bytes(content: str, scale: int = 3) -> bytes:
    """zxing-cpp ile sentetik Code 128 PNG üret (test verisi — gerçek değil)."""
    bc = zxingcpp.create_barcode(content, zxingcpp.BarcodeFormat.Code128)
    zx_img = zxingcpp.write_barcode_to_image(bc)
    pil = Image.frombuffer(
        "L",
        (zx_img.shape[1], zx_img.shape[0]),
        memoryview(zx_img),
        "raw",
        "L",
        0,
        1,
    ).convert("RGB")
    if scale > 1:
        pil = pil.resize((pil.width * scale, pil.height * scale), Image.NEAREST)
    buf = io.BytesIO()
    pil.save(buf, "PNG")
    return buf.getvalue()


def test_parse_sundhedskort_barcode_with_check_character() -> None:
    # 10 hane + kontrol karakteri (mod-11 kalan 0 → kontrol '0')
    hit = parse_sundhedskort_barcode(VALID_CPR + "0")
    assert hit is not None
    assert hit.cpr == VALID_CPR
    assert hit.verified is True


def test_parse_sundhedskort_barcode_bare_ten_digits_uses_cpr_mod11() -> None:
    hit = parse_sundhedskort_barcode(VALID_CPR)
    assert hit is not None
    assert hit.verified is True


def test_parse_sundhedskort_barcode_prefix_tolerance() -> None:
    hit = parse_sundhedskort_barcode(f"CPR:{VALID_CPR}")
    assert hit is not None
    assert hit.cpr == VALID_CPR


def test_parse_sundhedskort_barcode_unverifiable_cpr_still_hits_but_flags() -> None:
    hit = parse_sundhedskort_barcode(UNVERIFIED_CPR)
    assert hit is not None
    assert hit.cpr == UNVERIFIED_CPR
    assert hit.verified is False


def test_parse_sundhedskort_barcode_rejects_garbage() -> None:
    assert parse_sundhedskort_barcode("") is None
    assert parse_sundhedskort_barcode("no digits here") is None
    assert parse_sundhedskort_barcode("12345") is None  # çok kısa
    assert parse_sundhedskort_barcode("9999999999") is None  # gün/ay geçersiz


def test_decode_identity_barcode_roundtrip_from_png() -> None:
    image_bytes = _code128_png_bytes(VALID_CPR + "0")
    hit = decode_identity_barcode(image_bytes)
    assert hit is not None
    assert hit.cpr == VALID_CPR
    assert hit.verified is True


def test_decode_identity_barcode_returns_none_for_blank_image() -> None:
    blank = io.BytesIO()
    Image.new("RGB", (400, 120), "white").save(blank, "PNG")
    assert decode_identity_barcode(blank.getvalue()) is None


def test_decode_identity_barcode_returns_none_for_corrupt_bytes() -> None:
    assert decode_identity_barcode(b"not-an-image") is None
    assert decode_identity_barcode(b"") is None


def test_synthetic_barcode_data_url_is_decodable() -> None:
    """Uç şemasıyla aynı yol: PNG baytları → data:image/png;base64 → decode."""
    image_bytes = _code128_png_bytes(VALID_CPR)
    data_url = "data:image/png;base64," + base64.b64encode(image_bytes).decode("ascii")
    raw = data_url.split("base64,", 1)[1]
    hit = decode_identity_barcode(base64.b64decode(raw))
    assert hit is not None
    assert hit.cpr == VALID_CPR
