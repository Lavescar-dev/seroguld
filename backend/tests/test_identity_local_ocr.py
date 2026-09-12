"""0.3.39 yerel kimlik OCR katmanı — ön-işleme + ROI + parse + servis testleri.

GERÇEK RapidOCR motoru BURADA KURULMAZ (ağır kurulum + model yolu); motor
sarmalayıcısının arkası sahte kelime üreticileriyle test edilir. Görüntüler
PIL/NumPy ile bellek içi üretilir — diske yazma YOK, gerçek kart verisi YOK.
"""

from __future__ import annotations

import io
from typing import Any

import numpy as np
import pytest
from PIL import Image

from app.schemas.identity import IdentityFieldOut
from app.services.identity_barcode_service import IdentityBarcodeHit
from app.services.identity_local_ocr_service import (
    LocalOcrOutcome,
    run_local_ocr,
)
from app.services.identity_local_parse import (
    CANVAS,
    LocalField,
    OcrWord,
    birth_date_consistent_with_cpr,
    build_ocr_text,
    deskew_words,
    estimate_skew_deg,
    group_words_into_lines,
    guess_document_type,
    local_fields_to_identity_fields,
    parse_local_fields,
    words_in_roi,
)
from app.services.identity_ocr_preprocess import (
    crop_roi,
    decode_to_bgr,
    detect_card_quad,
    detect_glare,
    downscale_long_edge,
    isolate_card,
    normalize_polarity,
    order_quad_points,
)
from app.services.identity_ocr_rois import (
    DEFAULT_ROIS,
    FieldRoi,
    load_rois,
    rois_for,
)

# mod-11 GEÇER ve formatı geçerli sentetik CPR (7. hane 4 + yy 12 → resmî
# yüzyıl kuralı ve basit yy>30 kestirimi İKİSİ de 2012 verir; takvim tarihi geçerli).
VALID_MOD11_CPR = "0101124002"
# mod-11 BAŞARISIZ ama biçimi geçerli sentetik CPR (2007 sonrası meşru durum).
INVALID_MOD11_CPR = "0101019999"


# ---------------------------------------------------------------------------
# Yardımcılar — sentetik görüntü ve sahte motor (gerçek RapidOCR YOK)
# ---------------------------------------------------------------------------


def _png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _flat_card_image(width: int = 1017, height: int = 648, gray: int = 235) -> bytes:
    """ID-1 en-boy oranında tek renk kart karesi (düzgün yüzey — OCR girdisi)."""
    return _png_bytes(Image.new("RGB", (width, height), (gray, gray, gray)))


def _gradient_flatbed_image(width: int = 1017, height: int = 648) -> bytes:
    """ID-1 en-boy oranında DÜZ yatay gradyan kare.

    Kenar geçişi ve Otsu dörtgeni üretmez (düzgün eğim tek Renktir) —
    flatbed kabul yolunun (dörtgen yok, kare ID-1±%15) deterministic girdisi.
    """
    column = np.linspace(60, 200, width, dtype=np.uint8)
    frame = np.tile(column, (height, 1))
    return _png_bytes(Image.fromarray(np.stack([frame] * 3, axis=-1), "RGB"))


def _tilted_card_image() -> bytes:
    """Koyu zeminde 4° eğik açık kart — dörtgen tespiti + warp yolunu besler.

    Zemin 720x560 (en-boy 1.29): ID-1 kadraj bandının DIŞINDAdır — kadraj
    önceliği (isolate_card) dörtgen aramasına bırakır.
    """
    import cv2

    background = np.full((560, 720, 3), 40, dtype=np.uint8)
    card = np.full((302, 480, 3), 225, dtype=np.uint8)  # ID-1 ± tolerans
    center = (240.0, 151.0)
    rotation = cv2.getRotationMatrix2D(center, 4.0, 1.0)
    rotated = cv2.warpAffine(card, rotation, (480, 302), borderValue=(225, 225, 225))
    background[120:120 + 302, 120:120 + 480] = rotated
    ok, encoded = cv2.imencode(".png", background)
    assert ok
    return encoded.tobytes()


class _FakeEngine:
    """run_local_ocr'ın motor sarmalayıcı sözleşmesini taklit eder.

    Kelimeler NORMALIZE koordinatla tanımlanır; recognize çağrıldığında
    GELDİĞİ görüntünün boyutuna göre piksele çevrilir — warp/flatbed farkı
    testi bozmaz (canvas düzeltmesinin kendisi words_in_roi testinde pinli).
    """

    def __init__(
        self,
        words_norm: list[tuple[str, float, float, float]],
        *,
        raise_on_recognize: Exception | None = None,
    ) -> None:
        self._words_norm = words_norm
        self._raise = raise_on_recognize
        self.calls = 0

    def recognize(self, image: Any, *, word_boxes: bool = True) -> list[OcrWord]:
        self.calls += 1
        if self._raise is not None:
            raise self._raise
        height, width = image.shape[:2]
        words: list[OcrWord] = []
        for text, nx, ny, score in self._words_norm:
            cx, cy = nx * width, ny * height
            words.append(
                OcrWord(text=text, score=score, box=(int(cx - 30), int(cy - 10), int(cx + 30), int(cy + 10)))
            )
        return words


def _word(text: str, nx: float, ny: float, score: float = 0.97, *, canvas: tuple[int, int] = CANVAS) -> OcrWord:
    """Tek OcrWord — normalize merkezden üretilir (canvas piksel uzayında)."""
    width, height = canvas
    cx, cy = nx * width, ny * height
    return OcrWord(text=text, score=score, box=(int(cx - 30), int(cy - 10), int(cx + 30), int(cy + 10)))


@pytest.fixture()
def stub_rois_settings(monkeypatch):
    """load_rois'in okuduğu ayarı izole eder (kullanıcı .env'i teste sızmaz)."""

    class _Settings:
        identity_ocr_roi_overrides_json = ""

    monkeypatch.setattr("app.services.identity_ocr_rois.get_settings", lambda: _Settings())
    return _Settings


# ---------------------------------------------------------------------------
# Ön-işleme (WP1)
# ---------------------------------------------------------------------------


def test_decode_to_bgr_rejects_garbage_and_empty() -> None:
    assert decode_to_bgr(b"") is None
    assert decode_to_bgr(b"this is not an image") is None


def test_downscale_long_edge_caps_large_keeps_small() -> None:
    big = np.zeros((3000, 4000, 3), dtype=np.uint8)
    scaled = downscale_long_edge(big, 1600)
    assert max(scaled.shape[0], scaled.shape[1]) == 1600
    small = np.zeros((500, 300, 3), dtype=np.uint8)
    assert downscale_long_edge(small, 1600) is small  # küçük görüntü aynen döner


def test_order_quad_points_is_tl_tr_br_bl() -> None:
    quad = np.array([[100, 200], [10, 190], [15, 100], [105, 95]], dtype=np.float32)
    ordered = order_quad_points(quad)
    # Kanonik tanım: TL min(x+y), BR max(x+y), TR max(x-y), BL min(x-y).
    sums = [float(p[0]) + float(p[1]) for p in ordered]
    diffs = [float(p[0]) - float(p[1]) for p in ordered]
    assert sums[0] == min(sums) and sums[2] == max(sums)
    assert diffs[1] == max(diffs) and diffs[3] == min(diffs)


def test_detect_card_quad_finds_tilted_card() -> None:
    found = detect_card_quad(decode_to_bgr(_tilted_card_image()))
    assert found is not None
    quad, sideways = found
    assert quad.shape == (4, 2) and sideways is False
    width = float(quad[:, 0].max() - quad[:, 0].min())
    height = float(quad[:, 1].max() - quad[:, 1].min())
    assert abs((width / height) - 1.586) / 1.586 < 0.35


def test_detect_card_quad_real_size_a4_card_is_found() -> None:
    """Saha regresyonu (10 Eyl 2026): gerçek boyut ID-1 kart (86x54mm) A4
    @300 DPI sayfada karenin %7.45'idir — eski %8 alan eşiği onu REDDEDİYOR,
    dükkân taraması card_not_detected'e düşüyordu. Yeni %5 eşiği bulmalı."""
    page = np.full((1754, 1240, 3), 60, dtype=np.uint8)  # A4 @150 DPI (ölçekli)
    card = np.full((319, 508, 3), 235, dtype=np.uint8)   # 86x54mm @150 DPI
    page[(1754 - 319) // 2:(1754 - 319) // 2 + 319, (1240 - 508) // 2:(1240 - 508) // 2 + 508] = card
    found = detect_card_quad(page)
    assert found is not None and found[1] is False


def test_detect_card_quad_white_page_low_contrast_is_found() -> None:
    """Açık/beyaz kapak: kart-zemin kontrastı zayıftır (CLAHE geçişi)."""
    page = np.full((700, 1000, 3), 225, dtype=np.uint8)
    card = np.full((486, 770, 3), 252, dtype=np.uint8)
    for i in range(8):  # kart içi metin bantları
        card[60 + i * 50:74 + i * 50, 40:730] = 90
    page[107:107 + 486, 115:115 + 770] = card
    assert detect_card_quad(page) is not None


def test_detect_card_quad_portrait_card_returns_sideways() -> None:
    """Dikey yerleştirilmiş kart: dörtgen OLDUĞU GİBİ döner, sideways=True.

    Eski kod portre en-boyu (0.63) işaretsiz en-boy kapısından düşürüyor ve
    dörtgeni kaydırıp yatay tuvale GERİYORDU (metin 2.45x bozuluyordu)."""
    page = np.full((560, 720, 3), 40, dtype=np.uint8)
    card = np.full((480, 302, 3), 225, dtype=np.uint8)  # portre ID-1
    page[40:520, 210:512] = card
    found = detect_card_quad(page)
    assert found is not None
    _quad, sideways = found
    assert sideways is True


def test_detect_card_quad_rejects_tiny_card() -> None:
    background = np.full((480, 720, 3), 40, dtype=np.uint8)
    background[230:250, 350:370] = 225  # 20x20 → alan kapısı (%5) altı
    assert detect_card_quad(background) is None


def test_isolate_card_tilted_warps_to_id1_canvas() -> None:
    region = isolate_card(downscale_long_edge(decode_to_bgr(_tilted_card_image())))
    assert region.warped is True and region.quad_detected is True
    assert region.rois_enabled is True and region.warnings == []
    assert region.sideways is False
    assert region.image.shape[:2] == (808, 1280)


def test_isolate_card_portrait_quad_warps_portrait_canvas() -> None:
    """Portre kart portre tuvale (808x1280) warp edilir — içerik 90° yan
    yatık basılır, motor katmanı çevirip okur (en-boy korunur, bozulma yok)."""
    import cv2

    page = np.full((560, 720, 3), 40, dtype=np.uint8)
    card = np.full((480, 302, 3), 235, dtype=np.uint8)
    page[40:520, 210:512] = card
    ok, encoded = cv2.imencode(".png", page)
    region = isolate_card(downscale_long_edge(decode_to_bgr(encoded.tobytes())))
    assert region.warped is True and region.sideways is True
    assert region.rois_enabled is True and region.warnings == []
    assert region.image.shape[:2] == (1280, 808)  # (h, w) portre tuval


def test_isolate_card_flatbed_frame_is_accepted() -> None:
    region = isolate_card(downscale_long_edge(decode_to_bgr(_gradient_flatbed_image())))
    assert region.warped is False and region.quad_detected is False
    assert region.rois_enabled is True and region.warnings == []
    assert region.sideways is False


def test_isolate_card_portrait_frame_accepted_as_sideways() -> None:
    """Portre kadrajlı tam-kare tarama da kart-dolu kadrajdır (sideways)."""
    portrait = _png_bytes(Image.new("RGB", (600, 900), (120, 120, 120)))
    region = isolate_card(downscale_long_edge(decode_to_bgr(portrait)))
    assert region.warped is False and region.rois_enabled is True
    assert region.sideways is True and region.warnings == []


def test_isolate_card_portrait_card_in_landscape_frame_gets_ortho_probe() -> None:
    """Kadraja DİK kart (0.3.40 incelemesi): 3:2 manzara kadraj (1.50 — ID-1
    bandı İÇİNDE) dikey kart en çok %44 dolabilir, ≥%50 kapısına geometrik
    olarak takılır ve ham kare 90° yanlış okunuyordu. Dik-yön sondası (yalnız
    portre bandı, %30 dolgu) kartı bulup portre tuvale warp etmeli."""
    import cv2

    page = np.full((1000, 1500, 3), 40, dtype=np.uint8)  # 3:2 manzara kadraj
    card = np.full((1000, 632, 3), 235, dtype=np.uint8)  # portre ID-1 kart
    page[0:1000, 434:1066] = card
    ok, encoded = cv2.imencode(".png", page)
    region = isolate_card(downscale_long_edge(decode_to_bgr(encoded.tobytes())))
    assert region.warped is True and region.quad_detected is True
    assert region.sideways is True
    assert region.image.shape[:2] == (1280, 808)  # (h, w) portre tuval


def test_isolate_card_id1_frame_skips_internal_block_quad() -> None:
    """Kadraj önceliği regresyon pini (10 Eyl 2026): kart çerçeveyi dolduran
    ID-1 karede İÇ blok (foto/metin alanı) en-boy eşiğine uyan yanlış bir
    dörtgen üretebiliyordu (CLAHE geçişi + asis kart → type=None). ID-1
    kadrajda dörtgen ARANMAZ."""
    import cv2

    frame = np.full((660, 1050, 3), 235, dtype=np.uint8)
    frame[80:580, 350:950] = 120  # en-boy ~1.6 iç blok (alan %29 → eşik üstü)
    ok, encoded = cv2.imencode(".png", frame)
    region = isolate_card(downscale_long_edge(decode_to_bgr(encoded.tobytes())))
    assert region.warped is False and region.quad_detected is False
    assert region.rois_enabled is True and region.sideways is False


def test_isolate_card_extreme_portrait_emits_card_not_detected() -> None:
    extreme = _png_bytes(Image.new("RGB", (500, 1200), (120, 120, 120)))
    region = isolate_card(downscale_long_edge(decode_to_bgr(extreme)))
    assert region.rois_enabled is False
    assert region.warnings == ["card_not_detected"]


def test_crop_roi_pixel_math_and_clamp() -> None:
    image = np.zeros((100, 200, 3), dtype=np.uint8)
    roi = FieldRoi(field="full_name", key="1", x=0.25, y=0.5, w=0.5, h=0.25)
    assert crop_roi(image, roi, upscale=0).shape[:2] == (25, 100)
    # Pencere kareyi taşarsa kırpım kare sınırına kelepçelenir.
    outside = FieldRoi(field="full_name", key="x", x=0.9, y=0.9, w=0.5, h=0.5)
    assert crop_roi(image, outside, upscale=0).shape[:2] == (10, 20)
    tiny = FieldRoi(field="f", key="e", x=0.995, y=0.995, w=0.004, h=0.004)
    assert crop_roi(image, tiny, upscale=0).size == 0


def test_normalize_polarity_binarize_keeps_text_dark_on_light() -> None:
    image = np.full((40, 120, 3), 230, dtype=np.uint8)
    image[16:24, 10:110] = 30  # koyu yazı bloğu (azınlık sınıf)
    gray = normalize_polarity(image, binarize=True)[:, :, 0]
    # Kutup düzeltmesi: zemin beyaz kalmalı (yazı azınlık).
    assert np.count_nonzero(gray) > gray.size / 2


def test_detect_glare_positive_on_clipped_blob_negative_on_flat_card() -> None:
    surface = np.full((200, 300, 3), 180, dtype=np.uint8)
    combined = surface.copy()
    combined[40:70, 100:140] = 255  # doygunluğu düşük, 255'e yaslanmış yansıma blob'u
    assert detect_glare(combined) is True
    # Düz beyaz kart: her yer parlak → blob yüzeyden parlak DEĞİL → false pozitif yok.
    assert detect_glare(np.full((200, 300, 3), 240, dtype=np.uint8)) is False


# ---------------------------------------------------------------------------
# ROI tablosu (D5) — override derin birleşimi + bozuk env toleransı
# ---------------------------------------------------------------------------


def test_load_rois_defaults_and_document_types(stub_rois_settings) -> None:  # noqa: ARG001
    table = load_rois()
    for key in ("koerekort", "sundhedskort", "pas", "idkort"):
        assert key in table and table[key]
    # koerekort ad-soyad TEK "1" penceresinden satır sayısına göre ayrılır
    # (render ile eğik/bulanık çekim bantları kesiştiği için "2" penceresi
    # yoktur; _split_koerekort_names raw["2"]'yi türetir).
    assert {"1", "3", "4b", "4d", "5"} <= {row.key for row in table["koerekort"]}


def test_load_rois_deep_merges_override_over_defaults(monkeypatch) -> None:
    class _Settings:
        identity_ocr_roi_overrides_json = '{"koerekort": {"4d": {"x": 0.31, "y": 0.7, "w": 0.66, "h": 0.2}}}'

    monkeypatch.setattr("app.services.identity_ocr_rois.get_settings", lambda: _Settings())
    table = load_rois()
    row = next(row for row in table["koerekort"] if row.key == "4d")
    assert (row.x, row.y, row.w, row.h) == (0.31, 0.7, 0.66, 0.2)
    # Patch edilmeyen nitelikler defaults'tan korunur (derin birleşim).
    assert row.field == "cpr_number"
    assert row.label_hint == next(r for r in DEFAULT_ROIS["koerekort"] if r.key == "4d").label_hint
    # Diğer satır ve diğer belge tipleri dokunulmamış.
    assert next(r for r in table["koerekort"] if r.key == "5").x == DEFAULT_ROIS["koerekort"][-1].x
    assert table["sundhedskort"] == DEFAULT_ROIS["sundhedskort"]


def test_load_rois_bad_json_keeps_defaults(monkeypatch) -> None:
    class _Settings:
        identity_ocr_roi_overrides_json = "{this is not json"

    monkeypatch.setattr("app.services.identity_ocr_rois.get_settings", lambda: _Settings())
    assert load_rois() == {doc: tuple(rows) for doc, rows in DEFAULT_ROIS.items()}


def test_load_rois_invalid_values_skipped(monkeypatch) -> None:
    class _Settings:
        # x aralık dışı, w sıfır, hatalı tip → satır/sözlük atlanır, defaults ayakta.
        identity_ocr_roi_overrides_json = (
            '{"koerekort": {"4d": {"x": 1.7, "w": 0.0}, "5": {"y": "hatali"}}, "pas": "dizi-degil"}'
        )

    monkeypatch.setattr("app.services.identity_ocr_rois.get_settings", lambda: _Settings())
    table = load_rois()
    for key in ("4d", "5"):
        assert next(row for row in table["koerekort"] if row.key == key) == next(
            row for row in DEFAULT_ROIS["koerekort"] if row.key == key
        )


def test_rois_for_unknown_type_returns_empty() -> None:
    assert rois_for(load_rois(), "bilinmeyen") == ()


# ---------------------------------------------------------------------------
# Parse katmanı (WP2) — sahte kelime listeleriyle
# ---------------------------------------------------------------------------


def test_group_words_into_lines_merges_by_y_overlap() -> None:
    lines = group_words_into_lines([_word("A", 0.2, 0.10), _word("B", 0.5, 0.105), _word("C", 0.8, 0.40)])
    assert len(lines) == 2
    assert [w.text for w in lines[0]] == ["A", "B"]


def test_words_in_roi_honors_actual_canvas_not_fixed_one() -> None:
    """0.3.39 canvas düzeltmesi: flatbed karesi (1017x648) kendi boyutuyla eşlenir."""
    roi = FieldRoi(field="doc_number", key="5", x=0.5, y=0.6, w=0.48, h=0.22)
    flatbed_word = _word("DK1000099", 0.72, 0.673, canvas=(1017, 648))
    assert [w.text for w in words_in_roi([flatbed_word], roi, (1017, 648))] == ["DK1000099"]
    # Sabit tuvale zorlanırsa aynı pencere kayar (eski davranış — regresyon imzası).
    assert words_in_roi([flatbed_word], roi, CANVAS) == []


def test_guess_document_type_anchors_and_misread_tolerance() -> None:
    koerekort = [_word(t, 0.3, 0.1) for t in ("KØREKORT", "·", "DANMARK")]
    assert guess_document_type(koerekort) == "koerekort"
    # Bulanık karede ø düşer: 'Kerekortnr.' yine koerekort çapasıdır, idkort DEĞİL.
    misread = [_word(t, 0.3, 0.1) for t in ("5.", "Kerekortnr.", "DK1000373")]
    assert guess_document_type(misread) == "koerekort"
    sundhedskort = [_word("Sundhedskort", 0.3, 0.1), _word("sygesikringsbevis", 0.3, 0.2)]
    assert guess_document_type(sundhedskort) == "sundhedskort"
    idkort = [_word("IDENTITETSKORT", 0.3, 0.1), _word("Kortnr.", 0.7, 0.2)]
    assert guess_document_type(idkort) == "idkort"
    pas = [_word("P<DNKTESTESEN<<ANDERS<PROEVE<<<<<<<<<<<<<<<<", 0.5, 0.9)]
    assert guess_document_type(pas) == "pas"
    assert guess_document_type([_word("arada bir sey", 0.5, 0.5)]) is None


def _koerekort_words() -> list[OcrWord]:
    """koerekort_01 SPECIMEN'inin warp tuvalinde ÖLÇÜLMÜŞ düzeninin sahte hali
    (benchmark'taki gerçek motor çıktısıyla aynı bantlar)."""
    rows = [
        (0.30, 0.070, "KØREKORT"), (0.42, 0.070, "DANMARK"),
        (0.27, 0.075, "1."), (0.33, 0.075, "Efternavn"), (0.40, 0.125, "TESTESEN"),
        (0.27, 0.212, "2."), (0.33, 0.212, "Fornavn"),
        (0.31, 0.262, "ANDERS"), (0.42, 0.262, "PRØVE"),
        (0.13, 0.303, "PLACE-"),
        (0.27, 0.350, "3."), (0.33, 0.350, "Fødselsdato"), (0.39, 0.350, "og"), (0.43, 0.350, "-sted"),
        (0.32, 0.394, "17.11.1986"), (0.46, 0.394, "KØBENHAVN"),
        (0.27, 0.486, "4a."), (0.32, 0.486, "Udstedt"), (0.67, 0.486, "4b."), (0.71, 0.486, "Gyldig"), (0.75, 0.486, "til"),
        (0.33, 0.536, "14.03.2021"), (0.72, 0.536, "14.03.2031"),
        (0.30, 0.670, "Kommune"), (0.37, 0.670, "Hvidovre"),
        (0.66, 0.621, "5."), (0.72, 0.621, "Kørekortnr."),
        (0.73, 0.673, "DK1000099"),
    ]
    return [_word(text, nx, ny) for nx, ny, text in rows]


def test_parse_koerekort_fields_from_fake_words() -> None:
    result = parse_local_fields(
        _koerekort_words(), document_type_key="koerekort", rois_enabled=True, threshold=0.62
    )
    assert result.document_type == "driver_license"
    assert result.fields["full_name"].value == "ANDERS PRØVE TESTESEN"
    assert result.fields["birth_date"].value == "17.11.1986"
    assert result.fields["expiry_date"].value == "14.03.2031"
    assert result.fields["doc_number"].value == "DK1000099"
    # Kartta tam CPR basılı değil → yerel katman CPR UYDURMAZ.
    assert "cpr_number" not in result.fields
    assert result.mod11_failed_soft is False
    assert set(result.roi_fields) == {"1+2", "3", "4b", "5"}
    assert result.low_confidence is False


def test_parse_koerekort_cpr_dash_join_and_mod11_soft_signal() -> None:
    # 4d penceresi gerçek kart düzenindedir: sağ kolon, 4b'nin altı (render).
    ok_words = _koerekort_words() + [_word("4d.", 0.58, 0.485), _word("010112-4002", 0.68, 0.485)]
    ok_result = parse_local_fields(ok_words, document_type_key="koerekort", rois_enabled=True, threshold=0.62)
    assert ok_result.fields["cpr_number"].value == VALID_MOD11_CPR
    assert ok_result.fields["cpr_number"].checksum_ok is True
    assert ok_result.mod11_failed_soft is False

    bad_words = _koerekort_words() + [_word("4d.", 0.58, 0.485), _word("010101-9999", 0.68, 0.485)]
    bad_result = parse_local_fields(bad_words, document_type_key="koerekort", rois_enabled=True, threshold=0.62)
    assert bad_result.fields["cpr_number"].value == INVALID_MOD11_CPR
    assert bad_result.fields["cpr_number"].checksum_ok is False
    assert bad_result.mod11_failed_soft is True


def test_parse_repairs_confusables_in_cpr_but_not_in_doc_number() -> None:
    words = _koerekort_words() + [_word("4d.", 0.58, 0.485), _word("OI01l2-4002", 0.68, 0.485)]
    result = parse_local_fields(words, document_type_key="koerekort", rois_enabled=True, threshold=0.62)
    assert result.fields["cpr_number"].value == VALID_MOD11_CPR
    # doc_number'da harfler onarılmaz (ID1000066'daki I rakama çevrilirse bozulur).
    doc_words = [_word("5.", 0.66, 0.621), _word("ID1000066", 0.73, 0.672)]
    doc_result = parse_local_fields(doc_words, document_type_key="koerekort", rois_enabled=True, threshold=0.62)
    assert doc_result.fields["doc_number"].value == "ID1000066"


def test_parse_cpr_garbage_runs_do_not_become_administrativt() -> None:
    """Ayrı run'ların birleşimi 9 haneye ulaşsa da numara denemez (0.3.39 düzeltmesi)."""
    words = _koerekort_words() + [_word("12.", 0.35, 0.60), _word("70.DK", 0.36, 0.60)]
    result = parse_local_fields(words, document_type_key="koerekort", rois_enabled=True, threshold=0.62)
    assert "cpr_number" not in result.fields


def test_parse_sundhedskort_fields_and_birth_derived_from_cpr() -> None:
    words = [
        _word("Navn", 0.08, 0.245), _word("ANDERS", 0.20, 0.245), _word("PRØVE", 0.35, 0.245), _word("TESTESEN", 0.48, 0.245),
        _word("CPR-nr.", 0.08, 0.375), _word("010112-4002", 0.24, 0.375),
        _word("Adresse", 0.08, 0.505), _word("Hovedgaden", 0.14, 0.505), _word("12,", 0.28, 0.505), _word("2.", 0.36, 0.505), _word("th.", 0.41, 0.505),
        _word("Postnr.", 0.06, 0.63), _word("og", 0.14, 0.63), _word("by", 0.18, 0.63), _word("2650", 0.26, 0.63), _word("Hvidovre", 0.36, 0.63),
    ]
    result = parse_local_fields(words, document_type_key="sundhedskort", rois_enabled=True, threshold=0.62)
    assert result.document_type == "sundhedskort"
    assert result.fields["full_name"].value == "ANDERS PRØVE TESTESEN"
    assert result.fields["cpr_number"].value == VALID_MOD11_CPR
    assert result.fields["address"].value == "Hovedgaden 12, 2. th."
    assert result.fields["postal_code"].value == "2650"
    assert result.fields["city"].value == "Hvidovre"
    # Sundhedskortta doğum satırı YOKTUR; doğum CPR'ın DDMMYY bölümünden türetilir.
    assert result.fields["birth_date"].value == "01.01.2012"


def test_estimate_skew_projection_search_and_deskew_align_rows() -> None:
    """İzdüşüm araması (saha 10 Eyl 2026): 5° eğik kartta satır-temelli
    kestirim ~0.2° ölçüyordu (gruplama ZATEN satırları birleştirmişti) —
    kestirim gruplamadan bağımsız olmalı."""
    import math

    canvas = (1280, 808)
    width, height = canvas
    tan_a = math.tan(math.radians(5.0))
    words: list[OcrWord] = []
    for row, ny in enumerate((0.20, 0.35, 0.50, 0.65)):
        for col, nx in enumerate((0.15, 0.30, 0.45, 0.60, 0.75)):
            cx = nx * width
            cy = ny * height + tan_a * (nx - 0.5) * width
            words.append(
                OcrWord(text=f"w{row}{col}", score=0.99, box=(int(cx - 30), int(cy - 10), int(cx + 30), int(cy + 10)))
            )
    assert abs(estimate_skew_deg(words, canvas) - 5.0) <= 0.5
    fixed = deskew_words(words, canvas)
    # Düzeltme sonrası her satırın y-merkez yayılımı satır aralığından küçük.
    lines = group_words_into_lines(fixed)
    assert len(lines) == 4
    for line in lines:
        ys = [w.center_y for w in line]
        assert max(ys) - min(ys) < height * 0.02


def test_deskew_noop_on_flat_and_sparse_words() -> None:
    flat = [_word("A", 0.2, 0.2), _word("B", 0.5, 0.205), _word("C", 0.8, 0.6), _word("D", 0.5, 0.9)]
    assert estimate_skew_deg(flat, CANVAS) == 0.0
    assert deskew_words(flat, CANVAS) == flat  # dokunulmaz
    assert estimate_skew_deg(flat[:2], CANVAS) == 0.0  # kelime/çift az → yargı yok


def test_deskew_skips_full_page_word_counts() -> None:
    """Kelime tavanı (0.3.40 incelemesi): O(n^2)x77 kestirim 200+ kelimede
    (tam sayfa — card_not_detected yolu, yanlış belge taraması) 0.4-2.2 sn
    CPU yakıyordu. Kart asla 200 kelime vermez; tavan üstünde yargı yok."""
    import time

    dense = [
        _word(f"w{i}", 0.1 + (i % 9) * 0.1, 0.1 + (i // 9) * 0.02) for i in range(250)
    ]
    started = time.perf_counter()
    assert estimate_skew_deg(dense, CANVAS) == 0.0
    assert time.perf_counter() - started < 0.05  # tavan üstü = anında çıkış


def test_parse_koerekort_title_noise_anchored_by_field_numbers() -> None:
    """Portre tarama warp kayması (saha 10 Eyl 2026): başlık ('DANM ARK')
    ad penceresine sızmış, konumsal 'ilk iki harf satırı' onu SOYAD sanıyordu.
    Kart satır başı alan no basar: '1.'/'2.' çapası satırı kesin seçer."""
    words = [
        _word("KØREKORT", 0.30, 0.060), _word("DANM", 0.42, 0.060), _word("ARK", 0.48, 0.060),
        _word("1.", 0.27, 0.125), _word("Jensen", 0.33, 0.125),
        _word("2.", 0.27, 0.210), _word("Thomas", 0.33, 0.210),
    ]
    result = parse_local_fields(words, document_type_key="koerekort", rois_enabled=True, threshold=0.62)
    assert result.fields["full_name"].value == "Thomas Jensen"


def test_parse_koerekort_merged_name_line_splits_at_anchors() -> None:
    """İki alan satırı TEK satırda birleşmiş ('1. Jensen 2. Thomas' — eğik
    tarama gruplaması): çapa SATIR BAŞINDA aranmayıp token taramasına
    geçildi, birleşik bölme dalı artık erişilebilir (0.3.40 incelemesi —
    eskiden 'Jensen Thomas' birleşik ve TERS dönüyordu)."""
    words = [
        _word("KØREKORT", 0.30, 0.060), _word("DANMARK", 0.42, 0.060),
        _word("1.", 0.27, 0.165), _word("Jensen", 0.33, 0.170),
        _word("2.", 0.55, 0.160), _word("Thomas", 0.61, 0.165),
    ]
    result = parse_local_fields(words, document_type_key="koerekort", rois_enabled=True, threshold=0.62)
    assert result.fields["full_name"].value == "Thomas Jensen"


def test_parse_sundhedskort_label_only_windows_produce_no_fields() -> None:
    """Saha 10 Eyl 2026: 'Sikr.' AD olmuş, 'SUNDHEDSKORT' ADRES olmuştu.
    Pencere yalnız etiket içeriyorsa alan ÜRETİLMEZ — etiketler değer
    olarak geri iade edilmez."""
    words = [
        _word("SUNDHEDSKORT", 0.10, 0.10),
        _word("Navn", 0.05, 0.245), _word("Sikr.", 0.20, 0.30), _word("1", 0.30, 0.30),
        _word("Gyldigt", 0.40, 0.30), _word("01.01.2026", 0.55, 0.30),
        _word("SUNDHEDSKORT", 0.05, 0.505),
    ]
    result = parse_local_fields(words, document_type_key="sundhedskort", rois_enabled=True, threshold=0.62)
    assert "full_name" not in result.fields
    assert "address" not in result.fields


def test_parse_sundhedskort_address_strips_name_and_postal_leak() -> None:
    """Eğik taramada ad satırı adrese sızar, pencere alt kenarı posta
    satırının '2650'sini keser (saha 10 Eyl 2026: adrese isim/posta yazılıyor)."""
    words = [
        _word("Thomas", 0.10, 0.245), _word("Jensen", 0.30, 0.245),
        _word("010112-4002", 0.20, 0.375),
        _word("Thomas", 0.05, 0.505), _word("Hvidovrevej", 0.12, 0.505),
        _word("120,", 0.30, 0.505), _word("st.", 0.38, 0.505), _word("tv.", 0.42, 0.505),
        _word("2650", 0.48, 0.505), _word("Jensen", 0.60, 0.505),
        _word("2650", 0.26, 0.63), _word("Hvidovre", 0.36, 0.63),
    ]
    result = parse_local_fields(words, document_type_key="sundhedskort", rois_enabled=True, threshold=0.62)
    assert result.fields["full_name"].value == "Thomas Jensen"
    assert result.fields["address"].value == "Hvidovrevej 120, st. tv."
    assert result.fields["postal_code"].value == "2650"
    assert result.fields["city"].value == "Hvidovre"


def _giant_word(text: str, nx: float, ny: float, *, height_ratio: float = 0.40, score: float = 0.95) -> OcrWord:
    """Filigran/artık DEVT kutu — merkez (nx, ny), yükseklik tuvalin oranı."""
    width, height = CANVAS
    cx, cy = nx * width, ny * height
    half_h = height_ratio * height / 2.0
    return OcrWord(text=text, score=score, box=(int(cx - 30), int(cy - half_h), int(cx + 30), int(cy + half_h)))


def test_parse_sundhedskort_real_layout_anchor_selects_rows() -> None:
    """Gerçek kart düzeni (saha 13 Eyl 2026, ölçülmüş): læge bloğu üstte, ad
    CPR'ın ALTINDA (SPECIMEN'ın tersi), satırlar DEV filigran kutusu
    ('SUNDHEDSKORT' h~0.43) tarafından tek satırda köprulanmiş. Çapa taraması
    (CPR bul → posta bul → yukarı tara) + dev-kutu filtresi satırları ayırır."""
    words = [
        _word("REGION", 0.06, 0.121), _word("Hovedstaden", 0.27, 0.140),
        _word("Laege", 0.081, 0.256), _word("JOHNNY", 0.12, 0.297), _word("WØLDIKE", 0.258, 0.298),
        _word("STRANDHOLMS", 0.17, 0.351), _word("ALLE", 0.328, 0.352), _word("7", 0.38, 0.353), _word("B", 0.406, 0.353),
        _word("200485-2985", 0.205, 0.452), _word("g:", 0.539, 0.457), _word("Sikr.", 0.54, 0.418),
        _word("1", 0.573, 0.46), _word("Gyldigt", 0.808, 0.422), _word("frac", 0.857, 0.422),
        _word("31.05.2016", 0.846, 0.492),
        _word("Recai", 0.111, 0.608), _word("Demir", 0.237, 0.608),
        _word("Paris", 0.103, 0.679), _word("Boulevard", 0.261, 0.681), _word("47", 0.385, 0.682),
        _word("1813", 0.856, 0.707),
        _word("2650", 0.10, 0.755), _word("Hvidovre", 0.244, 0.755), _word("AKUTTELEFONEN", 0.857, 0.766),
        _giant_word("SUNDHEDSKORT", 0.025, 0.528),
    ]
    result = parse_local_fields(words, document_type_key="sundhedskort", rois_enabled=True, threshold=0.62)
    assert result.fields["full_name"].value == "Recai Demir"
    assert result.fields["address"].value == "Paris Boulevard 47"
    assert result.fields["postal_code"].value == "2650"
    assert result.fields["city"].value == "Hvidovre"
    assert result.fields["cpr_number"].value == "2004852985"
    assert result.fields["birth_date"].value == "20.04.1985"


def test_parse_sundhedskort_specimen_layout_survives_clinic_row() -> None:
    """SPECIMEN düzeni (ad CPR ÜSTÜNDE) çapa yolunun İKİNCİ savunması: adres
    CPR'ın altında, altında klinik telefon satırı var. Posta satırı desene
    göre seçilir ('2650 Hvidovre'), telefon satırı aday değildir."""
    words = [
        _word("Navn", 0.08, 0.245), _word("ANDERS", 0.20, 0.245), _word("TESTESEN", 0.35, 0.245),
        _word("CPR-nr.", 0.08, 0.375), _word("010112-4002", 0.24, 0.375),
        _word("Hovedgaden", 0.14, 0.505), _word("12,", 0.28, 0.505),
        _word("Postnr.", 0.06, 0.63), _word("2650", 0.26, 0.63), _word("Hvidovre", 0.36, 0.63),
        _word("Lægehuset", 0.10, 0.755), _word("Prøve", 0.20, 0.755), _word("+45", 0.55, 0.755),
    ]
    result = parse_local_fields(words, document_type_key="sundhedskort", rois_enabled=True, threshold=0.62)
    assert result.fields["full_name"].value == "ANDERS TESTESEN"
    assert result.fields["address"].value == "Hovedgaden 12,"
    assert result.fields["city"].value == "Hvidovre"


def test_parse_sundhedskort_name_gate_empties_cpr_leak() -> None:
    """Ad penceresine CPR satırı sızmış (postal yok → çapa düşer, pencere
    yolu): '200485-2985 g: Sik. 1 Gyldigt frac' AD OLAMAZ — kapı boşaltır,
    alan üretilmez (nofields tetiği VLM kurtarma yolunu açar)."""
    words = [
        _word("200485-2985", 0.10, 0.30), _word("g:", 0.30, 0.30), _word("Sik.", 0.36, 0.30),
        _word("1", 0.44, 0.30), _word("Gyldigt", 0.55, 0.30), _word("frac", 0.65, 0.30),
        _word("Paris", 0.10, 0.62), _word("Boulevard", 0.25, 0.62), _word("47", 0.38, 0.62),
    ]
    result = parse_local_fields(words, document_type_key="sundhedskort", rois_enabled=True, threshold=0.62)
    assert "full_name" not in result.fields
    # CPR kendi penceresinden yine çıkar (ad kapısı CPR'ı etkilemez).
    assert result.fields["cpr_number"].value == "2004852985"


def test_parse_sundhedskort_address_gate_empties_cpr_row() -> None:
    """Kullanıcının saha bulgusu: 'Adres: 200485-2985 g: Sik. 1 Gyldigt frac'.
    Etiket düşürme + semantik süpürme sonrası adres kalitesi kapisini geçen
    şey kalmazsa alan ÜRETEİLMEZ."""
    words = [
        _word("Recai", 0.10, 0.30), _word("Demir", 0.25, 0.30),
        _word("200485-2985", 0.10, 0.505), _word("g:", 0.30, 0.505), _word("Sik.", 0.36, 0.505),
        _word("1", 0.44, 0.505), _word("Gyldigt", 0.55, 0.505), _word("frac", 0.65, 0.505),
    ]
    result = parse_local_fields(words, document_type_key="sundhedskort", rois_enabled=True, threshold=0.62)
    assert "address" not in result.fields


def test_parse_sundhedskort_window_fallback_city_from_postal_line_only() -> None:
    """CPR hiç okunamadı → çapa düşer, pencere yolu ayakta: geniş posta
    penceresi ad+adres+posta satırlarını toplar ama şehir YALNIZ posta
    desenli satırdan gelir ('Paris ... Hvidovre' birleşmez)."""
    words = [
        _word("Recai", 0.111, 0.55), _word("Demir", 0.237, 0.55),
        _word("Paris", 0.103, 0.62), _word("Boulevard", 0.261, 0.62), _word("47", 0.385, 0.62),
        _word("2650", 0.10, 0.68), _word("Hvidovre", 0.244, 0.68),
    ]
    result = parse_local_fields(words, document_type_key="sundhedskort", rois_enabled=True, threshold=0.62)
    assert "cpr_number" not in result.fields  # çapa olmadan CPR uydurulmaz
    assert result.fields["full_name"].value == "Recai Demir"
    assert result.fields["address"].value == "Paris Boulevard 47"
    assert result.fields["postal_code"].value == "2650"
    assert result.fields["city"].value == "Hvidovre"


def test_fuzzy_label_drop_matches_misreads_only() -> None:
    """Bulanık etiket düşürme: yanlış okumalar ('Sik.', 'frac') düşer; kısa
    GERÇEK kelimeler ('Frk', 'From') düşMEZ (bilinçli haric)."""
    from app.services.identity_local_parse import _is_label_token

    for token in ("Sik.", "frac", "Gyldigt", "Sikr", "Laege"):  # yanlış okuma ailesi
        assert _is_label_token(token), token
    for token in ("Frk", "From", "Parls", "Kbh", "Demir"):
        assert not _is_label_token(token), token


def test_parse_koerekort_glued_anchor_splits_value() -> None:
    """Yapışık çapa (saha 13 Eyl 2026): '1.Demir' TEK token — eski birebir
    regex çapayı düşürüp konumsal fallback tek alfa satırını soyada yazıyordu.
    'l.Demir' (1→l okuma) da onarılır."""
    glued = [
        _word("KØREKORT", 0.30, 0.06), _word("DANMARK", 0.42, 0.06),
        _word("1.Demir", 0.30, 0.125), _word("2.Recai", 0.30, 0.21),
    ]
    result = parse_local_fields(glued, document_type_key="koerekort", rois_enabled=True, threshold=0.62)
    assert result.fields["full_name"].value == "Recai Demir"
    assert result.fields["full_name"].checksum_ok is True  # iki parça = tam ad

    repaired = [
        _word("KØREKORT", 0.30, 0.06),
        _word("l.Demir", 0.30, 0.125), _word("2.Recai", 0.30, 0.21),
    ]
    result2 = parse_local_fields(repaired, document_type_key="koerekort", rois_enabled=True, threshold=0.62)
    assert result2.fields["full_name"].value == "Recai Demir"


def test_parse_koerekort_real_row_sequence_full_fields() -> None:
    """Gerçek kart satır dizisi (saha 13 Eyl 2026, ölçülmüş): ø→O başlık
    okuması, yapışık çapalar, ISO tarihler, '4d.200485-2985' önekli CPR,
    '4b.2055-04-20' belge penceresine sızmış, dev 'u8luas' kutusu."""
    words = [
        _word("DANMARK", 0.759, 0.185), _word("KOREKORT", 0.482, 0.215),
        _word("DK", 0.227, 0.312), _word("1.Demir", 0.412, 0.303), _word("2.Recai", 0.415, 0.365),
        _word("3.", 0.415, 0.424), _word("1985-04-20,", 0.526, 0.410), _word("Tyrkiet", 0.647, 0.399),
        _word("4a.", 0.425, 0.478), _word("2012-05-09", 0.523, 0.468),
        _word("4c.", 0.629, 0.459), _word("Rigspolitichefen", 0.750, 0.447),
        _word("4b.2055-04-20", 0.499, 0.530), _word("4d.200485-2985", 0.710, 0.508),
        _word("5.", 0.418, 0.601), _word("30499459", 0.515, 0.590),
        _giant_word("u8luas", 0.606, 0.681, height_ratio=0.19),
        _word("B-C-D-BE-CE-DE", 0.588, 0.811),
    ]
    result = parse_local_fields(words, document_type_key="koerekort", rois_enabled=True, threshold=0.62)
    assert result.fields["full_name"].value == "Recai Demir"
    assert result.fields["birth_date"].value == "20.04.1985"
    assert result.fields["expiry_date"].value == "20.04.2055"
    assert result.fields["cpr_number"].value == "2004852985"
    assert result.fields["doc_number"].value == "30499459"


def test_parse_koerekort_single_alpha_line_is_honest_needs_review() -> None:
    """Çapasız TEK alfa satırı: hangi yuvaya ait olduğu bilinemez — tek
    parçalı ad üretilse de checksum_kapısı onu needs_review'e düşürür
    (eski 'min or max' güven tuzağı yüksek güven basıyordu)."""
    words = [
        _word("KØREKORT", 0.30, 0.06), _word("DANMARK", 0.42, 0.06),
        _word("Recai", 0.30, 0.125),
    ]
    result = parse_local_fields(words, document_type_key="koerekort", rois_enabled=True, threshold=0.62)
    field = result.fields.get("full_name")
    assert field is not None and field.value == "Recai"
    assert field.checksum_ok is False  # tek parça = eksik bilgi
    out = local_fields_to_identity_fields(result.fields, threshold=0.62)
    assert out["full_name"].review == "needs_review"


def test_parse_pas_td3_mrz_with_printed_name_preference() -> None:
    words = [
        _word("Efternavn", 0.32, 0.275), _word("TESTESEN", 0.35, 0.271),
        _word("Fornavn", 0.31, 0.344), _word("ANDERS", 0.34, 0.384), _word("PRØVE", 0.44, 0.384),
        _word("17.11.1986", 0.35, 0.610),
        _word("P<DNKTESTESEN<<ANDERS<PROEVE<<<<<<<<<<<<<<<<", 0.44, 0.821),
        _word("2010000337DNK8611172M3103142<<<<<<<<<<<<<<<6", 0.44, 0.891),
    ]
    result = parse_local_fields(words, document_type_key="pas", rois_enabled=True, threshold=0.62)
    assert result.document_type == "passport"
    # Basılı ad (Æ/Ø haneleriyle) MRZ transliterasyonunu EZER — fixture kuralı.
    assert result.fields["full_name"].value == "ANDERS PRØVE TESTESEN"
    assert result.fields["doc_number"].value == "201000033"
    assert result.fields["birth_date"].value == "17.11.1986"
    assert result.fields["expiry_date"].value == "14.03.2031"


def test_parse_idkort_td1_mrz_fallback_fills_missing_printed() -> None:
    # Basılı satırlar okunamadı (aşınma/parlama) — yalnız TD1 MRZ şeridi var.
    words = [
        _word("I<DNKID10000660<<<<<<<<<<<<<<<", 0.27, 0.744),
        _word("8611172M3103142DNK<<<<<<<<<<<0", 0.27, 0.831),
        _word("TESTESEN<<ANDERS<PROEVE<<<<<<<", 0.27, 0.918),
    ]
    result = parse_local_fields(words, document_type_key="idkort", rois_enabled=True, threshold=0.62)
    assert result.document_type == "id_card"
    assert result.fields["full_name"].value == "ANDERS PROEVE TESTESEN"
    assert result.fields["doc_number"].value == "ID1000066"
    assert result.fields["birth_date"].value == "17.11.1986"
    assert result.fields["expiry_date"].value == "14.03.2031"


def test_parse_rois_disabled_returns_text_only() -> None:
    result = parse_local_fields(_koerekort_words(), document_type_key=None, rois_enabled=False, threshold=0.62)
    assert result.fields == {} and result.roi_fields == []
    assert "TESTESEN" in result.ocr_text  # tam-kart metni frontend fallback'ine döner
    # ROI'siz sonuçta alan yoktur; güven sinyali bölge uyarısıyla (card_not_detected)
    # taşınır — parse katmanı ayrıca bayrak üretmez.
    assert result.low_confidence is False


def test_parse_low_confidence_flag_on_weak_word() -> None:
    words = [_word("TESTESEN", 0.33, 0.125, score=0.30)]
    result = parse_local_fields(words, document_type_key="koerekort", rois_enabled=True, threshold=0.62)
    assert result.low_confidence is True


def test_build_ocr_text_preserves_line_order() -> None:
    text = build_ocr_text([_word("B", 0.6, 0.1), _word("A", 0.2, 0.1), _word("C", 0.2, 0.3)])
    assert text.splitlines()[0] == "A B"
    assert text.splitlines()[1] == "C"


def test_local_fields_to_identity_fields_review_decisions() -> None:
    fields = {
        "full_name": LocalField(value="ANDERS PRØVE TESTESEN", confidence=0.97, roi_key="1+2", checksum_ok=True),
        "doc_number": LocalField(value="DK1000099", confidence=0.30, roi_key="5", checksum_ok=True),
        "cpr_number": LocalField(value=INVALID_MOD11_CPR, confidence=0.97, roi_key="4d", checksum_ok=False),
    }
    out = local_fields_to_identity_fields(fields, threshold=0.62)
    assert isinstance(out["full_name"], IdentityFieldOut)
    assert out["full_name"].review == "validated"
    assert out["doc_number"].review == "needs_review"  # güven eşiği altı
    assert out["cpr_number"].review == "needs_review"  # checksum başarısız


def test_birth_date_consistent_with_cpr() -> None:
    assert birth_date_consistent_with_cpr(VALID_MOD11_CPR, "01.01.2012") is True
    assert birth_date_consistent_with_cpr(VALID_MOD11_CPR, "02.01.2012") is False
    # Ayrıştırılamayan değer yargı vermez (True = denetlenemedi).
    assert birth_date_consistent_with_cpr(None, "01.01.2012") is True


# ---------------------------------------------------------------------------
# Servis zinciri (WP1+WP2) — sahte motorla, gerçek RapidOCR kurulumu YOK
# ---------------------------------------------------------------------------


def _fake_sundhedskort_engine() -> _FakeEngine:
    """Flatbed sundhedskort düzeni (normalize koordinat) — run_local_ocr mutlu yolu."""
    return _FakeEngine(
        [
            ("Sundhedskort", 0.06, 0.10, 0.95),
            ("sygesikringsbevis", 0.30, 0.10, 0.95),
            ("ANDERS", 0.20, 0.245, 0.97),
            ("PRØVE", 0.35, 0.245, 0.97),
            ("TESTESEN", 0.48, 0.245, 0.97),
            ("CPR-nr.", 0.08, 0.375, 0.95),
            ("010112-4002", 0.24, 0.375, 0.98),
            ("Hovedgaden", 0.20, 0.505, 0.95),
            ("12,", 0.32, 0.505, 0.95),
            ("2650", 0.26, 0.63, 0.97),
            ("Hvidovre", 0.38, 0.63, 0.97),
        ]
    )


def test_run_local_ocr_happy_path_with_fake_engine(monkeypatch) -> None:
    engine = _fake_sundhedskort_engine()
    monkeypatch.setattr("app.services.identity_local_ocr_service.get_local_ocr_engine", lambda: engine)
    outcome = run_local_ocr(_flat_card_image(), threshold=0.62)
    assert engine.calls == 1
    assert outcome.engine_used is True and outcome.engine_name == "local"
    assert outcome.latency_ms > 0
    assert outcome.document_type == "sundhedskort"
    assert outcome.parse is not None
    assert outcome.parse.fields["cpr_number"].value == VALID_MOD11_CPR
    assert outcome.parse.fields["city"].value == "Hvidovre"
    assert outcome.ocr_text  # tam-kart metni her zaman döner (D5)
    assert outcome.warnings == []


def test_run_local_ocr_engine_unavailable_returns_empty_outcome(monkeypatch) -> None:
    monkeypatch.setattr("app.services.identity_local_ocr_service.get_local_ocr_engine", lambda: None)
    assert run_local_ocr(_flat_card_image()) == LocalOcrOutcome()


def test_run_local_ocr_garbage_bytes_does_not_raise(monkeypatch) -> None:
    monkeypatch.setattr("app.services.identity_local_ocr_service.get_local_ocr_engine", lambda: _FakeEngine([]))
    outcome = run_local_ocr(b"kesinlikle goruntu degil")
    assert outcome.engine_used is False and outcome.parse is None


def test_run_local_ocr_engine_exception_is_swallowed(monkeypatch) -> None:
    engine = _FakeEngine([], raise_on_recognize=RuntimeError("model patladi"))
    monkeypatch.setattr("app.services.identity_local_ocr_service.get_local_ocr_engine", lambda: engine)
    outcome = run_local_ocr(_flat_card_image())
    # Zincir crash etmez: boş kelime listesiyle devam eder, uyarı üretilir.
    assert outcome.engine_used is True
    assert "roi_low_confidence" in outcome.warnings


def test_run_local_ocr_unknown_type_appends_roi_low_confidence(monkeypatch) -> None:
    engine = _FakeEngine([("anlamsiz", 0.5, 0.5, 0.5), ("metin", 0.6, 0.6, 0.5)])
    monkeypatch.setattr("app.services.identity_local_ocr_service.get_local_ocr_engine", lambda: engine)
    outcome = run_local_ocr(_flat_card_image())
    assert outcome.document_type is None
    assert "roi_low_confidence" in outcome.warnings
    assert outcome.parse is not None and outcome.parse.fields == {}


def test_run_local_ocr_warning_tokens_are_contract_only(monkeypatch) -> None:
    engine = _FakeEngine(
        [
            ("Sundhedskort", 0.06, 0.10, 0.95),
            ("TESTESEN", 0.30, 0.245, 0.97),
            ("010101-9999", 0.24, 0.375, 0.98),  # mod-11 başarısız (yumuşak sinyal)
        ]
    )
    monkeypatch.setattr("app.services.identity_local_ocr_service.get_local_ocr_engine", lambda: engine)
    outcome = run_local_ocr(_flat_card_image())
    assert "cpr_mod11_failed_soft" in outcome.warnings
    # Uyarı token'ları sözleşme: plan WP2'deki dört token'dan başkası çıkmaz.
    allowed = {"glare_detected", "card_not_detected", "roi_low_confidence", "cpr_mod11_failed_soft"}
    assert set(outcome.warnings) <= allowed


def test_run_local_ocr_extreme_portrait_keeps_only_card_not_detected(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.identity_local_ocr_service.get_local_ocr_engine",
        lambda: _fake_sundhedskort_engine(),
    )
    extreme = _png_bytes(Image.new("RGB", (500, 1200), (120, 120, 120)))
    outcome = run_local_ocr(extreme)
    assert outcome.warnings == ["card_not_detected"]
    assert outcome.rois_enabled is False
    assert outcome.parse is not None and outcome.parse.fields == {}


def test_run_local_ocr_portrait_sparse_first_shot_retries_other_direction(monkeypatch) -> None:
    """180° ters yön tek-alan çöpüne güvenmez (0.3.40 incelemesi): motorun cls
    katmanı ters metni OKUR ama kutular 180° kayar → tip tanınır, TEK alan
    ('T. ECIMEN' gibi) döner. Eski '_weak' bunu ikna edici sayıp ilk atışta
    kırıyordu; artık ≥2 alan yoksa öbür yön denenir."""
    engine = _FakeEngine(
        [
            ("Sundhedskort", 0.06, 0.10, 0.95),
            ("sygesikringsbevis", 0.30, 0.10, 0.95),
            ("TESTESEN", 0.30, 0.245, 0.97),  # tip + tek alan → zayıf
        ]
    )
    monkeypatch.setattr("app.services.identity_local_ocr_service.get_local_ocr_engine", lambda: engine)
    portrait_frame = _png_bytes(Image.new("RGB", (600, 900), (200, 200, 200)))
    outcome = run_local_ocr(portrait_frame)
    assert engine.calls == 2  # tek-alan ilk atış ikna edici değil → öbür yön
    assert outcome.document_type == "sundhedskort"  # en iyi aday tipi korunur
    assert outcome.parse is not None and "full_name" in outcome.parse.fields


def test_run_local_ocr_portrait_frame_parses_after_rotation(monkeypatch) -> None:
    """Dikey kadraj taraması: region sideways döner, servis tuvali ±90°
    çevirip ÇEVRİLEN kare koordinatında parse eder (koordinat geri-eşleme
    YOKTUR — saha 10 Eyl 2026 portre kartı hiç okunmuyordu). Yön seçimi
    FOTO-SOL asimetrisiyle OCR'SİZ yapılır (Danimarka kartlarında foto dik
    karede sol üçtebirde: kenar yoğunluğu sol>sağ = dik; iki aday 180°
    fark içerdiğinden satır-bandı istatistiği yön ayırt ETMEZ — 21/50
    çöküşü); kazanan yönde TEK motor atışı koşar (p95 kapısı: iki tam OCR
    ~2.8s tutuyordu)."""
    engine = _fake_sundhedskort_engine()
    monkeypatch.setattr("app.services.identity_local_ocr_service.get_local_ocr_engine", lambda: engine)
    portrait_frame = _png_bytes(Image.new("RGB", (600, 900), (200, 200, 200)))
    outcome = run_local_ocr(portrait_frame)
    assert outcome.document_type == "sundhedskort"
    assert outcome.parse is not None
    assert outcome.parse.fields["cpr_number"].value == VALID_MOD11_CPR
    assert outcome.parse.fields["city"].value == "Hvidovre"
    assert engine.calls == 1  # ilk (istatistikle seçilen) yön ikna edici → tek atış


# ---------------------------------------------------------------------------
# Extract birleşimi (WP2/WP3) — yerel katman + barkod otoritesi
# ---------------------------------------------------------------------------


class _LocalSettings:
    identity_extract_enabled = False
    identity_extract_model = ""
    identity_extract_base_url = ""
    identity_extract_timeout_seconds = 5
    identity_extract_max_image_bytes = 8 * 1024 * 1024
    identity_extract_confidence_threshold = 0.62
    identity_local_ocr_enabled = True
    identity_local_ocr_model_label = "rapidocr test etiketi"
    identity_ocr_roi_overrides_json = ""
    openai_api_key = ""
    openai_model = "gpt-test"
    openai_base_url = "https://api.example/v1"


def _barcode_hit(cpr: str, *, verified: bool = True) -> IdentityBarcodeHit:
    """Sözleşmedeki barkod isabeti (servis katmanı gerçek decoder'ı kullanır)."""
    return IdentityBarcodeHit(cpr=cpr, cpr_digits=cpr, verified=verified, raw_text=cpr)


def _local_outcome(cpr_value: str | None) -> LocalOcrOutcome:
    fields: dict[str, LocalField] = {
        "full_name": LocalField(value="ANDERS PRØVE TESTESEN", confidence=0.97, roi_key="name", checksum_ok=True),
    }
    if cpr_value:
        fields["cpr_number"] = LocalField(value=cpr_value, confidence=0.98, roi_key="4d", checksum_ok=True)
    parse = type(
        "P",
        (),
        {
            "fields": fields,
            "ocr_text": "1. TESTESEN\n2. ANDERS PRØVE",
            "roi_fields": ["name", "4d"],
            "document_type": "driver_license",
            "low_confidence": False,
            "mod11_failed_soft": False,
        },
    )()
    return LocalOcrOutcome(
        engine_used=True,
        engine_name="local",
        latency_ms=123.4,
        warped=True,
        quad_detected=True,
        rois_enabled=True,
        roi_fields=["name", "4d"],
        document_type="driver_license",
        ocr_text="1. TESTESEN\n2. ANDERS PRØVE",
        parse=parse,
        warnings=[],
    )


@pytest.mark.asyncio
async def test_extract_local_plus_barcode_source_and_cpr_authority(monkeypatch) -> None:
    async def fail_post_chat(**kwargs: Any) -> dict[str, Any]:  # VLM kapalıyken çağrılmamalı
        raise AssertionError("VLM anahtarsız çağrılmamalı")

    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: _LocalSettings())
    monkeypatch.setattr("app.services.identity_extract_service.run_local_ocr", lambda *a, **k: _local_outcome("0101123457"))
    monkeypatch.setattr(
        "app.services.identity_extract_service.decode_identity_barcode",
        lambda _raw: _barcode_hit(VALID_MOD11_CPR),
    )
    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fail_post_chat)
    from app.services.identity_extract_service import extract_identity

    result = await extract_identity(image_data_url="data:image/png;base64,QUFB", side="front")
    assert result.source == "local+barcode"
    assert result.barcode is not None and result.barcode.verified is True
    # Barkod CPR OTORİTEDİR: basılı 4d (barkoddan farklı) needs_review'e düşer.
    assert result.fields["cpr_number"].value == VALID_MOD11_CPR
    assert result.fields["cpr_number"].review == "needs_review"
    assert any("uyuşmuyor" in w for w in result.warnings)
    assert result.engine is not None and result.engine.name == "local"
    assert result.engine.latency_ms == 123.4
    assert result.ocr_text == "1. TESTESEN\n2. ANDERS PRØVE"
    assert result.usage is None and result.model is None  # VLM koşmadı


@pytest.mark.asyncio
async def test_extract_local_only_when_no_barcode_and_no_vlm(monkeypatch) -> None:
    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: _LocalSettings())
    monkeypatch.setattr("app.services.identity_extract_service.run_local_ocr", lambda *a, **k: _local_outcome(VALID_MOD11_CPR))
    monkeypatch.setattr("app.services.identity_extract_service.decode_identity_barcode", lambda _raw: None)
    from app.services.identity_extract_service import extract_identity

    result = await extract_identity(image_data_url="data:image/png;base64,QUFB", side="front")
    assert result.source == "local"
    assert result.barcode is None
    assert result.fields["cpr_number"].value == VALID_MOD11_CPR
    assert result.fields["full_name"].review == "validated"
    assert any("Barkod okunamadı" in w for w in result.warnings)
    assert result.usage is None


@pytest.mark.asyncio
async def test_extract_local_flag_off_skips_local_tier(monkeypatch) -> None:
    class OffSettings(_LocalSettings):
        identity_local_ocr_enabled = False

    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: OffSettings())

    def _must_not_run(*a: Any, **k: Any) -> LocalOcrOutcome:
        raise AssertionError("bayrak kapalıyken yerel katman koşmamalı")

    monkeypatch.setattr("app.services.identity_extract_service.run_local_ocr", _must_not_run)
    monkeypatch.setattr(
        "app.services.identity_extract_service.decode_identity_barcode",
        lambda _raw: _barcode_hit(VALID_MOD11_CPR),
    )
    from app.services.identity_extract_service import extract_identity

    result = await extract_identity(image_data_url="data:image/png;base64,QUFB", side="front")
    assert result.source == "barcode"
    assert result.engine is not None and result.engine.name == "none"
    assert result.ocr_text is None
