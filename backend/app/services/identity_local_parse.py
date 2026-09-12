"""Yerel OCR parse katmanı (0.3.39) — ROI kelime seçimi + doğrulama, ağ YOK.

Girdi: OCR motorunun ürettiği kelime kutuları (metin, güven, bbox) ve ROI
tablosu. Çıktı: soyut alan sözlüğü (IdentityExtractOut.fields anahtarlarıyla
birebir) + güven + checksum kararı. Modül tamamen SAFTIR: cv2/PIL/ağ
kullanmaz, testlerde sahte kelime listeleriyle koşar.

Kurallar (plan WP2):
- körekort 1+2 → full_name "given surname", 3 → birth_date, 4d → CPR
  (onarım + soft doğrulama), 5 → doc_number (Danish kartta 8 hane).
- Barkod CPR OTORİTE'dir; 4d ile çelişirse alan needs_review düşer.
- mod-11 yalnız YUMUŞAK sinyaldir (2007 sonrası kartlar meşru fail eder).
- RapidOCR güveni ``review_for`` ile inceleme kararına çevrilir.
"""
from __future__ import annotations

import logging
import math
import re
from dataclasses import dataclass, field as dc_field

from app.schemas.identity import IdentityFieldOut
from app.utils.cpr import validate_cpr
from app.utils.identity_validate import (
    REVIEW_VALIDATED,
    birthdate_cpr_consistent,
    dk_licence_number_ok,
    repair_numeric_confusables,
    review_for,
    transliterate_name,
)
from app.services.identity_ocr_rois import (
    DOCUMENT_TYPE_BY_ROI_KEY,
    ID1_CANVAS_HEIGHT,
    ID1_CANVAS_WIDTH,
    FieldRoi,
    load_rois,
    rois_for,
)

logger = logging.getLogger(__name__)

# ROI tablosu tuvali (normalize koordinatlar bu tuvale göredir).
CANVAS = (ID1_CANVAS_WIDTH, ID1_CANVAS_HEIGHT)

# Aynı satır sayılması için dikey örtüşme eşiği (ROI kutu-birleştirme).
LINE_Y_OVERLAP_RATIO = 0.6

# Kalıntı eğim düzeltmesi (saha 10 Eyl 2026): warp/flatbed sonrası kartta
# 2-6° kalan eğim satır gruplamayı bozuyordu — ad penceresi bir alt satırın
# parçasını ('Sikr.') son harf satırı sanıp AD yazıyordu. Eğim OCR KELIME
# kutularından kestirilir ve yalnız GRUPLAMA/PENCERE eşlemesi için kelime
# merkezleri döndürülür (görüntü yeniden okunmaz — gecikme etkisi ~0).
SKEW_MIN_DEG = 0.35   # bu eşik altı ölçüm gürültüdür, dokunma
SKEW_MAX_DEG = 10.0   # bu eşik üstü ölçüm yanılgıdır, dokunma
# En iyi aday DÜZ hipotezden (0°) belirgin iyileşme sağlamıyorsa eğim YOK
# sayılır: seyrek başlık/etiket kelimeleri sahte bir tepeyi 0.5-1.5°'de
# tutabiliyor ve yanlış döndürme satırları KARIŞTIRIYORDU (fixture
# regresyonu 10 Eyl 2026: 'ANDERS REGION' birleşik satırı). Gerçek 2-6°
# eğim düz hipoteze göre çok daha büyük skor getirir — marj güvenli.
SKEW_IMPROVEMENT_FACTOR = 1.30
SKEW_PAIR_HEIGHT_RATIO = 2.2  # farklı punto çiftleri (başlık↔gövde) taban
                              # hizası taşımaz — çift kurmaz
# WARP YAPILMIŞ kare için sıkı kapı: dörtgen perspektif düzeltmesi eğimin
# çoğunu giderdiğini varsayar — kalan ±5°'den büyük 'ölçüm' yanılgıdır ve
# skorun düz hipoteze göre en az 1.8x iyi olması gerekir (ölçüm 10 Eyl 2026:
# gerçek artık eğim +2.75°/oran 3.3; blur yanlış-pozitifi +9.0°/oran 1.4).
SKEW_WARPED_MAX_DEG = 5.0
SKEW_WARPED_IMPROVEMENT = 1.80
# Kelime tavanı: çift kurulum O(n^2)x77 adayla koşar — kart ASLA 200 kelime
# vermez, tam sayfa (yanlış belge taraması, card_not_detected yolu) verir ve
# orada 0.4-2.2 sn CPU yakıyordu (0.3.40 incelemesi). Sayfa eğimi ROI için
# anlamsızdır: tavan üstünde kestirim yok sayılır.
SKEW_MAX_WORDS = 200

# DEV KELİME KUTUSU eşiği (tuval yüksekliğinin oranı): kart metin satırı
# ≤~0.09'dir; filigran artıkları ('ECIMEN', dikey 'SUNDHEDSKORT') ve foto
# bölgesi çöpü 0.18-0.43 ölçer. Bu kutular satır GRUPLAMASINA girerse
# aralarındaki TÜM satırları tek satırda birleştirip köprü kurar (saha 13 Eyl
# 2026: ad+adres+klinik tek satırda birleşiyordu). ocr_text'te KALIRLAR —
# belge tipi kokusu ('SUNDHEDSKORT') onlardan gelir.
GIANT_WORD_HEIGHT_RATIO = 0.15

# gg.aa.yyyy VEYA yyyy-aa-gg (ISO basan kartlar). Ayırıcı boşluk DEĞİL:
# pencereye sızan komşu sayılar boşlukla tarihe yapışıp sahte tarih kurar
# ('2058-03-15 150388-...' → '03-15 1503'). Nokta/tire/bölü yeterlidir.
_DATE_RE = re.compile(
    r"(?:(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})|(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2}))"
)
_POSTAL_RE = re.compile(r"\b(\d{4})\b")


def _is_name_token(token: str) -> bool:
    """Harf içerir, rakam içermez → ad/şehir kelimesi ('Sørensen-Åberg' kalır)."""
    cleaned = token.strip().strip(".,:;")
    return bool(cleaned) and any(ch.isalpha() for ch in cleaned) and not any(ch.isdigit() for ch in cleaned)


def _label_key(token: str) -> str:
    """Etiket karşılaştırma anahtarı: 'CPR-nr.' → 'cprnr' (noktalama sayılmaz)."""
    return re.sub(r"[^a-z]", "", transliterate_name(token))

# Kartta basılı alan ETİKETLERİ değerle aynı pencereye düşebilir; değer
# çıkarırken bir kez düşürülür (etiket yoksa hiç etkilenmez). Liste kart
# sözlüğünden gelir (tr/en/da etiketler + SPECIMEN filigran parçaları);
# karşılaştırma translitere + noktalama temizliği ile yapılır.
_LABEL_TOKENS = {
    "efternavn",
    "fornavn",
    "fornavne",
    "navn",
    "name",
    "surname",
    "given",
    "names",
    "fodselsdato",
    "fodested",
    "ogsted",
    "udstedelsesdato",
    "udstedt",
    "udsteder",
    "udstedende",
    "udlobsdato",
    "udlober",
    "gyldig",
    "til",
    "myndighed",
    "cpr",
    "cprnr",
    "personnummer",
    "personnr",
    "nr",
    "nummer",
    "koerekort",
    "koerekortnummer",
    "administrativt",
    "adresse",
    "postnummer",
    "postnr",
    "by",
    "sundhedskort",
    "sygesikringsbevis",
    "pas",
    "pasnr",
    "passport",
    "idkort",
    "kortnr",
    "kortet",
    "card",
    "type",
    "kode",
    "code",
    "nationalitet",
    "nationality",
    "kon",
    "sex",
    "personal",
    "holder",
    "foto",
    "place",
    "kategorier",
    "betingelser",
    "briller",
    "region",
    "identitetsbevis",
    "ikke",
    "er",
    "et",
    "laege",
    "laegehuset",
    "tif",
    "tf",
    "og",
    "sted",
    "danmark",
    "danmarks",
    "dk",
    "dnk",
    # Transliterasyon biçimleri: Ø/Æ/Å içeren etiketler anahtara 'oe/ae/aa'
    # olarak düşer ('Fødselsdato' → 'foedselsdato') — ham yazım YANINA bu
    # biçimler de listelenmeden etiket düşürme ıskalar.
    "foedselsdato",
    "foedested",
    "foedsels",
    "fedselsdato",
    "koen",
    "men",
    "identitetskort",
    # Sundhedskort satır kalıntıları (saha 10 Eyl 2026): 'Sikr. 1' / 'Gyldigt
    # fra:' satırı ad penceresinin altına sızıp SON HARF satırı sanılıyordu —
    # 'Sikr.' AD olarak dönüyordu. Başlık/kurum sözcükleri de aynı listede:
    # 'SUNDHEDSKORT' başlığı yalnız başına adres penceresine düşünce DEĞER
    # olmamalı (hepsi-etiket kuralı aşağıda).
    "sikr",
    "sikkerhedsgruppe",
    "gyldigt",
    "gyldig",
    "fra",
    "akuttelefonen",
    "kommune",
    "hovedstaden",
}


@dataclass(frozen=True, slots=True)
class OcrWord:
    """Tek OCR kelimesi: metin, güven ve hizalanmış bbox (x0, y0, x1, y1)."""

    text: str
    score: float
    box: tuple[int, int, int, int]

    @property
    def center_x(self) -> float:
        return (self.box[0] + self.box[2]) / 2.0

    @property
    def center_y(self) -> float:
        return (self.box[1] + self.box[3]) / 2.0

    @property
    def height(self) -> float:
        return max(1.0, float(self.box[3] - self.box[1]))


@dataclass(slots=True)
class LocalField:
    """Yerel katmandan çıkan tek alan (henüz IdentityFieldOut'a çevrilmedi)."""

    value: str
    confidence: float
    roi_key: str
    checksum_ok: bool


@dataclass(slots=True)
class LocalParseResult:
    """Parse katmanının toplam çıktısı + teşhis sinyalleri."""

    document_type: str | None          # şema değeri (driver_license, ...)
    document_type_key: str | None      # ROI tablosu anahtarı (koerekort, ...)
    fields: dict[str, LocalField] = dc_field(default_factory=dict)
    ocr_text: str = ""
    roi_fields: list[str] = dc_field(default_factory=list)
    rois_enabled: bool = False
    low_confidence: bool = False
    mod11_failed_soft: bool = False


# ---------------------------------------------------------------------------
# Kelime geometrisi
# ---------------------------------------------------------------------------


def group_words_into_lines(
    words: list[OcrWord], *, y_overlap_ratio: float = LINE_Y_OVERLAP_RATIO
) -> list[list[OcrWord]]:
    """Kelime kutularını satırlara birleştirir (y-örtüşme > %60 aynı satır).

    ROI tablosu kaba pencereler verdiği için aynı basılı satır birden çok
    kelimeye bölünebilir; satır birleştirme okuma sırasını (soldan sağa,
    yukarıdan aşağı) geri kazandırır.
    """
    lines: list[list[OcrWord]] = []
    for word in sorted(words, key=lambda w: (w.center_y, w.center_x)):
        target = None
        for line in lines:
            line_top = min(item.box[1] for item in line)
            line_bottom = max(item.box[3] for item in line)
            overlap = min(line_bottom, word.box[3]) - max(line_top, word.box[1])
            shortest = min(word.height, max(1.0, line_bottom - line_top))
            if shortest > 0 and (overlap / shortest) >= y_overlap_ratio:
                target = line
                break
        if target is None:
            lines.append([word])
        else:
            target.append(word)
    for line in lines:
        line.sort(key=lambda w: w.center_x)
    lines.sort(key=lambda line: min(word.center_y for word in line))
    return lines


def words_in_roi(
    words: list[OcrWord],
    roi: FieldRoi,
    canvas: tuple[int, int] = CANVAS,
) -> list[OcrWord]:
    """Merkezi ROI penceresinin içinde kalan kelimeler (okuma sırasıyla).

    ``canvas`` kelimelerin GELDİĞİ görüntünün (genişlik, yükseklik)sidir:
    ROI tablosu normalize olduğundan hem warp tuvali hem flatbed karesi
    kendi boyutlarıyla eşlenir — sabit tuval kullanılırsa flatbed taramada
    pencereler kayar (0.3.39 düzeltmesi).
    """
    """Merkezi ROI penceresinin içinde kalan kelimeler (okuma sırasıyla)."""
    width, height = canvas
    x0, x1 = roi.x * width, (roi.x + roi.w) * width
    y0, y1 = roi.y * height, (roi.y + roi.h) * height
    inside = [
        word
        for word in words
        if x0 <= word.center_x <= x1 and y0 <= word.center_y <= y1
    ]
    ordered: list[OcrWord] = []
    for line in group_words_into_lines(inside):
        ordered.extend(line)
    return ordered


def estimate_skew_deg(words: list[OcrWord], canvas: tuple[int, int], *, strict: bool = False) -> float:
    """Kalan eğimi kelime merkezlerinden İZDÜŞÜM ARAMASIYLA kestirir.

    Satır-eğimi kestirimi (grupla → satır eğimlerinin ortancası) ölür
    nokta: 5-6° eğik kartta gruplama ZATEN satırları yanlış birleştirir ve
    birleşik satırın eğimi ~0 görünür (saha deneyi: 5° kartta 0.2° ölçtü).
    Kestirim bu yüzden gruplamadan BAĞIMSIZdır: aday açılar (-9.5..+9.5°,
    0.25° adım) denenir, kelimeler adayın TERSİNE çevrilince AYNI satırda
    olan (yatayda uzak) kelime çiftlerinin Δy'si sıfıra iner — izdüşüm
    yoğunluğunu (Gaussian çekirdek, yatay uzaklıkla ağırlıklı: yakın çiftler
    her açıda kümelenir, bilgi taşımaz) en yüksek yapan açı kalan eğimdir.
    Kelime/çift azsa 0 döner (düz karta dokunma).

    ``strict=True`` WARP yapılmış kare içindir: dörtgen perspektif düzeltmesi
    eğimin çoğunu gidermiştir — ±5° üstü 'ölçüm' yanılgıdır ve skorun düz
    hipotezden 1.8x belirgin iyi olması gerekir (ölçüm 10 Eyl 2026: gerçek
    artık eğim +2.75°/oran 3.3 geçer; blur yanlış-pozitifi +9.0°/oran 1.4
    düşer).
    """
    if len(words) < 4 or len(words) > SKEW_MAX_WORDS:
        return 0.0
    width, _height = canvas
    # Yatayda ≥%15 aralıkli çiftler eğim taşır; ağırlık %30 genişlikte doyar.
    pairs: list[tuple[float, float, float]] = []
    for i in range(len(words)):
        for j in range(i + 1, len(words)):
            dx = words[j].center_x - words[i].center_x
            if abs(dx) < 0.15 * width:
                continue
            if max(words[i].height, words[j].height) > SKEW_PAIR_HEIGHT_RATIO * min(words[i].height, words[j].height):
                continue
            dy = words[j].center_y - words[i].center_y
            pairs.append((dx, dy, min(abs(dx) / (0.3 * width), 1.0)))
    if not pairs:
        return 0.0
    heights = sorted(word.height for word in words)
    band = 0.5 * heights[len(heights) // 2]
    if band <= 0.0:
        return 0.0
    # Adaylar |derece| küçüktür sırasıyla: skor eşitliğinde küçük açı kazanır
    # (0.25°'lik sahte tepeler yerine düz kart 0'da kalır).
    candidates: list[float] = []
    for magnitude in range(0, 39):  # 0, ±0.25, ..., ±9.5
        if magnitude == 0:
            candidates.append(0.0)
        else:
            candidates.append(magnitude * 0.25)
            candidates.append(-magnitude * 0.25)
    best_deg = 0.0
    best_score = None
    best_support = 0
    flat_score = 0.0
    for degrees in candidates:
        radians = math.radians(degrees)
        sin_a = math.sin(radians)
        cos_a = math.cos(radians)
        score = 0.0
        support = 0
        for dx, dy, weight in pairs:
            delta = dy * cos_a - dx * sin_a
            if abs(delta) <= band:
                support += 1  # çift bu açıda 'aynı satırda' sayılır
            score += weight * math.exp(-((delta / band) ** 2))
        if degrees == 0.0:
            flat_score = score  # düz hipotez — marj kapısının referansı
        if best_score is None or score > best_score:
            best_score, best_deg, best_support = score, degrees, support
    # Tek çiftin hizalanması gürültüdür (yuvarlama kaynaklı 0.25-0.75° sahte
    # tepe: düz kartta A-B çifti 0.5°'de 'daha iyi' görünür). Gerçek eğim
    # birden çok satır çiftini birlikte hizalar VE düz hipotezden belirgin
    # iyileşme getirir — ikisi de yoksa karta dokunma. Sıkı kapı (warp sonrası)
    # açıyı da ±5°'e kısar: quad düzelttikten sonra 9° 'kalıntı' okunamaz.
    if best_deg == 0.0 or best_support < 2:
        return 0.0
    max_deg = SKEW_WARPED_MAX_DEG if strict else SKEW_MAX_DEG
    min_gain = SKEW_WARPED_IMPROVEMENT if strict else SKEW_IMPROVEMENT_FACTOR
    if abs(best_deg) > max_deg:
        return 0.0
    if flat_score > 0.0 and best_score < min_gain * flat_score:
        return 0.0
    return best_deg


def deskew_words(words: list[OcrWord], canvas: tuple[int, int], *, strict: bool = False) -> list[OcrWord]:
    """Kelime MERKEZLERİNİ kalan eğimin tersine döndürür (görüntüye dokunmaz).

    Warp kusuru veya eğik flatbed yerleşimi 2-6° kalıntı bırakınca satır
    gruplama yanlış satırları birleştiriyor ve ROI pencereleri bir alt/üst
    satırı kesiyordu. Kelime kutuları zaten OKUNMUŞ metindir: geometriyi
    düzeltmek için merkezleri döndürmek yeter — ikinci bir OCR yok.
    ``strict`` warp sonrası kalan eğim için sıkı kestirim kapısıdır.
    """
    degrees = estimate_skew_deg(words, canvas, strict=strict)
    if not (SKEW_MIN_DEG <= abs(degrees) <= SKEW_MAX_DEG):
        return words
    radians = math.radians(-degrees)
    cos_a = math.cos(radians)
    sin_a = math.sin(radians)
    width, height = canvas
    center_x = width / 2.0
    center_y = height / 2.0
    rotated: list[OcrWord] = []
    for word in words:
        dx = word.center_x - center_x
        dy = word.center_y - center_y
        new_x = center_x + dx * cos_a - dy * sin_a
        new_y = center_y + dx * sin_a + dy * cos_a
        half_w = (word.box[2] - word.box[0]) / 2.0
        half_h = (word.box[3] - word.box[1]) / 2.0
        rotated.append(
            OcrWord(
                text=word.text,
                score=word.score,
                box=(
                    int(round(new_x - half_w)),
                    int(round(new_y - half_h)),
                    int(round(new_x + half_w)),
                    int(round(new_y + half_h)),
                ),
            )
        )
    return rotated


def build_ocr_text(words: list[OcrWord]) -> str:
    """Tam-kart metni: satır birleştirme + yeniyle ayrılmış satırlar.

    ROI alan getiremezse frontend'in regex zinciri BU metin üzerinde koşar
    (D5 geri dönüşü) — bu yüzden ham okuma sırası korunur, ek yorum yok.
    """
    return "\n".join(" ".join(word.text for word in line) for line in group_words_into_lines(words)).strip()


# ---------------------------------------------------------------------------
# Belge tipi tahmini
# ---------------------------------------------------------------------------


def guess_document_type(words: list[OcrWord]) -> str | None:
    """ROI tablosu anahtarını kart metninden tahmin eder (yoksa None).

    Etiketler translitere edilerek karşılaştırılır (Ø→OE) — motor bazı
    kartlarda özel karakterleri yanlış okuyabilir, bu yüzden dayanıklıdır.
    Önce açık kart adına bakılır; MRZ ('<<') ancak başka ipucu yoksa pas
    sayılır (id-kortun da MRZ'si vardır, onu pas sanmamak için).
    """
    text = transliterate_name(build_ocr_text(words)) or ""
    # Bulanık karelerde 'Kørekortnr.' 'Kerekortnr.' okunabilir (ø→e), başlık
    # 'KOREKORT' olabilir (ø→O, saha 13 Eyl 2026 repro'sunda tip=null
    # üretiyordu): koerekort çapası üç yazımla da aranır — yoksa satırın
    # 'kortnr' kalıntısı kartı id-kort sanıp yanlış ROI tablosuna sokar.
    if (
        "koerekort" in text
        or "kerekort" in text
        or "korekort" in text
        or "udlobsdato" in text
        or "udstedelsesdato" in text
    ):
        return "koerekort"
    if "sundhedskort" in text or "sygesikringsbevis" in text or "sygesikringskort" in text:
        return "sundhedskort"
    if "idkort" in text or "kortnr" in text:
        return "idkort"
    if "pasnr" in text or "passport" in text or "p<" in text or "<<" in text:
        return "pas"
    return None


def document_type_value(key: str | None) -> str | None:
    """ROI anahtarı → şema document_type değeri (bilinmiyorsa None)."""
    if not key:
        return None
    return DOCUMENT_TYPE_BY_ROI_KEY.get(key)


# ---------------------------------------------------------------------------
# Alan çıkarımı
# ---------------------------------------------------------------------------


def _scope_text(words: list[OcrWord]) -> str:
    return " ".join(word.text for word in words).strip()


def _scope_confidence(words: list[OcrWord]) -> float:
    if not words:
        return 0.0
    return min(max(0.0, min(word.score for word in words)), 1.0)


def _drop_label_tokens(words: list[OcrWord], *, numeric: bool = False) -> list[OcrWord]:
    """Basılı alan etiketlerini düşürür; hepsi etiketse BOŞ döner.

    Pencereye yalnız etiket düştüyse ('SUNDHEDSKORT' başlığı adres penceresine
    sızmışsa) o etiketleri DEĞER olarak geri iade etmek yok: saha taramasında
    'SUNDHEDSKORT' adres olarak doğrulanmış sunuluyordu (10 Eyl 2026). Boş
    kapsam → alan üretilmez; operatör tam-kart metninden bakar.

    ``numeric=True`` rakam-beklenen pencereler içindir: etiketlerin yanı sıra
    rakam taşımayan ve 2 karakterden kısa alnum token'lar da atılır ("4a.",
    "5.", "Fødselsdato") — bunlar rakam dizilerini bozar (ör. "5. Kørekortnr.
    DK1000099" → "1000099" yanılgısı). Değer token'ları (CPR 10 hane,
    DK1000099) asla etkilenmez.
    """
    kept = [
        word
        for word in words
        if re.search(r"[A-Za-z0-9]", word.text)  # '·', '—' gibi noktalamalar değer değildir
        and not _is_label_token(word.text)
        and not (numeric and not _looks_like_numeric_value(word.text))
    ]
    return kept


# Yanlis-okuma etiket aileleri (saha 13 Eyl 2026): motor 'Sikr.'yi 'Sik.',
# 'fra'yi 'frac' okuyunca birebir eslesme dusuruyor, cop DEGER olarak
# kaliyordu. Bu kume uzerinde Levenshtein <=1 kabul edilir; kisa/carpismali
# sozcukler (til/og/by/er/nr) BILINCLI olarak yok — 'Frk' gibi gercek kisa
# kelimeleri yanlis dusurmemek icin.
_FUZZY_LABEL_KEYS = (
    "sikr",
    "sikkerhedsgruppe",
    "gyldigt",
    "gyldig",
    "fra",
    "laege",
    "laegehuset",
    "kommune",
    "hovedstaden",
    "sundhedskort",
    "sygesikringsbevis",
    "akuttelefonen",
)


def _within_edit_distance_one(a: str, b: str) -> bool:
    """Iki kisa string arasinda Levenshtein uzakligi 1 mi? (bagimlilik yok)"""
    if a == b:
        return True
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(1 for x, y in zip(a, b) if x != y) == 1
    if len(a) > len(b):
        a, b = b, a
    for i in range(len(b)):
        if a == b[:i] + b[i + 1 :]:
            return True
    return False


def _is_label_token(token: str) -> bool:
    """Token bir basılı ETİKET mi? Rakam taşıyan token asla etiket sayılmaz.

    Rakam şartı kritiktir: transliterasyon sonrası "DK1000099" → "dk" anahtarı
    'DK' filigran etiketiyle çakışır ve gerçek numara etiket sanılıp düşer.

    Bulanik dal (13 Eyl 2026): birebir eslesme yoksa, token UZUN (>=4) veya
    NOKTALAMALI ise ('Sik.') yanlis-okuma ailesine Levenshtein <=1 mesafede
    olan anahtarlar da etiket sayilir. Kisa ciplak kelimeler ('Frk')
    bilincli olarak haric.
    """
    if any(ch.isdigit() for ch in token):
        return False
    key = _label_key(token)
    if not key:
        return False
    if key in _LABEL_TOKENS:
        return True
    if len(key) >= 3 and (len(token) >= 4 or any(not ch.isalnum() for ch in token)):
        return any(_within_edit_distance_one(key, candidate) for candidate in _FUZZY_LABEL_KEYS)
    return False


def _looks_like_numeric_value(token: str) -> bool:
    cleaned = re.sub(r"[^A-Za-z0-9]", "", token)
    if len(cleaned) <= 2:  # alan no etiketleri: "1.", "4a", "5."
        return False
    return any(ch.isdigit() for ch in cleaned)


def _alpha_words(words: list[OcrWord]) -> list[OcrWord]:
    return [word for word in words if _is_name_token(word.text)]


def _last_alpha_line(words: list[OcrWord]) -> list[OcrWord]:
    """Ad penceresindeki SON harf satırı.

    Sundhedskort gerçek düzeninde adın ÜSTÜNDE kurum/klinika satırları
    olabilir (læge bloğu kartın üstünde); ad, adres satırının hemen
    üstündeki en alt harf satırıdır. Etiket düşürme bu çağrıdan ÖNCE
    yapılır ki yalnız etiketten ibaret satır ("Navn") son satır sanılmasın.
    """
    for line in reversed(group_words_into_lines(words)):
        alpha = _alpha_words(line)
        if alpha:
            return alpha
    return []


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


def _extract_date(text: str) -> str:
    """Penceredeki SON tarihi 'dd.mm.yyyy' biçiminde döner.

    Son eşleşme bilinçli seçimdir: 4a (Udstedt) 4b'nin (Gyldig til)
    SOLUNDADIR ve cömert paylı pencere ikisini de kesebilir — okuma
    sırasındaki son tarih 4b'ninkidir. Ay/gün aralık kontrolü sahte
    eşleşmeyi ('ay 15') reddeder.
    """
    best = ""
    for match in _DATE_RE.finditer(repair_numeric_confusables(text)):
        day, month, year = match.group(1), match.group(2), match.group(3)
        if day is None:  # ISO kolu: (yyyy, mm, dd)
            year, month, day = match.group(4), match.group(5), match.group(6)
        if not (1 <= int(month) <= 12 and 1 <= int(day) <= 31):
            continue
        best = f"{day.zfill(2)}.{month.zfill(2)}.{year}"
    return best


def _extract_cpr(text: str) -> tuple[str, bool]:
    """CPR adayı: 10 hane (9 hane = administrativt numaralar, checksum'suz).

    Dönüş: (değer, biçim_ok). Onarım yalnız rakam-karışıklığı üzerinedir
    (O→0, I→1) — serbest metne ASLA uygulanmaz.
    """
    repaired = repair_numeric_confusables(text)
    runs = _digit_runs(repaired)
    for run in runs:
        if len(run) == 10:
            return run, True
    # Kartta standart basım "DDMMYY-XXXX"tir: tire OCR'da boşluk/nokta da
    # olabilir — ardışık 6+4 parça birleşimi tek CPR'dır (biçimok). Yalnız
    # TAM İKİ run değil HER ardışık çift taranır: alan-no öneki ("4d.") ve
    # pencereye sızmış komşu rakamlar run sayısını 3+ yapar (saha 13 Eyl
    # 2026: "4d.200485-2985" → ["4","200485","2985"] tam-2 kuralında ölüyordu).
    for i in range(len(runs) - 1):
        if len(runs[i]) == 6 and len(runs[i + 1]) == 4:
            return runs[i] + runs[i + 1], True
    # Administrativt nummer (CPR yok) KESİNTİSİZ tek run'dır: ayrı run'ların
    # birleşimi (barkod no + koşul no gibi) 9 haneye ulaşsa da numara değildir.
    if len(runs) == 1 and len(runs[0]) == 9:
        return runs[0], False
    return "", False


def _split_glued_row_prefix(token: str) -> str:
    """Yapışık alan-no önekini değerden ayırır: '4b.2055-04-20' → '2055-04-20',
    '5.30499459' → '30499459'. Önek yoksa token olduğu gibi döner. TAM TARİH
    ('14.03.2031') bölünmez — gün sayısı önek sanılamaz."""
    if re.fullmatch(r"\d{1,2}[.:]\d{1,2}[.:]\d{4}", token):
        return token
    match = re.match(r"^\d{1,2}[a-dA-D]?[.:]\s*(.+)$", token)
    return match.group(1) if match else token


def _extract_doc_number(text: str) -> tuple[str, bool]:
    """Kørekort/kort numarası: yeni Danish kartta 8 hane; eski/yabancı biçim
    harf+rakam karışımı 8-11 karakter (ör. DK1000099, ID1000066).

    Onarım (O→0, I→1) YALNIZ tamamen rakam olan sonuca uygulanır: "ID1000066"
    gibi gerçek harfli numarada I harfi rakama çevrilirse numara bozulur.

    Biçim dışı metin (etiket-value karışımı gibi) ALAN OLARAK DÖNMEZ: yanlış
    doc_number'ı needs_review ile sunmaktan iyidir hiç sunmamamak — operatör
    tam-kart metninden (ocr_text) bakar.
    """
    # 4a/4b tarih satırları 5 penceresine taşabilir: gg.aa.yyyy VEYA ISO
    # yyyy-aa-gg token'ı noktaları sökülünce 8 hane kalır da belge no sanılır
    # — önce yapışık alan-no öneki ayrılır ('4b.2055-04-20', saha 13 Eyl
    # 2026), sonra iki sıralı tarih de çıkarılır.
    text = " ".join(_split_glued_row_prefix(token) for token in text.split())
    text = re.sub(
        r"\d{1,2}[.\-/\s]\d{1,2}[.\-/\s]\d{4}|\d{4}[.\-/\s]\d{1,2}[.\-/\s]\d{1,2}",
        " ",
        text,
    )
    # 4d (CPR) satırı 5 penceresine taşabilir: CPR ÖRÜNTÜSÜ belge no değildir
    # (saf 10 hane reddi ayrıca aşağıda; burada önekli/kesikli biçim de süpürülür).
    text = re.sub(r"\b\d{6}[-. ]\d{4}\b|\b\d{10}\b", " ", text)
    compact = re.sub(r"[^A-Z0-9]", "", text.upper())
    repaired = re.sub(r"[^A-Z0-9]", "", repair_numeric_confusables(compact))
    if re.fullmatch(r"\d{8}", repaired):
        return repaired, True
    # Saf 10-11 rakam CPR/TCKN biçimidir: 4d ROI penceresi belge-no alanıyla
    # örtüşebilir — CPR'ın kendisi belge no olarak ÇOĞALTILMASIN (reddet;
    # operatör tam-kart metninden bakar).
    if re.fullmatch(r"\d{10,11}", compact):
        return "", False
    has_letter = any(ch.isalpha() for ch in compact)
    has_digit = any(ch.isdigit() for ch in compact)
    if has_letter and has_digit and re.fullmatch(r"[A-Z0-9]{8,11}", compact):
        # Harf + rakam karışımı (Danish id-kort / kørekort numarası biçimi).
        return compact, True
    if dk_licence_number_ok(compact):
        return compact, True
    return "", False


def _extract_postal(text: str) -> tuple[str, str]:
    """Posta kodu + şehir: ilk 4 hane kod, kalan harf kelimeleri şehir.

    Kod ONARILMIŞ metinde aranır (OCR '265O' yazmış olabilir); şehir kuyruğu
    ise ÖZGÜN metinden alınır — onarım 'Hvidovre'yi 'Hvid0vre'ye çevirir ve
    şehir adı bozulur (onarım karakter-sayısını korur, indeksler hizalıdır).
    """
    repaired = repair_numeric_confusables(text)
    postal_match = _POSTAL_RE.search(repaired)
    if postal_match is None:
        return "", text.strip()
    postal = postal_match.group(1)
    tail = text[postal_match.end():]
    city = " ".join(token for token in tail.split() if _is_name_token(token))
    return postal, city.strip()


# Semantik kapilar (saha 13 Eyl 2026): serbest metin alanlarina baska
# satirlardan sizan CPR/tarih kalintilari 'DOGRULANDI' rozetiyle donuyordu
# ('Adres: 200485-2985 g: Sik. 1 Gyldigt frac'). Kapidan gecemeyen deger
# ALAN OLMAZ — bos alan nofields tetigini acar, VLM kurtarma yolu devreye
# girer; yanlis-dolu + dogrulanmis degerden iyidir.
_CPR_TEXT_RE = re.compile(r"\b\d{6}[-.]?\d{4}\b|\b\d{10}\b")
_DATE_TOKEN_RE = re.compile(
    r"^\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4}$|^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}$"
)


def _strip_semantic_junk(text: str) -> str:
    """Serbest metinden CPR/tarih kalintilarini ve kirinti token'lari supurur.

    Ev/kapi numarasi gibi kisa RAKAMLI token'lar ('2.', '47', '1') yasar;
    rakam tasimayan <=1 alnum karakterliler ('g:'), CPR desenliler ve tarih
    desenliler duser.
    """
    kept: list[str] = []
    for token in text.split():
        if _CPR_TEXT_RE.search(token):
            continue
        if _DATE_TOKEN_RE.match(token.strip(".,:;")):
            continue
        alnum = re.sub(r"[^A-Za-z0-9]", "", token)
        if len(alnum) < 2 and not any(ch.isdigit() for ch in token):
            continue
        kept.append(token)
    return " ".join(kept)


def _is_plausible_address(text: str) -> bool:
    """Adres kalitesi kapisı: >=2 token ve >=1 sokak-adi benzeri (>=2 harf)
    token — kalanı yalnız rakam kirintisi olan satır adres değildir."""
    tokens = text.split()
    if len(tokens) < 2:
        return False
    return any(sum(ch.isalpha() for ch in token) >= 2 for token in tokens)


def _gate_name_text(text: str) -> str:
    """Ad kapisi: yalniz >=2 harfli, rakamsiz token'lar ad olabilir."""
    kept: list[str] = []
    for token in _strip_semantic_junk(text).split():
        cleaned = token.strip(".,:;")
        alpha = sum(1 for ch in cleaned if ch.isalpha())
        if alpha >= 2 and not any(ch.isdigit() for ch in cleaned):
            kept.append(token)
    return " ".join(kept)


def _looks_like_postal_line(text: str) -> bool:
    """Satir 'dddd SehirAdi' posta satiri mi? ('1813 AKUTTELEFONEN' degil)."""
    tokens = _strip_semantic_junk(text).split()
    if not tokens:
        return False
    first = repair_numeric_confusables(tokens[0])
    return bool(re.fullmatch(r"\d{4}", first)) and any(_is_name_token(t) for t in tokens[1:])


def _compose_koerekort(raw: dict[str, tuple[str, float]]) -> dict[str, LocalField]:
    fields: dict[str, LocalField] = {}

    given, given_conf = raw.get("2", ("", 0.0))
    surname, surname_conf = raw.get("1", ("", 0.0))
    parts = [
        (part, conf)
        for part, conf in ((given.strip(), given_conf), (surname.strip(), surname_conf))
        if part
    ]
    full_name = " ".join(part for part, _ in parts).strip()
    if full_name:
        # Basılı sıra "given surname"dir (1=soyad, 2=ad) — frontend eşleştirme
        # anahtarı translitere edilerek karşılaştırılır, görüntülenen ad bu.
        # Güven YALNIZ mevcut parçaların min'idir: eski 'min or max' kalıbı
        # eksik parçada (conf 0.0 falsy) yüksek max'ı basıp tek parçalı adı
        # DOĞRULUYORDU (saha 13 Eyl 2026). Tek parçalı ad eksik bilgidir —
        # checksum kapısı needs_review düşürür.
        fields["full_name"] = LocalField(
            value=full_name,
            confidence=min(conf for _, conf in parts),
            roi_key="1+2",
            checksum_ok=len(parts) == 2,
        )

    birth_text, birth_conf = raw.get("3", ("", 0.0))
    birth = _extract_date(birth_text)
    if birth:
        fields["birth_date"] = LocalField(
            value=birth,
            confidence=birth_conf,
            roi_key="3",
            checksum_ok=bool(re.match(r"^\d{2}\.\d{2}\.\d{4}$", birth)),
        )

    cpr_text, cpr_conf = raw.get("4d", ("", 0.0))
    cpr, cpr_format_ok = _extract_cpr(cpr_text)
    if cpr:
        _format_ok, mod11_ok, _reason = validate_cpr(cpr)
        fields["cpr_number"] = LocalField(
            value=cpr,
            confidence=cpr_conf,
            roi_key="4d",
            checksum_ok=cpr_format_ok and bool(mod11_ok),
        )

    doc_text, doc_conf = raw.get("5", ("", 0.0))
    doc_number, doc_ok = _extract_doc_number(doc_text)
    if doc_number:
        fields["doc_number"] = LocalField(
            value=doc_number, confidence=doc_conf, roi_key="5", checksum_ok=doc_ok
        )

    expiry_text, expiry_conf = raw.get("4b", ("", 0.0))
    expiry = _extract_date(expiry_text)
    if expiry:
        fields["expiry_date"] = LocalField(
            value=expiry,
            confidence=expiry_conf,
            roi_key="4b",
            checksum_ok=bool(re.match(r"^\d{2}\.\d{2}\.\d{4}$", expiry)),
        )
    return fields


def _cpr_birth_date(cpr: str) -> str:
    """CPR'ın DDMMYY bölümünden doğum tarihi (sundhedskort ayrı doğum satırı
    basmaz — karttaki tek doğum kaynağı CPR'ın kendisidir).

    Yüzyıl kestirimi _mrz_yymmdd ile aynı kuraldır: yy > 30 → 19xx.
    """
    if re.fullmatch(r"\d{10}", cpr) is None:
        return ""
    dd, mm, yy = cpr[0:2], cpr[2:4], cpr[4:6]
    century = "19" if int(yy) > 30 else "20"
    return f"{dd}.{mm}.{century}{yy}"


def _compose_sundhedskort(raw: dict[str, tuple[str, float]]) -> dict[str, LocalField]:
    fields: dict[str, LocalField] = {}

    name_text, name_conf = raw.get("name", ("", 0.0))
    # Semantik kapi (saha 13 Eyl 2026): CPR/tarih/kirinti sizmis 'ad'
    # ('g: Sik.') bosalir — alan uretilmez; nofields tetigi VLM kurtarma
    # yolunu acar, yanlis-dolu dogrulanmis degerden iyidir.
    name_text = _gate_name_text(name_text)
    if name_text:
        fields["full_name"] = LocalField(
            value=name_text, confidence=name_conf, roi_key="name", checksum_ok=True
        )

    cpr_text, cpr_conf = raw.get("cpr", ("", 0.0))
    cpr, cpr_format_ok = _extract_cpr(cpr_text)
    if cpr:
        _format_ok, mod11_ok, _reason = validate_cpr(cpr)
        fields["cpr_number"] = LocalField(
            value=cpr,
            confidence=cpr_conf,
            roi_key="cpr",
            checksum_ok=cpr_format_ok and bool(mod11_ok),
        )
        # Doğum tarihi kartta ayrı basılmaz; CPR'ın DDMMYY bölümü ZATEN doğum
        # tarihidir (VLM/barkod birleşiminde de tutarlılık kontrolü bunu kullanır).
        birth = _cpr_birth_date(cpr)
        if birth and cpr_format_ok:
            fields["birth_date"] = LocalField(
                value=birth,
                confidence=cpr_conf,
                roi_key="cpr",
                checksum_ok=cpr_format_ok,
            )

    postal_text, postal_conf = raw.get("postal", ("", 0.0))
    postal, city = _extract_postal(postal_text)

    address_text, address_conf = raw.get("address", ("", 0.0))
    if address_text and postal_text:
        # Adres penceresinin alt kenarı ALTINDAKİ posta satırının başını
        # ('2650') kesebilir (marjlı flatbed kadrajında tüm içerik pencereye
        # göre ~%7 kayar). Adresin KUYRUĞUNDAKI, posta metninin BAŞ token'ı
        #yla aynı olan token'lar düşürülür — ev numarasıyla çakışma riski
        # önemsizdir ('Hvidovrevej 2650' + posta 2650 aynı anda görülmez).
        postal_lead = postal_text.split()[0] if postal_text.split() else ""
        tokens = address_text.split()
        while postal_lead and tokens and tokens[-1] == postal_lead:
            tokens.pop()
        address_text = " ".join(tokens)
    if address_text and name_text:
        # Eğik taramada ad satırı adres satırıyla birleşebilir (satır
        # gruplaması aynı hizada sayar) ve ad token'ları adrese sızar
        # ('Thomas Hvidovrevej ...'). Ad penceresinden çıkan adın
        # token'ları adresten düşürülür — tam eşleşme, transliterasyonlu
        # (Ø/Æ yazım farkı okuma değiştirebilir). Yalnız tam kelime
        # eşleşmesi: 'Jensen' düşer, 'Jensenvej' düşmez.
        def _token_key(token: str) -> str:
            return re.sub(r"[^a-z0-9]", "", transliterate_name(token).lower())

        name_keys = {_token_key(token) for token in name_text.split()}
        kept = [
            token
            for token in address_text.split()
            if not _token_key(token) or _token_key(token) not in name_keys
        ]
        address_text = " ".join(kept).strip()
    # Semantik kapi: CPR satiri kalintisi ('200485-2985 g: Sik. 1 Gyldigt
    # frac') supurulunce adres kalitesi kapisini gecemeyen deger uretilmez.
    address_text = _strip_semantic_junk(address_text)
    if _is_plausible_address(address_text):
        fields["address"] = LocalField(
            value=address_text, confidence=address_conf, roi_key="address", checksum_ok=True
        )
    if postal:
        fields["postal_code"] = LocalField(
            value=postal,
            confidence=postal_conf,
            roi_key="postal",
            checksum_ok=bool(re.fullmatch(r"\d{4}", postal)),
        )
    if city:
        fields["city"] = LocalField(
            value=city, confidence=postal_conf, roi_key="postal", checksum_ok=True
        )
    return fields


_MRZ_LINE_RE = re.compile(r"^[A-Z0-9<]{30,}$")
_MRZ_HEADER_RE = re.compile(r"^[A-Z]{1,2}<")


def _mrz_yymmdd(raw: str, *, future: bool = False) -> str:
    """MRZ YYMMDD alanını 'dd.mm.yyyy' biçimine çevirir.

    Yüzyıl kestirimi alan türüne göre değişir: doğum tarihi geçmişte
    (yy > 30 → 19xx), son geçerlilik tarihi gelecekte (yy ≤ 69 → 20xx).
    """
    if not re.fullmatch(r"\d{6}", raw):
        return ""
    yy, mm, dd = raw[0:2], raw[2:4], raw[4:6]
    century = ("20" if int(yy) <= 69 else "19") if future else ("19" if int(yy) > 30 else "20")
    return f"{dd}.{mm}.{century}{yy}"


def _extract_mrz(lines: list[str]) -> dict[str, LocalField] | None:
    """MRZ satırlarını (TD3 iki satır / TD1 üç satır) alanlara çevirir.

    - TD3 (pas): satır1 'P<DNKSOYAD<<AD<AD<<<' (ad alanı 5. indexte başlar),
      satır2 doküman no + doğum (13-18) + son geçerlilik (21-26).
    - TD1 (id-kort): satır1 tip+ülke+doküman no (5-13), satır2 doğum (0-5) +
      son geçerlilik (8-13), satır3 ad.

    MRZ zaten transliteratedir (Æ→AE) — basılı adla birebir eşleşmez; bu
    yüzden basılı ad penceresi doluysa MRZ adı EZMEZ (fixture notundaki kural).
    """
    mrz_lines = [line.replace(" ", "").upper() for line in lines if _MRZ_LINE_RE.match(line.replace(" ", "").upper())]
    if len(mrz_lines) < 2:
        return None

    fields: dict[str, LocalField] = {}

    if len(mrz_lines) >= 3:
        doc_line, data_line, name_line = mrz_lines[-3], mrz_lines[-2], mrz_lines[-1]
        data = data_line[1:] if data_line.startswith("<") else data_line
        doc_number = doc_line[5:14].replace("<", "")
        birth_raw, expiry_raw = data[0:6], data[8:14]
    else:
        # TD3 (pas): 1. satır "P<DNKTESTSEN<<ANDERS<<…" — ad alanı belge
        # kodu/veren ülke sonrası (5. karakterden itibaren) başlar. Başlık
        # bütün bölünürse "P DNK" ad alanına sızardı.
        header = mrz_lines[0]
        name_line = header[5:] if _MRZ_HEADER_RE.match(header) else header
        data_line = mrz_lines[1]
        doc_number = data_line[:9].replace("<", "")
        birth_raw, expiry_raw = data_line[13:19], data_line[21:27]

    if "<<" in name_line:
        surname, given = name_line.split("<<", 1)
    else:
        surname, given = name_line, ""
    full_name = " ".join(
        part.strip()
        for part in (given.replace("<", " "), surname.replace("<", " "))
        if part.strip()
    ).strip()
    if full_name:
        fields["full_name"] = LocalField(
            value=re.sub(r"\s+", " ", full_name),
            confidence=0.9,
            roi_key="mrz",
            checksum_ok=True,
        )

    if doc_number:
        fields["doc_number"] = LocalField(
            value=doc_number, confidence=0.9, roi_key="mrz", checksum_ok=True
        )

    birth = _mrz_yymmdd(birth_raw)
    if birth:
        fields["birth_date"] = LocalField(value=birth, confidence=0.9, roi_key="mrz", checksum_ok=True)
    expiry = _mrz_yymmdd(expiry_raw, future=True)
    if expiry:
        fields["expiry_date"] = LocalField(value=expiry, confidence=0.9, roi_key="mrz", checksum_ok=True)
    return fields or None


def _compose_pas(raw: dict[str, tuple[str, float]], mrz_lines: list[str]) -> dict[str, LocalField]:
    """Pas: basılı ad penceresi (PRØVE) MRZ adını (PROEVE) ezer; diğer alanlar
    MRZ'den gelir (checksum'lı, transliterasyon sorunu yok)."""
    printed = _compose_koerekort(raw)  # aynı 1/2/3 anahtar sözleşmesi
    fields = _extract_mrz(mrz_lines) or {}
    for name in ("full_name",):
        if name in printed:
            fields[name] = printed[name]
    for name in ("birth_date", "expiry_date", "doc_number"):
        if name not in fields and name in printed:
            fields[name] = printed[name]
    return fields


def _anchor_info(token: str) -> tuple[str, str] | None:
    """Satır başı alan-no çapası: '1.'/'2' → ('1', ''), değilse None.

    YAPIŞIK değerde ('1.Demir' → ('1', 'Demir')) değerin kendisi döner —
    saha 13 Eyl 2026: OCR çapayı değere yapıştırınca birebir regex çapayı
    düşürüyor, soyad hiç seçilmiyordu. Bulanık 'l.'/'I.' okuması 1'e
    onarılır. Kalıntı alfa içermiyorsa ('12.') çapa değildir.
    """
    text = token.strip()
    if text and text[0] in "lI|":
        text = "1" + text[1:]
    match = re.match(r"^([12])(?:[.:](.*))?$", text)
    if match is None:
        return None
    rest = (match.group(2) or "").strip()
    if rest and not any(ch.isalpha() for ch in rest):
        return None
    return match.group(1), rest


def _value_words(line: list[OcrWord]) -> list[OcrWord]:
    """Satırdaki DEĞER kelimeleri: çapa-sade kelimeler atılır, yapışık
    çapada ('1.Demir') yalnız değer kısmı kalır."""
    out: list[OcrWord] = []
    for word in line:
        info = _anchor_info(word.text)
        if info is None:
            out.append(word)
        elif info[1]:
            out.append(OcrWord(text=info[1], score=word.score, box=word.box))
    return out


def _split_koerekort_names(
    raw: dict[str, tuple[str, float]],
    words: list[OcrWord],
    rois: dict[str, tuple[FieldRoi, ...]],
    canvas: tuple[int, int],
) -> None:
    """Kørekort ad-soyadını alan-no ÇAPASINDAN ayrıştırır (raw["1"]/raw["2"]).

    Kart satır başına alan numarası basar ('1. Jensen', '2. Thomas'): pencereye
    başlık ('DANM ARK') ya da doğum yeri satırı sızsa da çapa satırı kesin
    seçer (saha 10 Eyl 2026: portre tarama warp kaymasında başlık, soyad
    sanılıyordu). Çapa okunamadıysa (bulanık çekim) konumsal kural — ilk iki
    harf satırı 1=soyad, 2=ad — yedek olarak kalır; 3.+ satırlar atılır.
    """
    name_row = next(
        (row for row in rois.get("koerekort", ()) if row.key == "1" and row.field == "full_name"),
        None,
    )
    if name_row is None:
        return
    scope = _drop_label_tokens(words_in_roi(words, name_row, canvas))
    lines = group_words_into_lines(scope)
    confidence = _scope_confidence(scope)
    # Çapa SATIR BAŞINDA aranmaz — eğik taramada iki alan satırı TEK satırda
    # birleşir ('1. Jensen 2. Thomas') ve '2.' çapası satır başına hiç
    # düşmez; ilk token'a bakmak birleşik dalı ölü kod bırakıyordu (0.3.40
    # incelemesi). Çapa satır içi HER konumda aranır.
    def anchor_at(anchor: str) -> tuple[int, int, str] | None:
        for i, line in enumerate(lines):
            for t, word in enumerate(line):
                info = _anchor_info(word.text)
                if info is not None and info[0] == anchor:
                    return i, t, info[1]
        return None

    a1 = anchor_at("1")
    a2 = anchor_at("2")
    if a1 is not None and a2 is not None and a1[0] <= a2[0]:
        if a1[0] == a2[0]:
            # İki alan TEK satırda birleşmiş ('1. Jensen 2. Thomas'): çapa
            # konumları arasından böl. YAPIŞIK çapada ('1.Jensen') değer
            # çapa kelimesinin içinde taşınır — kalıntı öne eklenir.
            tokens = [word.text for word in lines[a1[0]]]
            t1, t2 = a1[1], a2[1]
            surname_parts = ([a1[2]] if a1[2] else []) + tokens[t1 + 1 : t2]
            given_parts = ([a2[2]] if a2[2] else []) + tokens[t2 + 1 :]
            if surname_parts:
                raw["1"] = (" ".join(surname_parts), confidence)
            if given_parts:
                raw["2"] = (" ".join(given_parts), confidence)
            return
        # İki düzen: değer alan-no ile AYNI satırda ('1. Jensen') VEYA bir alt
        # satırda ('1. Efternavn' başlığı + 'TESTESEN'). Değer = çapa satırı
        # (boşsa hemen altındaki) ilk dolu harf satırı; soyad segmenti 2'nin
        # çapasıyla sınırlıdır — başlık ('DANM ARK') ve doğum yeri sızamaz.
        def first_alpha_text(segment: list[list[OcrWord]]) -> str:
            for line in segment:
                alpha = _alpha_words(_value_words(line))
                if alpha:
                    return _scope_text(alpha)
            return ""

        surname = first_alpha_text(lines[a1[0] : a1[0] + 2])
        given = first_alpha_text(lines[a2[0] : a2[0] + 2])
        if surname:
            raw["1"] = (surname, confidence)
        if given:
            raw["2"] = (given, confidence)
        return
    # Çapa yoksa (bulanık çekim): konumsal kural — ilk İKİ harf satırı
    # 1=soyad, 2=ad. TEK harf satırı kaldıysa hangi yuvaya ait olduğu
    # bilinemez: soyada yazmak tek-parça 'Ad: Recai' üretip soyadın hiç
    # dolmamasına yol açıyordu (saha 13 Eyl 2026) — yuvalar boş kalır,
    # full_name üretilmez, nofields tetiği VLM kurtarma yolunu açar.
    alpha_lines = [line for line in (_alpha_words(_value_words(line)) for line in lines) if line]
    if len(alpha_lines) >= 2:
        raw["1"] = (_scope_text(alpha_lines[0]), confidence)
        raw["2"] = (_scope_text(alpha_lines[1]), confidence)


def _split_sundhedskort_anchor(
    raw: dict[str, tuple[str, float]],
    words: list[OcrWord],
    rois: dict[str, tuple[FieldRoi, ...]],
    canvas: tuple[int, int],
) -> bool:
    """Sundhedskort alanlarını kartın kendi ÇAPA satırlarından seçer.

    Pencereler SPECIMEN düzenine kalibre; gerçek kartta læge bloğu tüm
    satırları aşağı kaydırır (ad CPR'ın ALTINDA, SPECIMEN'da ÜSTÜNDE —
    saha 13 Eyl 2026: 'g: Sik.' / CPR-sızmış adres / birleşik şehir).
    Pencere varsayımı yerine iki düzene de uyan tekil kural: CPR satırı
    (10 hane) bulunur; posta satırı (dddd + harf kuyruğu) onun altında
    aranır; ADRES ve AD posta satırından YUKARI taranır (CPR satırı
    atlanır — iki düzende de ad, adresin hemen üstündedir). Çapa bulunamazsa
    False döner ve pencere yolu yedek kalır.
    """
    rows = {row.key: row for row in rois.get("sundhedskort", ())}
    name_row = rows.get("name")
    address_row = rows.get("address")
    postal_row = rows.get("postal")
    if name_row is None or address_row is None or postal_row is None:
        return False
    width, height = canvas
    # Sol kolon: sağ kolon (1813/telefon/barkod) satır seçimine karışmasın.
    # Sınır EN GENİŞ satır penceresinden (ad, 0.55'e kadar) — posta penceresi
    # (0.42) ad satırının son kelimesini kolondan düşürüyordu.
    x_min = (min(name_row.x, address_row.x, postal_row.x) - 0.02) * width
    x_max = (
        max(
            name_row.x + name_row.w,
            address_row.x + address_row.w,
            postal_row.x + postal_row.w,
        )
        + 0.05
    ) * width
    column_words = [word for word in words if x_min <= word.center_x <= x_max]
    lines = group_words_into_lines(column_words)
    if not lines:
        return False

    def line_y(line: list[OcrWord]) -> float:
        return min(word.center_y for word in line)

    def gated_tokens(line: list[OcrWord]) -> list[str]:
        return _strip_semantic_junk(_scope_text(_drop_label_tokens(line))).split()

    # 1) CPR satırı: 6+4 veya bitişik 10 hane üreten ilk satır.
    cpr_idx: int | None = None
    for i, line in enumerate(lines):
        repaired = repair_numeric_confusables(_scope_text(line))
        if re.search(r"\b\d{6}[-. ]\d{4}\b", repaired) or re.search(r"\b\d{10}\b", repaired):
            cpr_idx = i
            break
    if cpr_idx is None:
        return False

    # 2) Posta satırı: CPR'ın altında 'dddd Şehir' desenli EN ALT satır
    #    ('1813 AKUTTELEFONEN' — etiket düşünce alfa kuyruk kalmaz — aday
    #    değildir). Barkod bölgesinin altına düşen satırlar bandı aşar.
    postal_idx: int | None = None
    for i in range(len(lines) - 1, cpr_idx, -1):
        if line_y(lines[i]) - line_y(lines[cpr_idx]) > 0.38 * height:
            continue
        if _looks_like_postal_line(_scope_text(_drop_label_tokens(lines[i]))):
            postal_idx = i
            break
    if postal_idx is None:
        return False

    # CPR de çapa satırından gelsin: gerçek kartta CPR satırı pencerenin
    # dışına kayabilir (eğim/rotate), çapa satırı zaten TANIMLIdır. Rakam
    # filtresi alan-no önekini ve etiketleri düşürür, _extract_cpr geri
    # kalanından 10 haneyi çıkarır.
    cpr_scope = _drop_label_tokens(lines[cpr_idx], numeric=True)
    cpr_text = _scope_text(cpr_scope)
    if cpr_text:
        raw["cpr"] = (cpr_text, _scope_confidence(lines[cpr_idx]))

    # 3) Adres: postadan yukarı ilk rakamlı (ev no) geçitli satır.
    # 4) Ad: taramayı sürdür (CPR satırı atlanır), ilk alfa satırı.
    address_idx: int | None = None
    name_idx: int | None = None
    for i in range(postal_idx - 1, -1, -1):
        if i == cpr_idx:
            continue
        tokens = gated_tokens(lines[i])
        if not tokens:
            continue
        has_alpha = any(_is_name_token(t) for t in tokens)
        has_digit = any(any(ch.isdigit() for ch in t) for t in tokens)
        if address_idx is None and has_digit and len(tokens) >= 2:
            address_idx = i
            continue
        if has_alpha:
            name_idx = i
            break

    def line_text_in(line: list[OcrWord], roi: FieldRoi) -> str:
        rx0, rx1 = roi.x * width, (roi.x + roi.w) * width
        return _scope_text(_drop_label_tokens([w for w in line if rx0 <= w.center_x <= rx1]))

    if address_idx is not None:
        address_text = _strip_semantic_junk(line_text_in(lines[address_idx], address_row))
        if _is_plausible_address(address_text):
            raw["address"] = (address_text, _scope_confidence(lines[address_idx]))
    if name_idx is not None:
        gated_name = _gate_name_text(line_text_in(lines[name_idx], name_row))
        if gated_name:
            raw["name"] = (gated_name, _scope_confidence(lines[name_idx]))
    postal_scope = [
        w
        for w in lines[postal_idx]
        if postal_row.x * width <= w.center_x <= (postal_row.x + postal_row.w) * width
    ]
    raw["postal"] = (_scope_text(_drop_label_tokens(postal_scope)), _scope_confidence(lines[postal_idx]))
    return True


def parse_local_fields(
    words: list[OcrWord],
    *,
    document_type_key: str | None,
    rois_enabled: bool,
    threshold: float,
    rois: dict[str, tuple[FieldRoi, ...]] | None = None,
    canvas: tuple[int, int] | None = None,
    deskew: bool = True,
    skew_strict: bool = False,
) -> LocalParseResult:
    """Kelime listesini ROI pencereleriyle soyut alanlara eşler.

    ``rois_enabled=False`` (kart bulunamadı) durumunda ROI eşleme ATLANIR:
    yalnız tam-kart metni döner, alan uydurulmaz (D5 geri dönüşü).

    ``canvas`` kelimelerin geldiği görüntü boyutudur (varsayılan warp tuvali);
    flatbed karesinde gerçek boyut verilmezse pencereler kayar.

    ``deskew``: kalan eğim düzeltmesi (gruplamadan önce kelime merkezleri
    döndürülür). ``skew_strict`` warp yapılmış kare içindir: dörtgen eğimin
    çoğunu gidermiştir, kestirim sıkı kapıyla koşar (±5°, 1.8x skor marjı)
    ki blur gürültüsü yanlış açı üretip satırları karıştırmasın.
    """
    table = rois if rois is not None else load_rois()
    active_canvas = canvas if canvas is not None else CANVAS
    # Kalıntı eğim düzeltmesi gruplamadan ÖNCE: hem satır birleştirme hem
    # pencere eşlemesi düzeltilmiş merkezlerle çalışır.
    if deskew:
        words = deskew_words(words, active_canvas, strict=skew_strict)
    ocr_text = build_ocr_text(words)
    # Dev kutular (filigran artıkları, foto bölgesi çöpü) satır seçimine
    # KATILMAZ: köprü kurup alakasız satırları birleştiriyorlardı. ocr_text
    # yukarıda tam listeyle kuruldu — belge tipi kokusu kaybolmaz.
    row_words = [w for w in words if w.height <= GIANT_WORD_HEIGHT_RATIO * active_canvas[1]]
    result = LocalParseResult(
        document_type=document_type_value(document_type_key),
        document_type_key=document_type_key,
        ocr_text=ocr_text,
        rois_enabled=bool(rois_enabled and document_type_key),
    )
    if not result.rois_enabled:
        return result

    rows = rois_for(table, document_type_key or "")
    raw: dict[str, tuple[str, float]] = {}
    best_confidence_by_row: dict[str, float] = {}
    for row in rows:
        scope = words_in_roi(row_words, row, active_canvas)
        text = _scope_text(scope)
        confidence = _scope_confidence(scope)
        best_confidence_by_row[row.key] = max(best_confidence_by_row.get(row.key, 0.0), confidence)
        if not text:
            continue
        if row.field in ("full_name", "city"):
            scope = _drop_label_tokens(scope)
            if row.key == "name" and document_type_key == "sundhedskort":
                # Ad penceresi klinik/kurum satırlarını da kesebilir; ad
                # pencerenin en alttaki harf satırıdır (son alfa satırı).
                # Boş kalırsa AD YOKTUR — düşürülen etiketleri geri iade
                # etmek yok ('Sikr.'/'SUNDHEDSKORT' ad olmaz; saha 10 Eyl).
                scope = _last_alpha_line(scope)
            else:
                scope = _alpha_words(scope)
            text = _scope_text(scope)
        elif row.field == "address":
            scope = _drop_label_tokens(scope)
            text = _scope_text(scope)
        elif row.field in ("cpr_number", "doc_number", "birth_date", "expiry_date"):
            # Rakam-beklenen pencere: alan no etiketleri ve rakamsız
            # token'lar düşürülür ki rakam dizileri bozulmasın.
            scope = _drop_label_tokens(scope, numeric=True)
            text = _scope_text(scope)
        elif row.field == "postal_code":
            # Posta penceresi KARIŞIKTIR (kod + şehir adı): yalnız etiket
            # düşürülür, rakamsız filtre uygulanmaz (şehir adı kaybolmasın).
            # Çok satırlı pencerede (gerçek kart, 13 Eyl 2026) kod+şehir
            # SATIR bütünlüğü bozulmasın: posta desenine uyan SON satır
            # alınır — düzleşmiş metnin kuyruğu ad/sokak satırlarını şehre
            # birleştiriyordu ('Paris Recai Demir Boulevard 47').
            scope = _drop_label_tokens(scope)
            postal_lines = [
                line
                for line in group_words_into_lines(scope)
                if _looks_like_postal_line(_scope_text(line))
            ]
            if postal_lines:
                scope = postal_lines[-1]
            text = _scope_text(scope)
        if not text:
            continue
        # Aynı ROI anahtarı birden çok alana map edebilir (sundhedskort
        # postal → postal_code + city); ilk dolan kazanır, cömert pencere.
        raw.setdefault(row.key, (text, confidence))

    mrz_lines = [line for line in ocr_text.splitlines() if "<" in line and len(line.replace(" ", "")) >= 30]
    if document_type_key == "koerekort":
        _split_koerekort_names(raw, row_words, table, active_canvas)
    if document_type_key == "sundhedskort":
        # Çapa yolu pencere değerlerinin ÜZERİNE yazar (raw doğrudan atama);
        # çapa bulunamazsa pencere yolu yedek kalır.
        _split_sundhedskort_anchor(raw, row_words, table, active_canvas)
    if document_type_key in ("koerekort", "idkort"):
        result.fields = _compose_koerekort(raw)
        if document_type_key == "idkort":
            # id-kortun TD1 MRZ'si yedektir: basılı alan okunmazsa (aşınma,
            # parlama) doğum/doc no MRZ'den gelir; basılı değer ezilmez.
            for name, local in (_extract_mrz(mrz_lines) or {}).items():
                result.fields.setdefault(name, local)
    elif document_type_key == "sundhedskort":
        result.fields = _compose_sundhedskort(raw)
    elif document_type_key == "pas":
        result.fields = _compose_pas(raw, mrz_lines)
    else:
        result.fields = {}

    result.roi_fields = sorted({local.roi_key for local in result.fields.values()})
    low_rows = [key for key, conf in best_confidence_by_row.items() if conf and conf < threshold]
    result.low_confidence = (not result.fields) or bool(low_rows)
    result.mod11_failed_soft = any(
        local.roi_key in ("4d", "cpr")
        and local.checksum_ok is False
        and re.fullmatch(r"\d{10}", local.value) is not None
        for local in result.fields.values()
    )
    return result


def local_fields_to_identity_fields(
    fields: dict[str, LocalField], *, threshold: float
) -> dict[str, IdentityFieldOut]:
    """Yerel alanları uç şemasına çevirir; RapidOCR güveni review kararına girer."""
    return {
        name: IdentityFieldOut(
            value=local.value,
            review=review_for(local.value, local.confidence, threshold, checksum_ok=local.checksum_ok),
            confidence=local.confidence,
        )
        for name, local in fields.items()
        if local.value
    }


def birth_date_consistent_with_cpr(cpr: str | None, birth_date: str | None) -> bool:
    """Doğum tarihi ↔ CPR DDMMYY tutarlılığı (ayrıştırılamazsa yargı yok)."""
    return birthdate_cpr_consistent(cpr, birth_date)


# review_for'un validated sabiti bu modülün sözleşmesinin parçasıdır; import
# edilmiş olması şema kararı tek yerden gelmesini sağlar.
__all__ = [
    "REVIEW_VALIDATED",
    "CANVAS",
    "LINE_Y_OVERLAP_RATIO",
    "LocalField",
    "LocalParseResult",
    "OcrWord",
    "birth_date_consistent_with_cpr",
    "build_ocr_text",
    "document_type_value",
    "group_words_into_lines",
    "guess_document_type",
    "local_fields_to_identity_fields",
    "parse_local_fields",
    "words_in_roi",
]
