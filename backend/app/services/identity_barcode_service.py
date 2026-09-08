"""Kimlik barkod katmanı (R1-B Tier 0) — sundhedskort Code 128.

Danish sundhedskorttın (gul sağlık kartı) arkasındaki Code 128 barkod
kart sahibinin CPR'ını taşır. Barkod OFFLINE ve ÜCRETSİZDİR, görüntü
backend belleğinde işlenir (diske YAZILMAZ) ve mod-11 kontrol karakteriyle
doğrulanabilir — VLM'e hiç gönderilmeden garantili CPR kaynağıdır.

zxing-cpp wheel'i hem decode hem sentetik test üretimi için encode
sağlar; sistem kütüphanesi gerektirmez.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from app.utils.cpr import normalize_cpr, validate_cpr

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class IdentityBarcodeHit:
    """Barkoddan okunan CPR — verified: mod-11 kontrol karakteri/kontrolü geçti."""

    cpr: str
    cpr_digits: str
    verified: bool
    raw_text: str


def _dk_cpr_check_digit(digits10: str) -> str | None:
    """CPR'ın son 4 hanenin ilkine eklenen kontrol mantığı YOKTUR; sundhedskort
    barkodunda CPR'dan sonra gelen kontrol karakteri mod-11 ürünlerinin
    kalanıdır (10 hane × (4,3,2,7,6,5,4,3,2,1) toplamı mod 11)."""
    weights = (4, 3, 2, 7, 6, 5, 4, 3, 2, 1)
    try:
        total = sum(int(d) * w for d, w in zip(digits10, weights))
    except ValueError:
        return None
    remainder = total % 11
    if remainder == 0:
        return "0"
    return str(11 - remainder)


def parse_sundhedskort_barcode(raw_text: str) -> IdentityBarcodeHit | None:
    """Barkod metnini CPR'a ayrıştırır; mod-11 kontrol karakterini doğrular.

    Sundhedskort barkod içeriği tarih içinde değişkenlik göstermiştir: saf
    10 hane, 10 hane + kontrol karakteri (11 hane) veya öndeki ek alanlarla.
    Ayrıştırıcı toleranslıdır: ilk 10 rakam CPR alınır, 11. karakter varsa
    kontrol olarak denenir; ne şekilde olursa olsun CPR'ın mod-11'i
    (utils/cpr) ve kontrol karakteri varsa kendi checksum'ı denetlenir.
    """
    text = (raw_text or "").strip()
    if not text:
        return None

    digits = normalize_cpr(text)
    # Barkod CPR ile BAŞLAMALI: ortadan 10 hane koparmak false positive üretir.
    if not text[:1].isdigit():
        # Öndeki harf/kod alanlarına tolerans: metin içindeki İLK 10+ rakam
        # dizisini dene (ör. "CPR:0101901234").
        match = None
        for candidate in _digit_runs(text):
            if len(candidate) >= 10:
                match = candidate
                break
        if match is None:
            return None
        digits = match

    if len(digits) < 10:
        return None
    cpr = digits[:10]
    trailing = digits[10:12]  # kontrol karakter(ler)i

    format_ok, mod11_ok, _reason = validate_cpr(cpr)
    if not format_ok:
        return None

    verified = bool(mod11_ok)
    if trailing:
        expected = _dk_cpr_check_digit(cpr)
        if expected is not None and trailing[0] == expected:
            verified = True

    return IdentityBarcodeHit(
        cpr=cpr,
        cpr_digits=cpr,
        verified=verified,
        raw_text=text[:64],
    )


def _digit_runs(text: str) -> list[str]:
    runs: list[str] = []
    current: list[str] = []
    for ch in text:
        if ch.isdigit():
            current.append(ch)
        else:
            if current:
                runs.append("".join(current))
                current = []
    if current:
        runs.append("".join(current))
    return runs


def decode_identity_barcode(image_bytes: bytes) -> IdentityBarcodeHit | None:
    """Görüntü baytlarından barkod decode eder (tamamen bellek içi).

    Görüntü diske YAZILMAZ: PIL bellekte açılır, zxing-cpp piksel dizisine
    bakar. Karo/QR/1D hepsi denenir (sundhedskort Code 128 kullanır ama
    eski kartlarda farklı fiziksel düzen olabilir).
    """
    if not image_bytes:
        return None

    from io import BytesIO

    from PIL import Image
    import zxingcpp

    try:
        with Image.open(BytesIO(image_bytes)) as img:
            rgb = img.convert("RGB")
    except Exception as exc:
        logger.warning("Kimlik barkodu: görüntü açılamadı (%s)", type(exc).__name__)
        return None

    try:
        results = zxingcpp.read_barcodes(rgb)
    except Exception as exc:
        logger.warning("Kimlik barkodu: decode hatası (%s)", type(exc).__name__)
        return None

    for result in results:
        hit = parse_sundhedskort_barcode(str(result.text or ""))
        if hit is not None:
            return hit
    return None
