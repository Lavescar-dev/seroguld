"""R1-B Tier 1 — identity_validate saf doğrulayıcı testleri."""

from __future__ import annotations

from datetime import date

from app.utils.identity_validate import (
    REVIEW_NEEDS_REVIEW,
    REVIEW_VALIDATED,
    birthdate_cpr_consistent,
    dk_licence_number_ok,
    repair_numeric_confusables,
    review_for,
    transliterate_name,
    validate_dk_cpr_soft,
    validate_tckn,
)


def test_validate_dk_cpr_soft_accepts_mod11_pass_and_warns_on_fail() -> None:
    ok, reason = validate_dk_cpr_soft("0101011119")
    assert ok is True
    assert reason is None  # mod-11 geçti

    # Format/date doğru ama mod-11 başarısız → yine ok (2007 sonrası normal).
    ok2, reason2 = validate_dk_cpr_soft("0101901234")
    assert ok2 is True
    assert reason2 is not None  # uyarı taşır


def test_validate_dk_cpr_soft_rejects_bad_format() -> None:
    ok, _reason = validate_dk_cpr_soft("01019")
    assert ok is False
    ok2, _reason2 = validate_dk_cpr_soft("3201901234")  # gün 32
    assert ok2 is False


def test_validate_tckn_accepts_known_valid_number() -> None:
    ok, reason = validate_tckn("10000000146")
    assert ok is True
    assert reason is None


def test_validate_tckn_rejects_checksum_and_format_failures() -> None:
    assert validate_tckn("10000000147")[0] is False  # 10. hane bozuk
    assert validate_tckn("10000000140")[0] is False  # 11. hane bozuk
    assert validate_tckn("00000000146"[1:])[0] is False  # uzunluk
    assert validate_tckn("90000000146")[0] is False  # ilk hane 9 → 10. hane tutmaz


def test_validate_tckn_repairs_ocr_confusables_first() -> None:
    # 'O' harfi 0 olarak onarılır → geçerli TCKN çıkar.
    assert validate_tckn("1OOOOOOO146")[0] is True


def test_dk_licence_number_ok_allows_10_11_alnum() -> None:
    assert dk_licence_number_ok("1234567890") is True
    assert dk_licence_number_ok("AB12345678") is True  # 10
    assert dk_licence_number_ok("AB 1234 5678") is True  # boşluk temizlenir
    assert dk_licence_number_ok("AB1234567") is False  # 9
    assert dk_licence_number_ok("AB12345678901") is False  # 12
    assert dk_licence_number_ok("") is False


def test_repair_numeric_confusables_and_transliterate() -> None:
    assert repair_numeric_confusables("O123I567B9") == "0123156789"
    assert transliterate_name("Şøren Üğur") == "soeren ugur"
    assert transliterate_name("Ærø Å") == "aeroe aa"
    # Görüntülenen ad DEĞİŞMEZ — yalnız karşılaştırma anahtarı için.
    assert transliterate_name("København") == "koebenhavn"


def test_birthdate_cpr_consistent() -> None:
    # 010190 + 7. hane 1 (yy=90 → 1900'ler) → 1990-01-01
    assert birthdate_cpr_consistent("0101901234", date(1990, 1, 1)) is True
    assert birthdate_cpr_consistent("0101901234", "1990-01-01") is True
    assert birthdate_cpr_consistent("0101901234", "1991-01-01") is False
    # Doğum tarihi verilmediyse yargı yok.
    assert birthdate_cpr_consistent("0101901234", None) is True
    assert birthdate_cpr_consistent(None, date(1990, 1, 1)) is True
    # Ayrıştırılamayan tarih → yargı yok.
    assert birthdate_cpr_consistent("0101901234", "ocak") is True


def test_review_for_threshold_and_checksum() -> None:
    assert review_for("0101011119", 0.9) == REVIEW_VALIDATED
    assert review_for("0101011119", 0.5) == REVIEW_NEEDS_REVIEW
    assert review_for("0101011119", None) == REVIEW_NEEDS_REVIEW  # güven yok → ihtiyat
    assert review_for("0101011119", 0.9, checksum_ok=False) == REVIEW_NEEDS_REVIEW
    assert review_for("", 0.9) == REVIEW_NEEDS_REVIEW
    # Özel eşik (config'ten gelen değer) uygulanır.
    assert review_for("abc", 0.7, threshold=0.8) == REVIEW_NEEDS_REVIEW
    assert review_for("abc", 0.85, threshold=0.8) == REVIEW_VALIDATED
