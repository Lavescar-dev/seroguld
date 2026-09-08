"""R1-B kimlik OCR kanal benchmark'i — pytest TOPLAMAZ (test_ oneki yok).

Kanallar:
- barcode: zxing-cpp Code 128 roundtrip (ground-truth CPR'dan sentetik barkod
  uretilir -> decode -> ilk-6 dogrulugu + sure). Gercek sundhedskorttaki
  barkodun kendisi offline, ucretsiz, checksum'li CPR kaynagidir (R1-B Tier 0).
- vlm: GERCEK cagri — SERO_OCR_BENCH_LIVE=1 VE anahtar tanimliysa calisir;
  aksi halde talimat basilir ve cikilir (CI asla aga cikmaz). Motor secimi
  (gpt-5-mini mi baska ucuz model mi) bu olcumle kesinlesir.

Kullanim (backend klasorunden):
    .venv/bin/python tests/ocr_benchmark.py --engine barcode
    SERO_OCR_BENCH_LIVE=1 .venv/bin/python tests/ocr_benchmark.py --engine vlm
    .venv/bin/python tests/ocr_benchmark.py --engine barcode --images ~/scans

Guvenlik: gercek kart goruntusu/ham ciktisi REPOYA GIRMEZ; --images yalniz
lokal kosum icindir ve ciktidaki CPR asla tam basilmez (ilk 6 + maskelenmis
kuyruk — form yuzeyi kuraliyle ayni). Regex kanalinin regresyon kapisi
frontend'dedir: npx vitest run src-v2/make/alis/__tests__/identityScanOcrContract.test.ts
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "ocr"
FIXTURES_JSON = FIXTURE_DIR / "fixtures.json"


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
    return bool(actual) and actual.strip().casefold() == expected.strip().casefold()


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
    settings = get_settings()
    if not settings.identity_extract_enabled or not settings.openai_api_key.strip():
        print("identity_extract_enabled=False veya anahtar yok — canlı VLM ölçümü için .env'i ayarlayın.")
        return 1

    jobs: list[tuple[str, Path, dict]] = []
    for fixture in _load_ground_truth():
        path = FIXTURE_DIR / fixture["file"]
        if path.exists():
            jobs.append((Path(fixture["file"]).stem, path, fixture["expected_fields"]))
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
    parser = argparse.ArgumentParser(description="Kimlik OCR kanal benchmark'i (R1-B)")
    parser.add_argument("--engine", choices=["barcode", "vlm"], required=True)
    parser.add_argument("--images", type=Path, default=None, help="Ek/gerçek tarama klasörü (lokal, repoya girmez)")
    parser.add_argument("--side", choices=["front", "back"], default="front")
    parser.add_argument("--model", default=None, help="VLM model adı (IDENTITY_EXTRACT_MODEL'e yazılır)")
    args = parser.parse_args()

    sys.path.insert(0, str(Path(__file__).parent.parent))
    if args.engine == "barcode":
        return run_barcode(args.images)
    return run_vlm(args.images, args.side, args.model)


if __name__ == "__main__":
    raise SystemExit(main())
