"""Kimlik OCR ROI tablosu (0.3.39 D5) — geometri VERİDİR, kod değil.

Warp edilmiş ID-1 tuvali (1280x808, en-boy 1.586) üzerinde NORMALIZE
dikdörtgenler: x/y sol üst köşe, w/h genişlik-yükseklik, hepsi 0..1
aralığında. Her belge tipi için basılı alan numaraları (körekort 1/2/3/
4a-4d/5) veya şerit adları (sundhedskort name/cpr/adres/posta) anahtardır.

ÖNEMLİ: İlk koordinatlar TAHMİNİDİR — gerçek kart fotoğrafları üzerinde
``tests/ocr_benchmark.py --engine local --roi-dump <repo dışı klasör>``
çıktısıyla ayarlanır ve ``IDENTITY_OCR_ROI_OVERRIDES_JSON`` env'iyle
defaults ÜZERİNE derin birleşim olarak uygulanır (ayar kodu değiştirmeden).

Paylar CÖMERT tutulur ve çakışması normaldir: ROI yalnız kaba bir pencere,
asıl seçim aynı pencereye düşen kelime kutularından yapılır. ROI alan
getiremezse tam-kart metni (ocr_text) frontend'e döner ve mevcut regex
zinciri o metin üzerinde koşar — zincir asla kör bir köşeye sıkışmaz.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from app.config import get_settings

logger = logging.getLogger(__name__)

# Warp tuvali: ID-1 (kart) en-boy oranı 1.586. Tüm ROI'ler bu tuvale göredir.
ID1_ASPECT = 1.586
ID1_CANVAS_WIDTH = 1280
ID1_CANVAS_HEIGHT = 808

# ROI anahtarı → çıktı alanı eşlemesi burada DEĞİL, identity_local_parse'de
# yapılır; bu modül yalnız geometri taşır (veri/kod ayrımı).


@dataclass(frozen=True, slots=True)
class FieldRoi:
    """Normalize dikdörtgen pencere + insan-okur etiketler."""

    # Çıktı alanı: IdentityExtractOut.fields sözlüğü anahtarlarından biri.
    field: str
    x: float
    y: float
    w: float
    h: float
    # Kart üstündeki basılı alan no / şerit adı ("4d", "name", "mrz").
    key: str = ""
    # Kartta beklenen yazı etiketi (ör. "CPR-nr.") — yalnız teşhis/benchmark
    # çıktısında ipucu; eşleme zorunlu değildir (etiket her kartta basılı değil).
    label_hint: str = ""


def _roi(field: str, key: str, x: float, y: float, w: float, h: float, label: str = "") -> FieldRoi:
    return FieldRoi(field=field, key=key, x=x, y=y, w=w, h=h, label_hint=label)


# ---------------------------------------------------------------------------
# VARSAYILANLAR — TAHMİNİ koordinatlar (gerçek kartlarda ayarlanır).
# ---------------------------------------------------------------------------
# Aşağıdaki pencereler 0.3.5 sentetik SPECIMEN kartlarının warp tuvalindeki
# gerçek kelime konumlarına göre kaleme alındı (yıllanmış kabaca tahminler
# değil, ölçülmüş ilk değerler) — yine de GERÇEK kartlarda paylar farklı
# olabilir: benchmark --roi-dump çıktısıyla IDENTITY_OCR_ROI_OVERRIDES_JSON
# üzerinden ince ayar yapılır, kod değişmez.
# X aralıkları bilerek dardır (4a/4b gibi yanyana kolonlar karışmasın) ve
# etiket kelimeleri parse katmanında düşürülür.

DEFAULT_ROIS: dict[str, tuple[FieldRoi, ...]] = {
    # Danmarks kørekort (ID-1): fotoğraf solda, basılı alan bloğu sağda.
    # Alan no'lar kartta basılıdır: 1 Efternavn, 2 Fornavne, 3 Fødselsdato
    # og -sted, 4a Udstedt, 4b Gyldig til, 4c Udstedt af, 4d CPR-nr.,
    # 5 Kørekortnr. (4d her kartta basılı değildir — eski kartlar).
    "koerekort": (
        _roi("full_name", "1", 0.20, 0.04, 0.78, 0.21, "Efternavn"),
        _roi("full_name", "2", 0.20, 0.25, 0.78, 0.13, "Fornavne"),
        _roi("birth_date", "3", 0.20, 0.33, 0.78, 0.14, "Fodselsdato og -sted"),
        _roi("expiry_date", "4b", 0.55, 0.47, 0.43, 0.15, "Gyldig til"),
        _roi("cpr_number", "4d", 0.20, 0.60, 0.78, 0.16, "CPR-nr."),
        _roi("doc_number", "5", 0.50, 0.60, 0.48, 0.22, "Koerekortnr."),
    ),
    # Gul sundhedskort (sygesikringsbevis): sol üstte ad, altında CPR,
    # sonra adres ve Postnr./by bloğu. Sağ kolon (läge/telefon) dışlanır.
    "sundhedskort": (
        _roi("full_name", "name", 0.02, 0.19, 0.53, 0.11, "Navn"),
        _roi("cpr_number", "cpr", 0.02, 0.31, 0.43, 0.14, "CPR-nr."),
        _roi("address", "address", 0.02, 0.45, 0.40, 0.11, "Adresse"),
        _roi("postal_code", "postal", 0.02, 0.56, 0.40, 0.14, "Postnr. og by"),
        _roi("city", "postal", 0.02, 0.56, 0.40, 0.14, "Postnr. og by"),
    ),
    # Danmarks pas (TD3 MRZ): basılı soyad/ad satırları + alt MRZ şeridi.
    # Basılı ad transliterasyonsuzdur (PRØVE); MRZ adı PROEVE verir — ikisi
    # eşitlenmez, basılı ad tercih edilir (fixture notlarındaki kural).
    "pas": (
        _roi("full_name", "1", 0.15, 0.26, 0.83, 0.10, "Efternavn / Surname"),
        _roi("full_name", "2", 0.15, 0.36, 0.83, 0.10, "Fornavn / Given names"),
        _roi("birth_date", "3", 0.15, 0.53, 0.45, 0.12, "Fodselsdato"),
        _roi("doc_number", "mrz", 0.02, 0.76, 0.96, 0.22, "MRZ"),
        _roi("birth_date", "mrz", 0.02, 0.76, 0.96, 0.22, "MRZ"),
        _roi("expiry_date", "mrz", 0.02, 0.76, 0.96, 0.22, "MRZ"),
    ),
    # Danmarks id-kort (TD1 MRZ, üç satır): üstte soyad/kortnr, altta MRZ.
    "idkort": (
        _roi("full_name", "1", 0.15, 0.04, 0.45, 0.21, "Efternavn / Surname"),
        _roi("doc_number", "5", 0.60, 0.04, 0.38, 0.22, "Kortnr. / Card No."),
        _roi("full_name", "2", 0.15, 0.25, 0.45, 0.17, "Fornavn / Given names"),
        _roi("birth_date", "3", 0.15, 0.32, 0.45, 0.14, "Fodselsdato"),
        _roi("expiry_date", "4b", 0.60, 0.46, 0.38, 0.16, "Udlober"),
        _roi("birth_date", "mrz", 0.02, 0.70, 0.96, 0.30, "MRZ"),
        _roi("doc_number", "mrz", 0.02, 0.70, 0.96, 0.30, "MRZ"),
    ),
}

# ROI tablosundaki belge tipi → şema document_type değeri (VLM şemasıyla aynı
# sözleşme: sundhedskort | passport | driver_license | id_card | ...).
DOCUMENT_TYPE_BY_ROI_KEY = {
    "koerekort": "driver_license",
    "sundhedskort": "sundhedskort",
    "pas": "passport",
    "idkort": "id_card",
}


def _deep_merge_row(defaults: dict[str, tuple[FieldRoi, ...]], doc_type: str, key: str, patch: dict) -> None:
    """Tek ROI satırını patch'ler; satır yoksa yeni olarak ekler."""
    rows = list(defaults.get(doc_type, ()))
    index = next((i for i, row in enumerate(rows) if row.key == key), None)
    base = rows[index] if index is not None else FieldRoi(field=str(patch.get("field", "")), key=key, x=0.0, y=0.0, w=0.0, h=0.0)
    updated = {
        "field": str(patch.get("field", base.field)),
        "x": _clamp01(patch.get("x", base.x), "x"),
        "y": _clamp01(patch.get("y", base.y), "y"),
        "w": _clamp01(patch.get("w", base.w), "w"),
        "h": _clamp01(patch.get("h", base.h), "h"),
        "label_hint": str(patch.get("label_hint", base.label_hint)),
    }
    if None in updated.values() or not updated["field"]:
        logger.warning("IDENTITY_OCR_ROI_OVERRIDES_JSON: %s/%s satiri gecersiz deger tasiyor, atlandi.", doc_type, key)
        return
    row = _roi(updated["field"], key, updated["x"], updated["y"], updated["w"], updated["h"], updated["label_hint"])
    if index is None:
        rows.append(row)
    else:
        rows[index] = row
    defaults[doc_type] = tuple(rows)


def _clamp01(value: object, name: str) -> float | None:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if number < 0.0 or number > 1.0:
        return None
    if name in ("w", "h") and number <= 0.0:
        return None
    return number


def load_rois() -> dict[str, tuple[FieldRoi, ...]]:
    """Gömülü varsayılanlar + ``IDENTITY_OCR_ROI_OVERRIDES_JSON`` derin birleşimi.

    Env biçimi::

        {"koerekort": {"4d": {"x": 0.31, "y": 0.70, "w": 0.66, "h": 0.20}}}

    Bozuk JSON / geçersiz değer ASLA crash üretmez: uyarı loglanır, o satır
    (veya tamamı) atlanır ve defaults ayakta kalır — tarama yolu her koşulda
    çalışmaya devam eder.
    """
    merged: dict[str, tuple[FieldRoi, ...]] = {doc: tuple(rows) for doc, rows in DEFAULT_ROIS.items()}
    raw = (get_settings().identity_ocr_roi_overrides_json or "").strip()
    if not raw:
        return merged
    try:
        payload = json.loads(raw)
    except (ValueError, TypeError) as exc:
        logger.warning("IDENTITY_OCR_ROI_OVERRIDES_JSON JSON degil (%s) — varsayilan ROI'ler kullaniliyor.", exc)
        return merged
    if not isinstance(payload, dict):
        logger.warning("IDENTITY_OCR_ROI_OVERRIDES_JSON nesne bekliyordu — varsayilan ROI'ler kullaniliyor.")
        return merged
    for doc_type, entries in payload.items():
        if not isinstance(entries, dict):
            logger.warning("ROI override %s: sozluk bekliyordu, atlandi.", doc_type)
            continue
        for key, patch in entries.items():
            if not isinstance(patch, dict):
                logger.warning("ROI override %s/%s: sozluk bekliyordu, atlandi.", doc_type, key)
                continue
            _deep_merge_row(merged, str(doc_type), str(key), patch)
    return merged


def rois_for(rois: dict[str, tuple[FieldRoi, ...]], doc_type_key: str) -> tuple[FieldRoi, ...]:
    """Belge tipinin ROI satırları (yoksa boş demet — tam-kart metnine düşer)."""
    return rois.get(doc_type_key, ())
