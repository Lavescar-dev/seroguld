"""Yerel kimlik OCR motor sarmalayıcı (0.3.39 D1) — RapidOCR ONNX, CPU.

Motor Python backend'dedir: installer dükkân PC'sine bakar, ağ hop'u yok,
görüntü dükkândan HİÇ çıkmaz. RapidOCR 3.x gömülü PP-OCRv6 det/rec small +
cls modelleriyle gelir (site-packages/rapidocr/models/*.onnx) — runtime'da
model indirme YASAKTIR, konfigürasyonda indirme yolu hiç açılmaz.

Dayanıklılık sözleşmesi: import/kurulum/çıkarsama hatalarının HİÇBİRİ
tarama yolunu crash ettirmez. ``engine_available()`` import+kurulum probu
yapar; başarısızsa capabilities ``local_engine=False`` döner ve istek
Windows.Media.Ocr fallback'ine düşer (D6).

Gecikme: onnxruntime intra/inter-op iş parçacığı 2'ye sabitlenir (dükkân
PC'si çekirdeğini tek istekle işgal etmesin) ve det öncesi uzun kenar
~1600px'e küçültülür. RapidOCR'ın kendi logger'ı WARNING'e çekilir ki
backend logları INFO yapım satırlarıyla kirlenmesin.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field as dc_field
from typing import Any

from app.services.identity_ocr_preprocess import (
    DOWNSCALE_LONG_EDGE,
    CardRegion,
    decode_to_bgr,
    detect_glare,
    downscale_long_edge,
    isolate_card,
)
from app.services.identity_local_parse import (
    LocalParseResult,
    OcrWord,
    guess_document_type,
    parse_local_fields,
)

logger = logging.getLogger(__name__)

# rapidocr'in kendi renkli logger'ı (INFO yapım satırları basmaması için).
RAPIDOCR_LOGGER_NAME = "RapidOCR"

# onnxruntime CPU iş parçacığı sınırı — tek tarama sunucuyu/POS'u kilitlemesin.
ONNXRUNTIME_INTRA_OP_THREADS = 2
ONNXRUNTIME_INTER_OP_THREADS = 2

ENGINE_NAME = "local"


class LocalOcrEngine:
    """RapidOCR'ın tembel, tek örnekli sarmalayıcısı.

    Kurulum başarısızsa ``available=False`` ile örneklenir: tekrar deneme
    maliyeti yok, çağıran taraf zarif düşer.
    """

    def __init__(self) -> None:
        self.available = False
        self.error: str = ""
        self._engine: Any = None
        try:
            self._engine = self._construct()
            self.available = True
        except Exception as exc:  # noqa: BLE001 — asla crash yok (D1 sözleşmesi)
            self.error = f"{type(exc).__name__}: {exc}"
            logger.warning("Yerel kimlik OCR motoru kurulamadı: %s", self.error)

    @staticmethod
    def _configure_logging() -> None:
        """RapidOCR INFO yapım/kurulum satırlarını backend loglarından uzak tutar."""
        logging.getLogger(RAPIDOCR_LOGGER_NAME).setLevel(logging.WARNING)

    def _construct(self) -> Any:
        from rapidocr import RapidOCR

        self._configure_logging()
        # params: rapidocr 3.x dot-key güncelleme yüzeyi (config.yaml derin birleşim).
        # Modeller wheel package-data'sıdır (models/*.onnx) — model_path VERİLMEZ,
        # runtime indirme yolu hiç açılmaz (installer offline kuralı).
        return RapidOCR(
            params={
                "EngineConfig.onnxruntime.intra_op_num_threads": ONNXRUNTIME_INTRA_OP_THREADS,
                "EngineConfig.onnxruntime.inter_op_num_threads": ONNXRUNTIME_INTER_OP_THREADS,
                "Global.log_level": "warning",
            }
        )

    def recognize(self, image: Any, *, word_boxes: bool = True) -> list[OcrWord]:
        """Tek çıkarsama: BGR dizisi → kelime kutuları (hata → boş liste)."""
        if self._engine is None:
            return []
        self._configure_logging()
        try:
            output = self._engine(image, return_word_box=word_boxes)
            return self._to_words(output)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Yerel kimlik OCR çıkarsama hatası: %s", type(exc).__name__)
            return []

    @staticmethod
    def _to_words(output: Any) -> list[OcrWord]:
        """RapidOCR çıktısını OcrWord'e çevirir (kelime kutusu yoksa satır kutusu).

        3.x ``word_results`` verir: ((kelime, skor, kutu), ...) satır başına
        bir demet. Eski/sade biçim (txts/scores/boxes) için satır metni tek
        kelime kabul edilir — parse katmanı ikisini de yutar. Metin
        bulunamayan görüntüde 3.9.2 ``word_results``'u bozuk biçimde doldurur
        (satır yerine TEK kelime demeti: ``(('', 1.0, None),)``) — açılım
        savunmacıdır, tanınmayan öğe sessizce atlanır.
        """
        words: list[OcrWord] = []
        word_results = getattr(output, "word_results", None)
        if word_results:
            for line in word_results:
                if not isinstance(line, (list, tuple)):
                    continue
                for item in line:
                    if isinstance(item, str) or not isinstance(item, (list, tuple)) or len(item) != 3:
                        continue
                    text, score, box = item
                    cleaned = (text or "").strip()
                    if not cleaned:
                        continue
                    words.append(OcrWord(text=cleaned, score=float(score or 0.0), box=_bbox(box)))
            if words:
                return words
        texts = getattr(output, "txts", None) or ()
        scores = getattr(output, "scores", None) or ()
        boxes = getattr(output, "boxes", None) or ()
        for text, score, box in zip(texts, scores, boxes):
            cleaned = (text or "").strip()
            if not cleaned:
                continue
            words.append(OcrWord(text=cleaned, score=float(score or 0.0), box=_bbox(box)))
        return words


def _bbox(box: Any) -> tuple[int, int, int, int]:
    """4 noktalı poligonu hizalanmış (x0, y0, x1, y1) kutuya indirger."""
    points = [(float(point[0]), float(point[1])) for point in list(box)]
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return (int(round(min(xs))), int(round(min(ys))), int(round(max(xs))), int(round(max(ys))))


_ENGINE: LocalOcrEngine | None = None
_ENGINE_PROBED = False


def get_local_ocr_engine() -> LocalOcrEngine | None:
    """Tembel singleton: ilk çağrıda kurar, hatayı ezberler (tekrar deneme yok)."""
    global _ENGINE, _ENGINE_PROBED
    if not _ENGINE_PROBED:
        _ENGINE_PROBED = True
        _ENGINE = LocalOcrEngine()
    return _ENGINE if (_ENGINE is not None and _ENGINE.available) else None


def engine_available() -> bool:
    """Import + kurulum probu — capabilities'teki ``local_engine`` bunu döner."""
    return get_local_ocr_engine() is not None


def reset_local_ocr_engine_for_tests() -> None:
    """Test yardımcısı: singleton/probe ezberini sıfırlar (monkeypatch sonrası)."""
    global _ENGINE, _ENGINE_PROBED
    _ENGINE = None
    _ENGINE_PROBED = False


@dataclass(slots=True)
class LocalOcrOutcome:
    """Yerel katmanın uçtan uca sonucu (extract_identity birleşiminde kullanır)."""

    engine_used: bool = False
    engine_name: str = "none"
    latency_ms: float = 0.0
    warped: bool = False
    quad_detected: bool = False
    rois_enabled: bool = False
    roi_fields: list[str] = dc_field(default_factory=list)
    document_type: str | None = None
    ocr_text: str = ""
    parse: LocalParseResult | None = None
    warnings: list[str] = dc_field(default_factory=list)


def run_local_ocr(
    image_bytes: bytes,
    *,
    side: str = "front",
    threshold: float = 0.62,
    rois: dict | None = None,
    long_edge: int = DOWNSCALE_LONG_EDGE,
) -> LocalOcrOutcome:
    """Yerel zincir: bayt → kart bölgesi → OCR → ROI parse → uyarı token'ları.

    ASLA exception fırlatmaz: her hatada boş ``LocalOcrOutcome`` döner, üst
    katman barkod/VLM sonuçlarını aynen sunmaya devam eder (zarif düşüş).
    Görüntü bellek içi işlenir, diske YAZILMAZ.
    """
    outcome = LocalOcrOutcome()
    started = time.perf_counter()

    engine = get_local_ocr_engine()
    if engine is None:
        if _ENGINE is not None and _ENGINE.error:
            logger.info("Yerel OCR atlandı (motor yok): %s", _ENGINE.error)
        return outcome

    frame = decode_to_bgr(image_bytes)
    if frame is None:
        return outcome
    scaled = downscale_long_edge(frame, long_edge)

    region: CardRegion = isolate_card(scaled)
    outcome.quad_detected = region.quad_detected
    outcome.warped = region.warped
    outcome.rois_enabled = region.rois_enabled
    outcome.warnings.extend(region.warnings)

    # Parlama tespiti kart bölgesinde yapılır: warp sonrası yüzey düz olduğu
    # için blob oranı gerçek yansımayı sayar (köşe dışı arka plan saymaz).
    if detect_glare(region.image):
        outcome.warnings.append("glare_detected")

    try:
        words = engine.recognize(region.image)
    except Exception as exc:  # noqa: BLE001 — sarmalayıcı zaten yakalar; yine de zincir düşmesin
        logger.warning("Yerel kimlik OCR çıkarsama hatası: %s", type(exc).__name__)
        words = []
    document_type_key = guess_document_type(words)
    if document_type_key is None and region.rois_enabled:
        # Tip tanınamadıysa ROI eşleme yapılamaz; tam-kart metni kalır (D5).
        outcome.warnings.append("roi_low_confidence")
        document_type_key = None

    parse_result = parse_local_fields(
        words,
        document_type_key=document_type_key,
        rois_enabled=region.rois_enabled and document_type_key is not None,
        threshold=threshold,
        rois=rois,
        # Normalize ROI pencereleri kelimelerin GELDİĞİ kareye eşlenir: warp
        # tuvalinde sabit (1280x808), flatbed karesinde gerçek boyut.
        canvas=(int(region.image.shape[1]), int(region.image.shape[0])),
    )
    outcome.parse = parse_result
    outcome.document_type = parse_result.document_type
    outcome.ocr_text = parse_result.ocr_text
    outcome.roi_fields = list(parse_result.roi_fields)
    if parse_result.low_confidence and "roi_low_confidence" not in outcome.warnings:
        outcome.warnings.append("roi_low_confidence")
    if parse_result.mod11_failed_soft:
        outcome.warnings.append("cpr_mod11_failed_soft")

    outcome.engine_used = True
    outcome.engine_name = ENGINE_NAME
    outcome.latency_ms = (time.perf_counter() - started) * 1000.0
    if side != "front":
        logger.debug("Yerel OCR arka yüz taraması (side=%s) — ROI tablosu ön yüz varsayımlıdır.", side)
    return outcome
