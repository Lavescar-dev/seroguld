"""Danish CPR number validation utilities.

CPR (Personnummer) format: DDMMYY-NNNN (10 digits total).

Mod-11 checksum: multiply each of the first 10 digits by (4,3,2,7,6,5,4,3,2,1)
and the sum must be divisible by 11.

NOTE: Since 2007 some valid CPRs do NOT satisfy mod-11 due to numbering
capacity exhaustion. Treat mod-11 failure as a *warning*, not a hard error.
The date-of-birth (DDMMYY) component must still be a real calendar date.
"""
from __future__ import annotations

import re
from datetime import date

_MULTIPLIERS = (4, 3, 2, 7, 6, 5, 4, 3, 2, 1)
_CPR_DIGITS_RE = re.compile(r"^\d{10}$")


def normalize_cpr(value: str | None) -> str:
    """Strip non-digits; return digits-only string (may be partial)."""
    if not value:
        return ""
    return re.sub(r"\D", "", value)


def cpr_birth_part(value: str | None) -> str:
    """CPR'nin yalnız doğum tarihi bölümü (ilk 6 hane).

    Veri minimizasyonu: workbook/PDF çıktılarına tam CPR yazılmaz; tire ve
    son dört hane hiçbir belgeye aktarılmaz. 6 haneden az veri varsa eldeki
    haneler döner (uydurma yok).
    """
    return normalize_cpr(value)[:6]


def _decode_birthdate(digits10: str) -> date | None:
    if len(digits10) != 10:
        return None
    try:
        dd = int(digits10[0:2])
        mm = int(digits10[2:4])
        yy = int(digits10[4:6])
        seventh = int(digits10[6])
    except ValueError:
        return None
    if seventh < 4:
        century = 1900
    elif seventh in (4, 9):
        century = 2000 if yy <= 36 else 1900
    else:  # 5-8
        century = 2000 if yy <= 57 else 1800
    year = century + yy
    try:
        return date(year, mm, dd)
    except ValueError:
        return None


def validate_cpr(value: str | None) -> tuple[bool, bool, str | None]:
    """Validate a Danish CPR number.

    Returns (format_ok, mod11_ok, reason_if_invalid).

    - format_ok=False means digits != 10 or birthdate impossible.
    - mod11_ok=False with format_ok=True means valid format/date but
      mod-11 checksum failed — this is acceptable post-2007.
    """
    digits = normalize_cpr(value)
    if not digits:
        return False, False, "CPR boş"
    if not _CPR_DIGITS_RE.match(digits):
        return False, False, "CPR 10 haneli olmalı (DDMMYY + 4 hane)"
    birthdate = _decode_birthdate(digits)
    if birthdate is None:
        return False, False, "CPR doğum tarihi geçersiz"
    total = sum(int(d) * m for d, m in zip(digits, _MULTIPLIERS))
    mod11_ok = total % 11 == 0
    if not mod11_ok:
        return True, False, "Mod-11 kontrolü başarısız (2007 sonrası bazı CPR'lar için normal)"
    return True, True, None
