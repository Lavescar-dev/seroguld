"""Kimlik alanı doğrulama katmanı (R1-B Tier 1) — saf fonksiyonlar, ağ YOK.

Üç katmanlı kimlik OCR mimarisinin orta katmanı: Tier 0 barkod (garantili
CPR) ve Tier 2 VLM çıktısı bu modülün doğrulayıcılarından geçer. Burada
hiçbir harici servise istek atılmaz; yalnız biçim/checksum/tutarlılık
denetimi yapılır.

Danish CPR: utils/cpr.py'deki mod-11 (2007 notuyla — başarısızlık uyarıdır,
hard hata değil) yeniden kullanılır. TCKN: standart mod-10 algoritması.
"""
from __future__ import annotations

import re
from datetime import date, datetime

from app.utils.cpr import _decode_birthdate, normalize_cpr, validate_cpr

# ----------------------------------------------------------------------------
# Karakter onarımı — OCR'ın en sık karıştırdığı çiftler
# ----------------------------------------------------------------------------

_NUMERIC_CONFUSABLES = str.maketrans({
    "O": "0",
    "o": "0",
    "I": "1",
    "l": "1",
    "B": "8",
    "S": "5",
    "Z": "2",
})

# Kørekort/pas numaraları büyük harf + rakam karışımıdır; yalnız tamamen
# rakam OLMASI beklenen alanlarda (CPR/TCKN) harf→rakam onarımı uygulanır.


def repair_numeric_confusables(value: str | None) -> str:
    """Rakam-olması-beklenen alanda sık OCR karışıklıklarını onarır.

    Yalnız dijital-rakam alanlarında çağrılmalı (CPR, TCKN); serbest metinde
    (ad, adres) ASLA — 'Søren' bozulur.
    """
    if not value:
        return ""
    return value.translate(_NUMERIC_CONFUSABLES)


_TR_TRANSLATION = str.maketrans({
    "æ": "ae",
    "ø": "oe",
    "å": "aa",
    "Æ": "Ae",
    "Ø": "Oe",
    "Å": "Aa",
    "ğ": "g",
    "Ğ": "G",
    "ı": "i",
    "İ": "I",
    "ş": "s",
    "Ş": "S",
    "ç": "c",
    "Ç": "C",
    "ö": "o",
    "Ö": "O",
    "ü": "u",
    "Ü": "U",
})


def transliterate_name(value: str | None) -> str:
    """dk/tr özel karakterlerini Latin eşleniklerine çevirir (ad eşleştirme
    için karşılaştırma anahtarı; görüntülenen ad değişmez)."""
    if not value:
        return ""
    return value.translate(_TR_TRANSLATION).casefold()


# ----------------------------------------------------------------------------
# CPR — soft doğrulama (utils/cpr.py yeniden kullanılır)
# ----------------------------------------------------------------------------


def validate_dk_cpr_soft(value: str | None) -> tuple[bool, str | None]:
    """Danish CPR soft doğrulaması.

    (ok, reason): 10 hane + gerçek takvim tarihi → ok. Mod-11 başarısızlığı
    2007 sonrası normal olduğundan ok döner (utils/cpr.validate_cpr zaten
    böyle davranır). reason yine de dönerse UI 'kontrol edin' gösterebilir.
    """
    format_ok, _mod11_ok, reason = validate_cpr(value)
    return format_ok, reason


def cpr_birthdate(value: str | None) -> date | None:
    digits = normalize_cpr(value)
    return _decode_birthdate(digits) if len(digits) == 10 else None


def _parse_birthdate(value: date | str) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return None


def birthdate_cpr_consistent(cpr: str | None, birthdate: date | str | None) -> bool:
    """VLM'in okuduğu doğum tarihi ile CPR'ın DDMMYY bölümü tutarlı mı?

    Yanlış eşleşme güçlü bir OCR sinyalidir → alan needs_review düşer.
    Doğum tarihi ayrıştırılamadıysa veya CPR okunamadıysa tutarlılık
    DENETLENEMEZ → True (yargı yok).
    """
    parsed = _parse_birthdate(birthdate) if birthdate is not None else None
    if parsed is None:
        return True
    decoded = cpr_birthdate(cpr)
    if decoded is None:
        return True
    return decoded == parsed


# ----------------------------------------------------------------------------
# TCKN — Türk kimlik numarası (mod-10)
# ----------------------------------------------------------------------------


def validate_tckn(value: str | None) -> tuple[bool, str | None]:
    """T.C. kimlik numarası: 11 hane, ilk hane 0 değil, standart mod-10.

    (ok, reason)
    """
    digits = normalize_cpr(repair_numeric_confusables(value))
    if not digits:
        return False, "TCKN boş"
    if len(digits) != 11:
        return False, "TCKN 11 haneli olmalı"
    if digits[0] == "0":
        return False, "TCKN ilk hanesi 0 olamaz"
    d = [int(ch) for ch in digits]
    odd = d[0] + d[2] + d[4] + d[6] + d[8]
    even = d[1] + d[3] + d[5] + d[7]
    if (odd * 7 - even) % 10 != d[9]:
        return False, "TCKN 10. hane kontrolü başarısız"
    if sum(d[:10]) % 10 != d[10]:
        return False, "TCKN 11. hane kontrolü başarısız"
    return True, None


# ----------------------------------------------------------------------------
# Danish kørekort — biçimsel soft denetim
# ----------------------------------------------------------------------------


def dk_licence_number_ok(value: str | None) -> bool:
    """Danish kørekort numarası: 10-11 karakter harf/rakam (boşluksuz).

    Sert checksum YOKTUR (halka açık doğrulama servisine bağımlılık
    istenmez) — yalnız biçim taraması; VLM güven skoru asıl yargıyı verir.
    """
    cleaned = re.sub(r"[\s-]", "", (value or "")).upper()
    return bool(re.fullmatch(r"[A-Z0-9]{10,11}", cleaned))


# ----------------------------------------------------------------------------
# Güven eşiği → inceleme kararı
# ----------------------------------------------------------------------------

REVIEW_VALIDATED = "validated"
REVIEW_NEEDS_REVIEW = "needs_review"


def review_for(
    value: str | None,
    confidence: float | None,
    threshold: float = 0.62,
    *,
    checksum_ok: bool = True,
) -> str:
    """Alan bazlı inceleme kararı.

    - değer boşsa 'needs_review' denemez (alan yoktur — boş bırakılır)
    - checksum_ok (biçim/checksum/tutarlılık denetiminin SONUCU) False ise
      'needs_review'
    - güven eşiği altındaysa 'needs_review'; üstündeyse 'validated'
    - VLM güven vermediyse (None) ihtiyatlı taraf: 'needs_review'
    """
    if not (value or "").strip():
        return REVIEW_NEEDS_REVIEW
    if not checksum_ok:
        return REVIEW_NEEDS_REVIEW
    if confidence is None or float(confidence) < threshold:
        return REVIEW_NEEDS_REVIEW
    return REVIEW_VALIDATED
