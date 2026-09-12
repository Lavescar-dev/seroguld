"""R1-B kimlik OCR kanal benchmark'i — pytest TOPLAMAZ (test_ oneki yok).

Kanallar:
- barcode: zxing-cpp Code 128 roundtrip (ground-truth CPR'dan sentetik barkod
  uretilir -> decode -> ilk-6 dogrulugu + sure). Gercek sundhedskorttaki
  barkodun kendisi offline, ucretsiz, checksum'li CPR kaynagidir (R1-B Tier 0).
- local: 0.3.39 yerel motor (RapidOCR PP-OCRv6 + on-işleme + ROI parse).
  Fixture expected_fields'a (full_name, cpr_first6, document_number,
  postal_code, city) alan-bazli skor + gecikme p50/p95 + barkod isabeti +
  warp basari orani basar. CI'da da kosar (ag YOK); gercek model
  site-packages'tan gelir. identity_local_ocr_enabled bayragi burada
  GEREKMEZ — benchmark motoru dogrudan cagirir (kapiyi olcmek icin).
- vlm: GERCEK cagri — SERO_OCR_BENCH_LIVE=1 VE anahtar tanimliysa calisir;
  aksi halde talimat basilir ve cikilir (CI asla aga cikmaz). Motor secimi
  (gpt-5-mini mi baska ucuz model mi) bu olcumle kesinlesir.

Kullanim (backend klasorunden):
    .venv/bin/python tests/ocr_benchmark.py --engine barcode
    .venv/bin/python tests/ocr_benchmark.py --engine local
    SERO_OCR_BENCH_LIVE=1 .venv/bin/python tests/ocr_benchmark.py --engine vlm
    .venv/bin/python tests/ocr_benchmark.py --engine barcode --images ~/scans
    .venv/bin/python tests/ocr_benchmark.py --engine local --images ~/card-photos --roi-dump ~/roi-tune

ROI ayar dongusu (WP9 runbook):
    1) gercek kart foto + <ad>.truth.json yanyana koy (repo DISINDA, or. ~/card-photos)
    2) --engine local --images ~/card-photos --roi-dump ~/roi-tune
    3) ~/roi-tune/<ad>__<roi>.png kirpimlarina bak, koordinatlari duzelt
    4) duzeltilmis dikdortgenleri IDENTITY_OCR_ROI_OVERRIDES_JSON olarak .env'e yaz
    5) yeniden olc; kapı: alan dogrulugu >= Windows tabani, barkodlu her
       fotoda tam-10 CPR, p95 < 2s

Guvenlik: gercek kart goruntusu/ham ciktisi REPOYA GIRMEZ; --images yalniz
lokal kosum icindir ve ciktidaki CPR asla tam basilmez (ilk 6 + maskelenmis
kuyruk — form yuzeyi kuraliyle ayni). ``--roi-dump`` kirpim PNG'lerini YALNIZ
repo disina yazar (repo icindeki yol verilirse reddeder) — dump klasorunu
gitignore'a almak yeterli degildir, klasoru repoda ACMA. Regex kanalinin
regresyon kapisi frontend'dedir: npx vitest run src-v2/make/alis/__tests__/identityScanOcrContract.test.ts
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import os
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "ocr"
FIXTURES_JSON = FIXTURE_DIR / "fixtures.json"

# Kart gorselleri/bench ciktilari icin yasak bolge: repo kokunun alti.
REPO_ROOT = Path(__file__).resolve().parents[2]

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}

# Kartta CPR BASILI tek fixture tipi sundhedskorttur (koerekort SPECIMEN'lerinde
# 4d yok — "eski kartlar" notu; pas/idkort hiç basmaz). fixtures.json'daki
# cpr_first6 doğum tarihinden TÜRETİLMİŞTİR, kartta yazılı DEĞİLDİR — basılı
# olmayan alan X sayılmaz (motorun okumadığı alan, güç kaybı değildir).
# Gerçek fotoğraflarda (--images) kural sidecar'dır: truth'a yalnız kartta
# BASILI alanlar yazılır (docs/.../OKU.md kuralı).
CPR_PRINTED_DOC_TYPES = {"sundhedskort", "health_card"}


def _load_ground_truth() -> list[dict]:
    manifest = json.loads(FIXTURES_JSON.read_text(encoding="utf-8"))
    return manifest["fixtures"]


def _mask_cpr(cpr: str) -> str:
    """Cikti yuzeyi: ilk 6 hane + maskelenmis kuyruk (tam CPR ASLA basilmez)."""
    digits = "".join(ch for ch in cpr if ch.isdigit())
    return f"{digits[:6]:<6}------"


def _score_field(expected: str, actual: str | None) -> bool:
    if not expected:
        return True  # ground truth boşsa ölçülmez
    # ÜRÜN SEMANTİĞİ: frontend eşleştirme anahtarı TRANSLİTERE edilerek
    # karşılaştırılır (Æ→AE, Ø→OE...). OCR 'ÆGIDIUS' yerine 'AEGIDIUS'
    # okuyabilir; ürün bunu doğru eşleştirir — benchmark da aynı ölçütle
    # skorlar, ham casefold'tan daha sıkı olmaz.
    from app.utils.identity_validate import transliterate_name

    exp = transliterate_name(expected).strip().casefold()
    act = transliterate_name(actual or "").strip().casefold()
    return bool(act) and act == exp


def _truth_for(directory: Path, stem: str) -> dict:
    """``<ad>.truth.json`` yan dosyasini okur (gercek foto ground truth'u).

    Biçim: fixture expected_fields ile aynı anahtarlar
    (full_name, cpr_first6, document_number, postal_code, city).
    """
    sidecar = directory / f"{stem}.truth.json"
    if not sidecar.exists():
        return {}
    try:
        payload = json.loads(sidecar.read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        print(f"  !! {sidecar.name} okunamadi ({exc}) — ground truth yok sayildi")
        return {}
    return payload.get("expected_fields", payload) if isinstance(payload, dict) else {}


# --- barcode kanalı -----------------------------------------------------------


def run_barcode(images_dir: Path | None) -> int:
    from PIL import Image
    import zxingcpp

    from app.services.identity_barcode_service import decode_identity_barcode

    rows: list[tuple[str, str, bool, bool, float]] = []
    for fixture in _load_ground_truth():
        cpr6 = fixture["expected_fields"].get("cpr_first6", "")
        if not cpr6:
            continue
        # Sentetik barkod: ground-truth dogum bolumu + '0000' kuyrugu (yalniz
        # roundtrip olcumu — sentetik veri, gercek degil).
        barcode = zxingcpp.create_barcode(cpr6 + "0000", zxingcpp.BarcodeFormat.Code128)
        zx_img = zxingcpp.write_barcode_to_image(barcode)
        pil = Image.frombuffer("L", (zx_img.shape[1], zx_img.shape[0]), memoryview(zx_img), "raw", "L", 0, 1)
        buf = io.BytesIO()
        pil.save(buf, "PNG")
        started = time.perf_counter()
        hit = decode_identity_barcode(buf.getvalue())
        elapsed_ms = (time.perf_counter() - started) * 1000
        name = Path(fixture["file"]).stem
        if hit is None:
            rows.append((name, cpr6, False, False, elapsed_ms))
            continue
        ok = hit.cpr[:6] == cpr6
        rows.append((name, hit.cpr, ok, hit.verified, elapsed_ms))

    print("== barcode kanalı (zxing-cpp, sentetik Code 128 roundtrip) ==")
    print(f"{'fixture':<28} {'cpr (maske)':<14} {'ilk6':<6} {'verified':<9} ms")
    ok_count = 0
    for name, cpr, ok, verified, ms in rows:
        ok_count += ok
        print(f"{name:<28} {_mask_cpr(cpr):<14} {'OK' if ok else 'X':<6} {str(verified):<9} {ms:.1f}")
    total = len(rows)
    print(f"\ndecode+ilk6 doğruluk: {ok_count}/{total}" if total else "ölçülebilir fixture yok")
    if rows:
        avg = sum(r[4] for r in rows) / len(rows)
        print(f"ortalama süresi: {avg:.1f} ms/görüntü (offline, maliyet 0)")

    # Kart görsellerinde barkod YOKTUR -> None düşüşü zarafetle ölçülür.
    card_fallthrough = 0
    card_total = 0
    for fixture in _load_ground_truth():
        path = FIXTURE_DIR / fixture["file"]
        if not path.exists():
            continue
        card_total += 1
        if decode_identity_barcode(path.read_bytes()) is None:
            card_fallthrough += 1
    if card_total:
        print(f"barkotsuz kart görsellerinde zarif düşüş (None): {card_fallthrough}/{card_total}")

    if images_dir is not None:
        print(f"\n-- gerçek taramalar: {images_dir}")
        decoded = 0
        verified = 0
        total_files = 0
        for path in sorted(images_dir.iterdir()):
            if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}:
                continue
            total_files += 1
            hit = decode_identity_barcode(path.read_bytes())
            if hit is None:
                print(f"  {path.name}: barkod yok")
                continue
            decoded += 1
            verified += hit.verified
            print(f"  {path.name}: CPR {_mask_cpr(hit.cpr)} verified={hit.verified}")
        print(f"  özet: {decoded}/{total_files} decode, {verified}/{decoded} checksum'lı")
        print("  NOT: bu dosyalar REPOYA GİRMEZ (lokal ölçüm).")
    return 0


# --- local kanalı (0.3.39 yerel motor) ----------------------------------------


def _refuse_repo_path(directory: Path) -> Path:
    """``--roi-dump`` hedefini repo DIŞINA zorlar (görüntü repo kuralı)."""
    resolved = directory.expanduser().resolve()
    repo_resolved = REPO_ROOT.resolve()
    if resolved == repo_resolved or repo_resolved in resolved.parents:
        raise SystemExit(
            f"REDDEDILDI: --roi-dump hedefi repo agacinda olamaz ({resolved}).\n"
            "Kart kirpimlari/ham OCR metni repoya GIRMEZ — repo disinda bir yol verin: "
            "--roi-dump ~/roi-tune"
        )
    return resolved


def _refuse_repo_images(directory: Path) -> Path:
    """``--images`` klasörünü de repo DIŞINA zorlar (aynı altın kural)."""
    resolved = directory.expanduser().resolve()
    repo_resolved = REPO_ROOT.resolve()
    if resolved == repo_resolved or repo_resolved in resolved.parents:
        raise SystemExit(
            f"REDDEDILDI: --images klasoru repo agacinda olamaz ({resolved}).\n"
            "Gercek kart fotograf/taramalari repoda YASAMAZ — repo disinda bir yol verin: "
            "--images ~/card-photos"
        )
    return resolved


def _dump_roi_crops(dump_dir: Path, name: str, image_bytes: bytes, outcome) -> None:
    """ROI kirpimlari + ham metinler + dörtgen katmanini diske yazar.

    YALNIZ benchmark'ta, acikca cagrilir: servis yolu hicbir kosulda diske
    yazmaz (GDPR kurali). Kirpimlar normalize_polarity(binarize=True) ile
    verilir ki ROI penceresi gozle ayarlanabilsin.
    """
    import cv2

    from app.services.identity_ocr_preprocess import (
        crop_roi,
        debug_card_region,
        normalize_polarity,
        quad_overlay,
    )
    from app.services.identity_ocr_rois import load_rois, rois_for

    dump_dir.mkdir(parents=True, exist_ok=True)
    card, quad = debug_card_region(image_bytes)
    if card is None:
        return
    cv2.imwrite(str(dump_dir / f"{name}__card.png"), quad_overlay(card, quad))
    texts = {
        "ocr_text": outcome.ocr_text,
        "document_type": outcome.document_type,
        "roi_fields": outcome.roi_fields,
        "warnings": outcome.warnings,
    }
    (dump_dir / f"{name}__texts.json").write_text(
        json.dumps(texts, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    parse = outcome.parse
    if parse is None or parse.document_type_key is None:
        return
    for row in rois_for(load_rois(), parse.document_type_key):
        crop = crop_roi(card, row)
        if crop.size:
            cv2.imwrite(
                str(dump_dir / f"{name}__{row.key}_{row.field}.png"),
                normalize_polarity(crop, binarize=True),
            )


def _simulate_capture(image_bytes: bytes, mode: str, tilt: float) -> bytes:
    """Bench kartını dükkân taraması koşullarına çevirir (bellek içi, 0.3.40).

    flatbed: A4 300 DPI koyu kapak sayfası, kart GERÇEK boyutunda (genişlik
    86mm = 1016px, en-boy KORUNUR — pasaport ID-3 125x88mm'dir, ID-1'e
    zorlamak simülasyon yapaylığıdır) ortada — WIA flatbed taramasının
    taklidi (saha 10 Eyl 2026: bu koşulda kart karenin %7.45'idir, asis
    bench kartıysa çerçeveyi doldurur; iki dağılım AYNI değildir, ayrı
    ölçülmelidir).
    autocrop: kart + ~%8 marj, koyu kenar (tarayıcı/uygulama auto-crop'u).
    portrait: autocrop ama kart 90° döndürülmüş (camın dikey konumu).
    tilt: kartı yapıştırmadan önce verilen dereceyle eğer (tüm modlar).
    """
    import cv2
    import numpy as np

    data = np.frombuffer(image_bytes, dtype=np.uint8)
    card = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if card is None:
        return image_bytes
    height, width = card.shape[:2]
    card = cv2.resize(card, (1016, max(1, int(round(height * 1016 / width)))), interpolation=cv2.INTER_AREA)
    if mode == "portrait":
        card = cv2.rotate(card, cv2.ROTATE_90_CLOCKWISE)
    if tilt:
        height, width = card.shape[:2]
        matrix = cv2.getRotationMatrix2D((width / 2, height / 2), tilt, 1.0)
        card = cv2.warpAffine(card, matrix, (width, height))
    ch, cw = card.shape[:2]
    if mode == "flatbed":
        page = np.full((3508, 2480, 3), 60, dtype=np.uint8)
    else:  # autocrop / portrait — kenarlarda ~%8 marj
        page = np.full((ch + 100, cw + 130, 3), 60, dtype=np.uint8)
    y, x = (page.shape[0] - ch) // 2, (page.shape[1] - cw) // 2
    page[y : y + ch, x : x + cw] = card
    ok, encoded = cv2.imencode(".jpg", page, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return encoded.tobytes() if ok else image_bytes


def run_local(
    images_dir: Path | None,
    roi_dump_dir: Path | None,
    *,
    simulate: str | None = None,
    tilt: float = 0.0,
) -> int:
    """Yerel motor kanalı: fixture + opsiyonel gerçek fotoğraflar üzerinde skor."""
    from app.services.identity_local_ocr_service import engine_available, run_local_ocr
    from app.services.identity_ocr_rois import load_rois

    if not engine_available():
        print("Yerel motor kurulamadi (rapidocr/opencv/onnxruntime) —local_engine=False.")
        print("Kurulumu dogrulayin: .venv/bin/python -c \"from rapidocr import RapidOCR\"")
        return 1

    dump_dir = _refuse_repo_path(roi_dump_dir) if roi_dump_dir else None

    jobs: list[tuple[str, Path, dict]] = []
    for fixture in _load_ground_truth():
        path = FIXTURE_DIR / fixture["file"]
        if path.exists():
            expected = dict(fixture.get("expected_fields", {}))
            if fixture.get("document_type") not in CPR_PRINTED_DOC_TYPES:
                expected.pop("cpr_first6", None)  # kartta basılı değil
            # Koşul (clean/rotate/...) fixture gövdesindedir; skora taşınır.
            expected.setdefault("capture_condition", fixture.get("capture_condition", "gercek"))
            jobs.append((Path(fixture["file"]).stem, path, expected))
    if images_dir is not None:
        for path in sorted(images_dir.iterdir()):
            if path.suffix.lower() not in IMAGE_SUFFIXES:
                continue
            jobs.append((path.stem, path, _truth_for(images_dir, path.stem)))
    if not jobs:
        print("Ölçülebilir görüntü yok.")
        return 1

    sim_label = f"[{simulate}{'%+.0f' % tilt if tilt else ''}]" if simulate else ""
    if simulate:
        print(f"== SİMÜLASYON: {sim_label} (kart gerçek boyutta yeniden kadranlanıyor) ==")
    print("== local kanalı (RapidOCR PP-OCRv6, onnxruntime CPU, tamamen offline) ==")
    field_hits: dict[str, list[bool]] = defaultdict(list)
    per_condition: dict[str, list[bool]] = defaultdict(list)
    latencies: list[float] = []
    barcode_hits = 0
    barcode_verified = 0
    warp_ok = 0
    quad_ok = 0
    errors = 0
    for name, path, expected in jobs:
        image_bytes = path.read_bytes()
        if simulate:
            image_bytes = _simulate_capture(image_bytes, simulate, tilt)
        outcome = run_local_ocr(image_bytes, threshold=0.62, rois=load_rois())
        latencies.append(outcome.latency_ms)
        if outcome.quad_detected:
            quad_ok += 1
        if outcome.warped:
            warp_ok += 1
        from app.services.identity_barcode_service import decode_identity_barcode

        hit = decode_identity_barcode(image_bytes)
        if hit is not None:
            barcode_hits += 1
            barcode_verified += int(hit.verified)
        fields = {key: local.value for key, local in (outcome.parse.fields.items() if outcome.parse else {})}
        if outcome.parse is None:
            errors += 1
            print(f"  {name}{sim_label}: yerel katman koşmadı (motor kurulumu?)")
            continue
        parts = [
            f"{name}{sim_label}: tip={outcome.document_type or '?'}",
            f"roi={'/'.join(outcome.roi_fields) or '-'}",
        ]
        condition = f"sim-{simulate}" if simulate else expected.get("capture_condition", "gercek")
        for key, expected_value in (
            ("full_name", expected.get("full_name", "")),
            ("cpr_number", expected.get("cpr_first6", "")),
            ("doc_number", expected.get("document_number", "")),
            ("postal_code", expected.get("postal_code", expected.get("address_postal", ""))),
            ("city", expected.get("city", "")),
        ):
            if not expected_value:
                continue
            compare_to = expected_value[:6] if key == "cpr_number" else expected_value
            actual = fields.get(key, "")
            ok = _score_field(compare_to, actual[:6] if key == "cpr_number" else actual)
            field_hits[key].append(ok)
            per_condition[condition].append(ok)
            parts.append(f"{key}={'OK' if ok else 'X'}")
        print("  " + ", ".join(parts) + f"  [{outcome.latency_ms:.0f} ms]")
        if dump_dir is not None:
            _dump_roi_crops(dump_dir, name, image_bytes, outcome)

    print("\n-- alan bazlı doğruluk")
    for key, hits in sorted(field_hits.items()):
        print(f"  {key:<14} {sum(hits)}/{len(hits)}")
    for condition, hits in sorted(per_condition.items()):
        print(f"  koşul {condition:<12} {sum(hits)}/{len(hits)}")
    if latencies:
        ordered = sorted(latencies)
        p50 = statistics.median(ordered)
        p95 = ordered[min(len(ordered) - 1, int(round(0.95 * len(ordered))) - 1)] if len(ordered) > 1 else ordered[0]
        print(
            f"\n gecikme: p50 {p50:.0f} ms, p95 {p95:.0f} ms, ort {sum(ordered) / len(ordered):.0f} ms (n={len(ordered)})"
        )
        print(f" kart bulma: dörtgen {quad_ok}/{len(latencies)}, warp {warp_ok}/{len(latencies)}")
        print(f" barkod: {barcode_hits}/{len(latencies)} isabet ({barcode_verified}/{barcode_hits} checksum'lı)")
    if errors:
        print(f" Koşmayan yerel katman: {errors}")
    if dump_dir is not None:
        print(f" ROI kirpimlari: {dump_dir} (repo disi — bu klasoru repoya tasima)")
    else:
        print(" ipucu: ROI ayari icin --roi-dump ~/roi-tune (repo disina yazar)")
    print(" NOT: çıktılardaki CPR yalnız ilk 6 hane ile maskelenir; repoya girmez.")

    # WP9 kapısı — ekranda hatırlatma (karar runbook'tadır, burada zorunlu tutulmaz).
    if field_hits:
        total_hits = sum(sum(hits) for hits in field_hits.values())
        total = sum(len(hits) for hits in field_hits.values())
        print(f"\n KAPI hatırlatması: alan doğruluğu {total_hits}/{total}, p95 "
              f"{(sorted(latencies)[min(len(latencies) - 1, int(round(0.95 * len(latencies))) - 1)] if len(latencies) > 1 else latencies[0]):.0f} ms, "
              "barkodlu her fotoda tam-10 CPR — üçü de geçmeden canlı flag AÇILMAZ.")
    return 0


# --- VLM kanalı ---------------------------------------------------------------


def _data_url(path: Path) -> str:
    mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


async def _vlm_one(path: Path, side: str) -> dict:
    from app.services.identity_extract_service import extract_identity

    started = time.perf_counter()
    try:
        result = await extract_identity(image_data_url=_data_url(path), side=side)
    except Exception as exc:  # hata da bir ölçümdür
        return {"error": str(exc)[:120], "elapsed_ms": (time.perf_counter() - started) * 1000}
    fields = {key: field.value for key, field in (result.fields or {}).items()}
    usage = result.usage
    return {
        "fields": fields,
        "review": {key: field.review for key, field in (result.fields or {}).items()},
        "barcode_cpr6": result.barcode.cpr[:6] if result.barcode else None,
        "source": result.source,
        "model": result.model,
        "tokens": usage.total_tokens if usage else 0,
        "cost_usd": float(usage.total_cost_usd) if usage else 0.0,
        "elapsed_ms": (time.perf_counter() - started) * 1000,
    }


def run_vlm(images_dir: Path | None, side: str, model: str | None) -> int:
    if os.environ.get("SERO_OCR_BENCH_LIVE") != "1":
        print("VLM kanalı GERÇEK çağrı atar. Onay için: SERO_OCR_BENCH_LIVE=1 ile çalıştırın.")
        print("Örnek: SERO_OCR_BENCH_LIVE=1 .venv/bin/python tests/ocr_benchmark.py --engine vlm")
        return 0
    from app.config import get_settings

    if model:
        os.environ["IDENTITY_EXTRACT_MODEL"] = model
    # 0.3.42: resmi bench model kalitesini ölçer — quality kipte VLM yalnız
    # tetikli taramalarda çağrılır ve ölçüm totolojikleşir. Bench her zaman
    # always kipte koşar (merge politikası iki kipte ortaktır). 0.3.43:
    # doğrudan atama — setdefault, kabukta export edilmiş bir TRIGGER_MODE
    # değerini sessizce korur ve bench'i uyarısız quality'de ölçtürürdü.
    os.environ["IDENTITY_VLM_TRIGGER_MODE"] = "always"
    settings = get_settings()
    # 0.3.42: identity anahtarı da kapıyı açar (Azure kimlik ucu global
    # anahtarı kullanmaz — 'anahtar yok' exit-1'i Azure açma günü yanlış
    # çıkarım olmasın).
    has_key = bool(settings.identity_extract_api_key.strip() or settings.openai_api_key.strip())
    if not settings.identity_extract_enabled or not has_key:
        print("identity_extract_enabled=False veya anahtar yok — canlı VLM ölçümü için .env'i ayarlayın.")
        return 1

    jobs: list[tuple[str, Path, dict]] = []
    for fixture in _load_ground_truth():
        path = FIXTURE_DIR / fixture["file"]
        if path.exists():
            expected = dict(fixture["expected_fields"])
            expected.setdefault("capture_condition", fixture.get("capture_condition", "gercek"))
            jobs.append((Path(fixture["file"]).stem, path, expected))
    if images_dir is not None:
        for path in sorted(images_dir.iterdir()):
            if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}:
                jobs.append((path.name, path, {}))  # gerçek tarama: ground truth yok

    print(f"== VLM kanalı (canlı, model={settings.identity_extract_model or settings.openai_model}) ==")
    per_condition: dict[str, list[bool]] = defaultdict(list)
    total_cost = 0.0
    total_tokens = 0
    field_hits: dict[str, list[bool]] = defaultdict(list)
    errors = 0
    for name, path, expected in jobs:
        outcome = asyncio.run(_vlm_one(path, side))
        if "error" in outcome:
            errors += 1
            print(f"  {name}: HATA {outcome['error']}")
            continue
        fields = outcome["fields"]
        total_cost += outcome["cost_usd"]
        total_tokens += outcome["tokens"]
        parts = [f"{name}: kaynak={outcome['source']}"]
        for key, expected_value in (
            ("full_name", expected.get("full_name", "")),
            ("cpr_number", expected.get("cpr_first6", "")),
            ("doc_number", expected.get("document_number", "")),
            ("postal_code", expected.get("postal_code", expected.get("address_postal", ""))),
            ("city", expected.get("city", "")),
        ):
            if not expected_value:
                continue
            actual = fields.get(key, "")
            ok = _score_field(expected_value[:6] if key == "cpr_number" else expected_value, actual)
            field_hits[key].append(ok)
            per_condition[expected.get("capture_condition", "gercek")].append(ok)
            parts.append(f"{key}={'OK' if ok else 'X'}")
        print("  " + ", ".join(parts) + f"  [{outcome['elapsed_ms']:.0f} ms]")

    print("\n-- alan bazlı doğruluk")
    for key, hits in sorted(field_hits.items()):
        print(f"  {key:<14} {sum(hits)}/{len(hits)}")
    for condition, hits in sorted(per_condition.items()):
        print(f"  koşul {condition:<12} {sum(hits)}/{len(hits)}")
    print(f"\n Tokens: {total_tokens}, tahmini maliyet: ${total_cost:.4f} ({len(jobs)} görüntü, ~${(total_cost / max(len(jobs), 1)):.4f}/görüntü)")
    if errors:
        print(f" Hatalı çağrı: {errors}")
    print(" NOT: gerçek kart çıktıları yalnız konsolda maskelenir; repoya girmez.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Kimlik OCR kanal benchmark'i (R1-B). Gercek kart goruntusu/ham ciktisi REPOYA GIRMEZ: --images ve --roi-dump icin repo DISI yol kullanin (or. ~/card-photos, ~/roi-tune); --roi-dump repo agacindaki yolu reddeder."
    )
    parser.add_argument("--engine", choices=["barcode", "vlm", "local"], required=True)
    parser.add_argument(
        "--images",
        type=Path,
        default=None,
        help="Ek/gerçek tarama klasörü (lokal, REPOYA GIRMEZ). <ad>.truth.json yan dosyasi varsa ground truth olarak kullanilir.",
    )
    parser.add_argument("--side", choices=["front", "back"], default="front")
    parser.add_argument("--model", default=None, help="VLM model adı (IDENTITY_EXTRACT_MODEL'e yazılır)")
    parser.add_argument(
        "--roi-dump",
        type=Path,
        default=None,
        metavar="DIR",
        help="Yalnız --engine local: ROI kirpim PNG'leri + ham metin + dörtgen katmanı yazılır. REPO DIŞINA yazın (repo agacındaki yol reddedilir); örnek: --roi-dump ~/roi-tune",
    )
    parser.add_argument(
        "--simulate",
        choices=["flatbed", "autocrop", "portrait"],
        default=None,
        help="Yalnız --engine local: bench kartını dükkân taraması koşuluna çevir (as-is yerine). flatbed=A4@300DPI gerçek boyut kart, autocrop=%8 marj, portrait=90° döndürülmüş.",
    )
    parser.add_argument(
        "--tilt",
        type=float,
        default=0.0,
        help="Simülasyon kartının eğimi derece (ör. 3.0); yalnız --simulate ile anlamlı.",
    )
    args = parser.parse_args()

    sys.path.insert(0, str(Path(__file__).parent.parent))
    # Gercek kart goruntuleri repoda yasamaz: --images klasoru de --roi-dump
    # gibi repo agaci REDDEDEN bir kontrolden gecer.
    images_dir = _refuse_repo_images(args.images) if args.images else None
    if args.engine == "barcode":
        return run_barcode(images_dir)
    if args.engine == "local":
        return run_local(images_dir, args.roi_dump, simulate=args.simulate, tilt=args.tilt)
    return run_vlm(images_dir, args.side, args.model)


if __name__ == "__main__":
    raise SystemExit(main())
