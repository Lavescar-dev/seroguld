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

_DATE_RE = re.compile(r"(\d{1,2})[.\-/\s](\d{1,2})[.\-/\s](\d{4})")
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
    # Bulanık karelerde 'Kørekortnr.' 'Kerekortnr.' okunabilir (ø→e): koerekort
    # çapası iki yazımla da aranır — yoksa satırın 'kortnr' kalıntısı kartı
    # id-kort sanıp yanlış ROI tablosuna sokar (koerekortun kendi satırıdır).
    if "koerekort" in text or "kerekort" in text or "udlobsdato" in text or "udstedelsesdato" in text:
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
    """Basılı alan etiketlerini düşürür; hepsi etiketse düşürmez (değer kaybı yok).

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
    return kept or words


def _is_label_token(token: str) -> bool:
    """Token bir basılı ETİKET mi? Rakam taşıyan token asla etiket sayılmaz.

    Rakam şartı kritiktir: transliterasyon sonrası "DK1000099" → "dk" anahtarı
    'DK' filigran etiketiyle çakışır ve gerçek numara etiket sanılıp düşer.
    """
    if any(ch.isdigit() for ch in token):
        return False
    key = _label_key(token)
    return bool(key) and key in _LABEL_TOKENS


def _looks_like_numeric_value(token: str) -> bool:
    cleaned = re.sub(r"[^A-Za-z0-9]", "", token)
    if len(cleaned) <= 2:  # alan no etiketleri: "1.", "4a", "5."
        return False
    return any(ch.isdigit() for ch in cleaned)


def _alpha_words(words: list[OcrWord]) -> list[OcrWord]:
    return [word for word in words if _is_name_token(word.text)]


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
    """İlk gg.aa.yyyy benzeri tarihi 'dd.mm.yyyy' biçiminde döner."""
    match = _DATE_RE.search(repair_numeric_confusables(text))
    if not match:
        return ""
    day, month, year = (part.zfill(2) if index < 2 else part for index, part in enumerate(match.groups()))
    return f"{day}.{month}.{year}"


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
    # olabilir — 6+4 parça birleşimi tek CPR'dır (biçimok).
    if len(runs) == 2 and len(runs[0]) == 6 and len(runs[1]) == 4:
        return runs[0] + runs[1], True
    # Administrativt nummer (CPR yok) KESİNTİSİZ tek run'dır: ayrı run'ların
    # birleşimi (barkod no + koşul no gibi) 9 haneye ulaşsa da numara değildir.
    if len(runs) == 1 and len(runs[0]) == 9:
        return runs[0], False
    return "", False


def _extract_doc_number(text: str) -> tuple[str, bool]:
    """Kørekort/kort numarası: yeni Danish kartta 8 hane; eski/yabancı biçim
    harf+rakam karışımı 8-11 karakter (ör. DK1000099, ID1000066).

    Onarım (O→0, I→1) YALNIZ tamamen rakam olan sonuca uygulanır: "ID1000066"
    gibi gerçek harfli numarada I harfi rakama çevrilirse numara bozulur.

    Biçim dışı metin (etiket-value karışımı gibi) ALAN OLARAK DÖNMEZ: yanlış
    doc_number'ı needs_review ile sunmaktan iyidir hiç sunmamamak — operatör
    tam-kart metninden (ocr_text) bakar.
    """
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


def _compose_koerekort(raw: dict[str, tuple[str, float]]) -> dict[str, LocalField]:
    fields: dict[str, LocalField] = {}

    given, given_conf = raw.get("2", ("", 0.0))
    surname, surname_conf = raw.get("1", ("", 0.0))
    full_name = " ".join(part for part in (given.strip(), surname.strip()) if part).strip()
    if full_name:
        # Basılı sıra "given surname"dir (1=soyad, 2=ad) — frontend eşleştirme
        # anahtarı translitere edilerek karşılaştırılır, görüntülenen ad bu.
        fields["full_name"] = LocalField(
            value=full_name,
            confidence=min(given_conf, surname_conf) or max(given_conf, surname_conf),
            roi_key="1+2",
            checksum_ok=True,
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

    address_text, address_conf = raw.get("address", ("", 0.0))
    if address_text:
        fields["address"] = LocalField(
            value=address_text, confidence=address_conf, roi_key="address", checksum_ok=True
        )

    postal_text, postal_conf = raw.get("postal", ("", 0.0))
    postal, city = _extract_postal(postal_text)
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


def parse_local_fields(
    words: list[OcrWord],
    *,
    document_type_key: str | None,
    rois_enabled: bool,
    threshold: float,
    rois: dict[str, tuple[FieldRoi, ...]] | None = None,
    canvas: tuple[int, int] | None = None,
) -> LocalParseResult:
    """Kelime listesini ROI pencereleriyle soyut alanlara eşler.

    ``rois_enabled=False`` (kart bulunamadı) durumunda ROI eşleme ATLANIR:
    yalnız tam-kart metni döner, alan uydurulmaz (D5 geri dönüşü).

    ``canvas`` kelimelerin geldiği görüntü boyutudur (varsayılan warp tuvali);
    flatbed karesinde gerçek boyut verilmezse pencereler kayar.
    """
    table = rois if rois is not None else load_rois()
    active_canvas = canvas if canvas is not None else CANVAS
    ocr_text = build_ocr_text(words)
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
        scope = words_in_roi(words, row, active_canvas)
        text = _scope_text(scope)
        confidence = _scope_confidence(scope)
        best_confidence_by_row[row.key] = max(best_confidence_by_row.get(row.key, 0.0), confidence)
        if not text:
            continue
        if row.field in ("full_name", "city"):
            scope = _drop_label_tokens(scope)
            scope = _alpha_words(scope) or scope
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
            scope = _drop_label_tokens(scope)
            text = _scope_text(scope)
        if not text:
            continue
        # Aynı ROI anahtarı birden çok alana map edebilir (sundhedskort
        # postal → postal_code + city); ilk dolan kazanır, cömert pencere.
        raw.setdefault(row.key, (text, confidence))

    mrz_lines = [line for line in ocr_text.splitlines() if "<" in line and len(line.replace(" ", "")) >= 30]
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
