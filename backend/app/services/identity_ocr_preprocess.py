"""Kimlik OCR ön-işleme (0.3.39 D4) — opencv-headless, tamamen bellek içi.

Zincir: bayt → BGR → uzun kenar ~1600px'e küçültme (gecikme) → kart dörtgeni
→ ID-1 tuvaline perspektif warp → (ROI kırpımı / parlama tespiti).

D4 kabul kapıları: dörtgen alanı ≥ karenin %8'i, köşe açıları 90°±25°,
warp sonrası en-boy 1.586±%35. Dörtgen yoksa kare ID-1±%15 → flatbed
taraması kabul edilir (warp yok); o da değilse tam-kare OCR + ``card_not_detected``
uyarısı ve ROI'ler devre dışı. Toleranslar modül sabitidir — benchmark'ta
veri gibi ayarlanır.

Güvenlik/GDPR: hiçbir fonksiyon diske YAZMAZ; görüntü NumPy dizisi olarak
yaşar ve çağrı bittiğinde atılır. Tek diske yazan yer benchmark'ın
``--roi-dump`` seçeneğidir ve o repo DIŞINA yazar.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from io import BytesIO
from typing import Any

import numpy as np

from app.services.identity_ocr_rois import (
    ID1_ASPECT,
    ID1_CANVAS_HEIGHT,
    ID1_CANVAS_WIDTH,
    FieldRoi,
)

logger = logging.getLogger(__name__)

# --- D4 toleransları (benchmark'ta ayarlanır) -------------------------------
QUAD_MIN_AREA_RATIO = 0.05          # dörtgen alanı ≥ karenin %5'i. Gerçek ID-1
                                     # kart (86x54mm) A4 @300 DPI tam sayfada
                                     # karenin %7.45'idir — %8 eşiği onu REDDEDİYOR,
                                     # saha taraması card_not_detected'e düşüyordu
                                     # (10 Eyl 2026: dükkân WIA taraması çöp alan).
QUAD_MAX_AREA_RATIO = 0.95          # >%95 = kare ÇERÇEVESİ: kart değil, tüm fotoğraf
                                     # (karanlık kart + parlak masa: Otsu çerçeve
                                     # dış hattını "kart" sanırdı — whole-frame guard)
QUAD_ANGLE_TOLERANCE_DEG = 25.0     # köşe açıları 90°±25°
QUAD_ASPECT_TOLERANCE = 0.35        # warp sonrası en-boy 1.586±%35
                                     # (telefon fotoğrafı perspektifi en-boyu
                                     # belirgin bozar — yatay taraf geniş)
QUAD_ASPECT_TOLERANCE_PORTRAIT = 0.15  # dikey kart hedefi 1/1.586±%15: gerçek
                                     # portre kartın dörtgeni ~0.63'te SIKI
                                     # durur; ±%35'lik bant pasaportun sol
                                     # şeridi gibi DİKEY METİN BLOKLARINI
                                     # (0.77) kart sanıyordu (fixture
                                     # regresyonu 10 Eyl 2026)
ID1_FRAME_TOLERANCE = 0.10          # flatbed: kare en-boy ID-1±%10
                                     # (%15 A4-dikey-taramayı (1.415) kabul
                                     # ediyordu: kart sayfada küçük kalır, ROI'ler
                                     # boş luğa düşerdi — daraltıldı)
FRAME_FILL_QUAD_MIN_RATIO = 0.50    # kadraj-kabul yolunda dörtgen yalnız
                                     # karenin ≥%50'sini dolduruyorsa geçerli
                                     # kart sınırıdır: iç blok (foto/metin, ~%29)
                                     # bu kapının altında kalır (asis CLAHE
                                     # regresyonu), gerçek kart kenar marjıyla
                                     # dizilse bile ≥%70'dir
ORTHO_FILL_QUAD_MIN_RATIO = 0.30    # kadraja DİK yerleşmiş kart sondası:
                                     # manzara kadrajda (3:2/16:10 foto) dikey
                                     # kart en çok %36-44 dolabilir (0.63/r),
                                     # ≥%50 kapısına geometrik olarak takılırdı
                                     # ve ham kare 90° yanlış okunuyordu (0.3.40
                                     # incelemesi). Dik-yön dörtgeni ≥%30 ister:
                                     # gerçek kart %36+; kartın iç foto bloğu
                                     # kadrajın ~%16'sıdır (kart %90 dolguda),
                                     # kapının altında kalır
DOWNSCALE_LONG_EDGE = 1600          # det öncesi gecikme üst sınırı
ROI_UPSCALE_FACTOR = 2.5            # küçük ROI kırpımı büyütme (INTER_CUBIC)

# Parlama (specular highlight): doygunluğu düşük, parlaklığı DOYMUŞ blob.
# 248 eşiği beyaz kart yüzeyini (genelde V≈200-240) aday listesinin dışında
# tutar; yalnız kliplenmiş (255'e yaslanmış) yansıma adaydır.
GLARE_SATURATION_MAX = 60
GLARE_VALUE_MIN = 248
GLARE_MIN_AREA_RATIO = 0.004        # kart alanının ~%0.4'ü yeterli sinyal
# Beyaz kartın KENDİSİ de düşük doygunluk + yüksek parlaklıktır; yansıma ile
# ayrımı yüzey parlaklık farkı verir: blob ortalaması kart medyanından
# yeterince parlak değilse yansıma DEĞİLDİR (düz beyaz kart false positive).
GLARE_BRIGHTNESS_MARGIN = 12


def decode_to_bgr(image_bytes: bytes) -> np.ndarray | None:
    """Görüntü baytlarını BGR NumPy dizisine çözer (bellek içi, diske yazmaz).

    Bozuk/boş bayt → None (çağıran zarif düşer; crash yok).
    """
    if not image_bytes:
        return None
    import cv2
    from PIL import Image

    try:
        with Image.open(BytesIO(image_bytes)) as img:
            rgb = np.array(img.convert("RGB"))
    except Exception as exc:
        logger.warning("Kimlik OCR: görüntü çözülemedi (%s)", type(exc).__name__)
        return None
    if rgb.ndim != 3 or rgb.size == 0:
        return None
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def downscale_long_edge(image: np.ndarray, target_long_edge: int = DOWNSCALE_LONG_EDGE) -> np.ndarray:
    """Uzun kenarı hedef piksele indirir (küçük görüntü olduğu gibi kalır).

    300 DPI taramalar 3500x2300 piksele çıkabildiği için det katmanına
    girmeden küçültmek p95 gecikmesini düşürür (plan riski: CPU gecikme > 2s).
    """
    import cv2

    height, width = image.shape[:2]
    long_edge = max(height, width)
    if long_edge <= target_long_edge:
        return image
    scale = target_long_edge / float(long_edge)
    new_size = (max(1, int(round(width * scale))), max(1, int(round(height * scale))))
    return cv2.resize(image, new_size, interpolation=cv2.INTER_AREA)


def order_quad_points(quad: np.ndarray) -> np.ndarray:
    """Dört noktayı sol-üst, sağ-üst, sağ-alt, sol-alt sırasına dizer."""
    points = np.asarray(quad, dtype=np.float32).reshape(4, 2)
    center = points.mean(axis=0)
    deltas = points - center
    angles = np.arctan2(deltas[:, 1], deltas[:, 0])
    ordered = points[np.argsort(angles)]
    start = int(np.argmin((ordered[:, 0] + ordered[:, 1])))
    rotated = np.roll(ordered, -start, axis=0)
    return rotated.astype(np.float32)


def _corner_angles(quad: np.ndarray) -> list[float]:
    """Dörtgenin iç açıları (derece) — 90°'ye yakınlık kapısı için."""
    points = np.asarray(quad, dtype=np.float64).reshape(4, 2)
    angles: list[float] = []
    for i in range(4):
        prev = points[(i - 1) % 4]
        cur = points[i]
        nxt = points[(i + 1) % 4]
        v1 = prev - cur
        v2 = nxt - cur
        norm = float(np.linalg.norm(v1) * np.linalg.norm(v2))
        if norm == 0.0:
            return [180.0] * 4
        cosine = float(np.dot(v1, v2) / norm)
        angles.append(float(np.degrees(np.arccos(np.clip(cosine, -1.0, 1.0)))))
    return angles


def detect_card_quad(
    image: np.ndarray,
    *,
    min_area_ratio: float = QUAD_MIN_AREA_RATIO,
    angle_tolerance_deg: float = QUAD_ANGLE_TOLERANCE_DEG,
    aspect_tolerance: float = QUAD_ASPECT_TOLERANCE,
    portrait_aspect_tolerance: float = QUAD_ASPECT_TOLERANCE_PORTRAIT,
    orientation: str = "any",
) -> tuple[np.ndarray, bool] | None:
    """En büyük uygun dörtgen konturu bulur; yoksa None döner.

    Dönüş: ``(noktalar, yan_yatik)``. Kart DİKEY yerleştirilmişse (uzun kenar
    düşey — flatbed camına dikey konan kart) noktalar bir kaydırmayla yatay
    eşlenir ve ``yan_yatik=True`` döner: warp tuvali yine 1280x808'dir ama
    içerik 90° dönük basılır; motor katmanı tuvali her iki yönde çevirip
    hangisi okunursa onu kullanır (saha: kart her zaman yatay konmuyor).

    ``orientation``: "any" (default) her iki bant, "portrait"/"landscape"
    yalnız o en-boy bandındaki dörtgeni kabul eder — kadraja DİK kart sondası
    kadraj yönündeki iç blokları bilinçli dışlar.

    İki geçiş: Canny kenarları, sonra Otsu ikili masası (düşük kontrastlı
    fotoğraflarda kenar zayıf kalır). Her iki geçiş de aynı kabul kapılarını
    kullanır — kapılar D4'te sabitlenmiştir.
    """
    import cv2

    height, width = image.shape[:2]
    frame_area = float(height * width)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    masks = [
        cv2.dilate(cv2.Canny(gray, 50, 150), np.ones((3, 3), np.uint8), iterations=1),
    ]
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    masks.append(otsu)
    # Açık/beyaz kapak: kart-zemin kontrastı Otsu ve Canny eşiğinin altında
    # kalır (deney: beyaz kapağın en büyük konturu %4 — kart değil). CLAHE
    # yerel kontrastı eşitleyip kart kenarını geri getirir; SON geçiştir,
    # yalnız ilk ikisi kart bulamadığında koşar.
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
    masks.append(cv2.dilate(cv2.Canny(clahe, 30, 90), np.ones((3, 3), np.uint8), iterations=1))

    landscape_ok = orientation in ("any", "landscape")
    portrait_ok = orientation in ("any", "portrait")
    for mask in masks:
        contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        ordered = sorted(contours, key=cv2.contourArea, reverse=True)[:8]
        for contour in ordered:
            area = float(cv2.contourArea(contour))
            if area < min_area_ratio * frame_area:
                break  # alanlara göre sıralı: gerisi daha küçük
            if area > QUAD_MAX_AREA_RATIO * frame_area:
                continue  # kare çerçevesinin kendisi: kart değil tüm fotoğraf
            perimeter = cv2.arcLength(contour, True)
            if perimeter <= 0:
                continue
            approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
            if len(approx) != 4 or not cv2.isContourConvex(approx):
                continue
            quad = order_quad_points(approx.reshape(4, 2))
            if any(abs(angle - 90.0) > angle_tolerance_deg for angle in _corner_angles(quad)):
                continue
            warped_aspect = _quad_aspect(quad)
            if warped_aspect is None or warped_aspect <= 0:
                continue
            if landscape_ok and abs(warped_aspect - ID1_ASPECT) / ID1_ASPECT <= aspect_tolerance:
                return quad, False
            # Dikey kart: hedef en-boy 1/1.586 ≈ 0.63. Dörtgen OLDUĞU GİBİ
            # döner (nokta kaydırma YOK — kaydırmalı warp kartı yatay tuvale
            # 2.45x GERER, metni bozar). Kart portre tuvale (808x1280) gerilir
            # ve motor katmanı tuvali ±90° çevirip dik okur.
            portrait_target = 1.0 / ID1_ASPECT
            if portrait_ok and abs(warped_aspect - portrait_target) / portrait_target <= portrait_aspect_tolerance:
                return quad, True
    return None


def _quad_aspect(quad: np.ndarray) -> float | None:
    """İŞARETLİ en-boy: üst/alt kenar ortalaması ÷ sol/sağ kenar ortalaması.

    Yatay kartta ~1.59, dikey kartta ~0.63 döner (eski sürüm her zaman ≥1
    döndüğü için dikey kart en-boy kapısından DÜŞÜYOR ve tarama
    card_not_detected oluyordu).
    """
    points = np.asarray(quad, dtype=np.float64).reshape(4, 2)
    top = float(np.linalg.norm(points[1] - points[0]))
    bottom = float(np.linalg.norm(points[2] - points[3]))
    left = float(np.linalg.norm(points[3] - points[0]))
    right = float(np.linalg.norm(points[2] - points[1]))
    height = (left + right) / 2.0
    if height <= 0:
        return None
    return ((top + bottom) / 2.0) / height


def warp_to_id1(
    image: np.ndarray,
    quad: np.ndarray,
    canvas: tuple[int, int] = (ID1_CANVAS_WIDTH, ID1_CANVAS_HEIGHT),
) -> np.ndarray:
    """Dörtgeni ID-1 tuvaline (varsayılan 1280x808) perspektif düzeltir."""
    import cv2

    width, height = canvas
    destination = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(np.asarray(quad, dtype=np.float32).reshape(4, 2), destination)
    return cv2.warpPerspective(image, matrix, (width, height), flags=cv2.INTER_CUBIC)


def frame_aspect_ratio(image: np.ndarray) -> float:
    height, width = image.shape[:2]
    return width / float(height) if height else 0.0


def looks_like_id1_frame(
    image: np.ndarray,
    *,
    aspect: float = ID1_ASPECT,
    tolerance: float = ID1_FRAME_TOLERANCE,
) -> bool:
    """Kare (flatbed/auto-crop taraması) ID-1 kadrajında mı — yatay VEYA dikey?

    Dikey yerleşim (kart yan konmuş, kadraj portre 1:1.586) de kart-dolu
    kadrajdır; dörtgen aramak yine içerideki blokları yanlışlıkla 'kart'
    sanabilir. Portre kadraj ``isolate_card``da ``sideways=True`` üretilir,
    motor katmanı ±90° çevirip okur.
    """
    ratio = frame_aspect_ratio(image)
    if ratio <= 0:
        return False
    return (
        abs(ratio - aspect) / aspect <= tolerance
        or abs(ratio - 1.0 / aspect) * aspect <= tolerance
    )


@dataclass(slots=True)
class CardRegion:
    """Kartın izole hali + hangi yoldan geldiğinin teşhis bilgisi."""

    image: np.ndarray
    warped: bool
    quad_detected: bool
    rois_enabled: bool
    warnings: list[str]
    # Kart camın/fotoğrafın düzleminde 90° dönük yakalandıysa True: tuval
    # 1280x808'dir ama içerik yan yatık — motor katmanı çevirip yeniden okur.
    sideways: bool = False


def isolate_card(image: np.ndarray, *, warp_source: np.ndarray | None = None) -> CardRegion:
    """D4 zinciri: ID-1 kadraj → dörtgen/warp → tam-kare OCR.

    ``warp_source``: dörtgen ``image`` üzerinde aranır (gecikme — küçük kare),
    warp bu kareden yapılır (kalite — tam çözünürlük). A4 @300 DPI taramada
    kart 1600px sınırında ~460px'e düşer; küçük kareden warp 2.8x büyütmek
    yerine tam çözünürlükten 1.3x büyütmek metin tanınmasını belirgin
    iyileştirir (saha 10 Eyl 2026). Boyutlar aynıysa fark yoktur.

    - kare zaten ID-1±%10 kadrajında (yatay VEYA dikey) → flatbed/auto-crop
      kabulü. SERBEST dörtgen aranmaz (iç blok — foto/metin alanı — en-boy
      eşiğine uyan YANLIŞ dörtgen üretür), ama karenin ≥%50'sini dolduran
      dörtgen gerçek kart sınırı sayılır ve warp edilir (marj kırpılır,
      tuval ölçeği garanti edilir — küçük kareyi ham okumak başlığı
      parçalatıyordu: 'DANMARK'→'DAN M ARK'). Dörtgen yoksa kare olduğu
      gibi kullanılır (büyütme YOK — suni ölçek tanınmayı bozuyor).
      Kalan eğim kelime katmanında düzeltilir (deskew); dikey kadrajda
      ``sideways=True`` döner (motor katmanı çevirir).
    - dörtgen bulundu → warp, ROI'ler açık (dikey kartsa ``sideways=True``)
    - ikisi de değil → tam-kare OCR + ``card_not_detected``, ROI'ler kapalı
    """

    def _warp(quad: np.ndarray, sideways: bool) -> np.ndarray:
        source = image if warp_source is None else warp_source
        canvas = (ID1_CANVAS_HEIGHT, ID1_CANVAS_WIDTH) if sideways else (ID1_CANVAS_WIDTH, ID1_CANVAS_HEIGHT)
        if source is image or source.shape == image.shape:
            return warp_to_id1(source, quad, canvas=canvas)
        source_quad = quad * np.array(
            [source.shape[1] / image.shape[1], source.shape[0] / image.shape[0]],
            dtype=np.float32,
        )
        return warp_to_id1(source, source_quad, canvas=canvas)

    if looks_like_id1_frame(image):
        ratio = frame_aspect_ratio(image)
        frame_sideways = abs(ratio - 1.0 / ID1_ASPECT) * ID1_ASPECT <= ID1_FRAME_TOLERANCE
        # Serbest dörtgen arama YASAK (iç blok yanılgısı), ama TUVALİ DOLDURAN
        # dörtgen (≥%50) gerçek kart sınırıdır: kenar marjlı karede warp hem
        # marjı kırpıp metni tuval ölçeğine taşır hem kalan perspektifi düzeltir.
        found = detect_card_quad(image, min_area_ratio=FRAME_FILL_QUAD_MIN_RATIO)
        if found is not None:
            quad, sideways = found
            return CardRegion(
                image=_warp(quad, sideways),
                warped=True,
                quad_detected=True,
                rois_enabled=True,
                warnings=[],
                sideways=sideways,
            )
        # Kadraja DİK yerleşmiş kart: manzara kadrajda (3:2/16:10) dikey kart
        # en çok %44 dolabildiğinden ≥%50 kapısına takılır, ham kare 90° yanlış
        # okunurdur. Yalnız ORTOGONAL en-boy bandında dörtgen aranır — kadraj
        # yönündeki iç bloklar (foto/metin) bant dışı kalır, kapı da %30'dur.
        found = detect_card_quad(
            image,
            min_area_ratio=ORTHO_FILL_QUAD_MIN_RATIO,
            orientation="portrait" if ratio >= 1.0 else "landscape",
        )
        if found is not None:
            quad, sideways = found
            return CardRegion(
                image=_warp(quad, sideways),
                warped=True,
                quad_detected=True,
                rois_enabled=True,
                warnings=[],
                sideways=sideways,
            )
        return CardRegion(
            image=image,
            warped=False,
            quad_detected=False,
            rois_enabled=True,
            warnings=[],
            sideways=frame_sideways,
        )
    found = detect_card_quad(image)
    if found is not None:
        quad, sideways = found
        return CardRegion(
            image=_warp(quad, sideways),
            warped=True,
            quad_detected=True,
            rois_enabled=True,
            warnings=[],
            sideways=sideways,
        )
    return CardRegion(
        image=image,
        warped=False,
        quad_detected=False,
        rois_enabled=False,
        warnings=["card_not_detected"],
    )


def crop_roi(image: np.ndarray, roi: FieldRoi, *, upscale: float = ROI_UPSCALE_FACTOR) -> np.ndarray:
    """Normalize ROI'yi piksel dikdörtgenine çevirip 2.5x INTER_CUBIC büyütür.

    PP-OCRv6 rec modeli 48px satır yüksekliği bekler: warp tuvalinde bir
    basılı satır ~30-40px kaldığı için kırpımı büyütme tanıma doğruluğunu
    belirgin artırır (benchmark --roi-dump bu kırpımları diske yazar).
    """
    import cv2

    height, width = image.shape[:2]
    x0 = int(round(roi.x * width))
    y0 = int(round(roi.y * height))
    x1 = int(round((roi.x + roi.w) * width))
    y1 = int(round((roi.y + roi.h) * height))
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(width, x1), min(height, y1)
    if x1 - x0 < 2 or y1 - y0 < 2:
        return np.empty((0, 0, 3), dtype=np.uint8)
    crop = image[y0:y1, x0:x1]
    if upscale and upscale > 1.0:
        crop = cv2.resize(
            crop,
            (int(round(crop.shape[1] * upscale)), int(round(crop.shape[0] * upscale))),
            interpolation=cv2.INTER_CUBIC,
        )
    return crop


def normalize_polarity(crop: np.ndarray, *, binarize: bool = False) -> np.ndarray:
    """CLAHE (+ isteğe bağlı Otsu) ile kontrast/kutup normalizasyonu.

    Default YALNIZ CLAHE'dir: PP-OCR det/rec doğal (anti-alias'lı) gri seviye
    bekler, sert ikili masada doğruluk düşer. ``binarize=True`` yalnız
    benchmark/teşhis kırpımları içindir; Otsu sonrası kutup düzeltilir ki
    yazı her zaman koyu, zemin açık olsun (azınlık piksel sınıfı yazıdır).

    Çıktı 3 kanallı BGR'dir (OCR motorunun beklediği biçim).
    """
    import cv2

    if crop.size == 0:
        return crop
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    if not binarize:
        return cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)
    _threshold, binary = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Yazı azınlıktır; beyaz AZINLIKTA kaldıysa yazı beyaz demektir → kutubu
    # tersle ki sonuç her zaman koyu yazı/açık zemin olsun.
    if np.count_nonzero(binary) < binary.size / 2:
        binary = cv2.bitwise_not(binary)
    return cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)


def detect_glare(
    image: np.ndarray,
    *,
    saturation_max: int = GLARE_SATURATION_MAX,
    value_min: int = GLARE_VALUE_MIN,
    min_area_ratio: float = GLARE_MIN_AREA_RATIO,
    brightness_margin: float = GLARE_BRIGHTNESS_MARGIN,
) -> bool:
    """Specular parlama tespiti: düşük doygunluk + yüksek parlaklık blob'u.

    İki kapı vardır (beyaz kartın kendisi aday GÖRÜNÜR, karışmaz):
    1. yüzey parlaklığı — aday blob'un ortalaması kart medyanından
       ``brightness_margin`` kadar parlak değilse yansıma değildir;
    2. alan — en büyük blob kartın ~%0.4'ünden küçükse sinyal sayılmaz.
    Pozitifte ``glare_detected`` uyarısı üretilir (frontend yeniden çek
    önerisi gösterir).
    """
    import cv2

    if image.size == 0:
        return False
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    candidate = (value >= value_min) & (saturation <= saturation_max)
    if not candidate.any():
        return False
    surface_median = float(np.median(value))
    if float(value[candidate].mean()) - surface_median < brightness_margin:
        return False
    mask = candidate.astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    _count, _labels, stats, _centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if stats.shape[0] <= 1:
        return False
    largest = stats[1:, cv2.CC_STAT_AREA].max()
    return (float(largest) / float(mask.size)) >= min_area_ratio


def quad_overlay(image: np.ndarray, quad: np.ndarray | None) -> np.ndarray:
    """Teşhis görseli: dörtgeni kart üzerine çizer (yalnız benchmark --roi-dump)."""
    import cv2

    overlay = image.copy()
    if quad is not None:
        points = np.asarray(quad, dtype=np.int32).reshape(4, 1, 2)
        cv2.polylines(overlay, [points], isClosed=True, color=(0, 200, 0), thickness=4)
    return overlay


def describe_geometry() -> dict[str, Any]:
    """Teşhis/benchmark çıktısı için tolerans özeti (veri gibi ayarlanır)."""
    return {
        "id1_aspect": ID1_ASPECT,
        "canvas": [ID1_CANVAS_WIDTH, ID1_CANVAS_HEIGHT],
        "quad_min_area_ratio": QUAD_MIN_AREA_RATIO,
        "quad_max_area_ratio": QUAD_MAX_AREA_RATIO,
        "quad_angle_tolerance_deg": QUAD_ANGLE_TOLERANCE_DEG,
        "quad_aspect_tolerance": QUAD_ASPECT_TOLERANCE,
        "id1_frame_tolerance": ID1_FRAME_TOLERANCE,
        "downscale_long_edge": DOWNSCALE_LONG_EDGE,
    }


def debug_card_region(
    image_bytes: bytes,
    *,
    long_edge: int = DOWNSCALE_LONG_EDGE,
) -> tuple[np.ndarray | None, np.ndarray | None]:
    """Benchmark/teşhis: kart bölgesini + dörtgeni yeniden üretir.

    Yalnız ``--roi-dump`` çağırır; servis yolu bu fonksiyonu kullanmaz
    (gerekmemesi dışında bir farkı yoktur — her iki yol da bellek içidir,
    diske yazan tek yer benchmark'ın kendi ``--roi-dump`` yazıcıdır).
    """
    frame = decode_to_bgr(image_bytes)
    if frame is None:
        return None, None
    scaled = downscale_long_edge(frame, long_edge)
    found = detect_card_quad(scaled)
    if found is not None:
        quad, sideways = found
        canvas = (ID1_CANVAS_HEIGHT, ID1_CANVAS_WIDTH) if sideways else (ID1_CANVAS_WIDTH, ID1_CANVAS_HEIGHT)
        return warp_to_id1(scaled, quad, canvas=canvas), quad
    return scaled, None
