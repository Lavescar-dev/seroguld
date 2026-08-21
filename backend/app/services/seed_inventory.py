"""Depolama (inventory) seed loader.

On a genuinely fresh install the app ships Recai Bey's current depolama
catalogue so the operator opens the exe with the shop's inventory already
present. The seed artefact under ``backend/seed_data/depolama/`` is produced by
``scripts/seed/extract_inventory.py`` from the two real workbooks (products are
PII-free — no customer data — so unlike AFG/Log they may be bundled).

Products are inserted directly (preserving the file's exact fine-gold / total
weight / status), classified into ProductStatusEnum (in_inventory / sold /
melted / undecided). The 266 jewelry photos ship as an AVIF *pool* copied under
``{media_root}/seed-library/depolama/`` with a manifest — they are NOT linked to
products here; the operator attaches the right photo per product in the UI.

The loader is strictly one-time and idempotent: it runs only when the products
table is empty AND a ``depolama_seed`` marker row is absent, and records the
marker after seeding so a later manual wipe never silently re-seeds.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.config import get_settings

settings = get_settings()
from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum
from app.models.product import Product
from app.models.reference_sequence import ReferenceSequence
from app.services.product_service import (
    SOURCE_TYPE_TAG,
    calculate_pure_gold_grams,
    infer_inventory_categories,
)
from app.services.sequence_service import (
    PRODUCT_NUMBER_SEQUENCE_KEY,
    infer_product_number_seed,
)
from app.utils.helpers import quantize_2, utc_now

logger = logging.getLogger(__name__)

SEED_MARKER_KEY = "depolama_seed"
_STATUS_MAP = {
    "in_inventory": ProductStatusEnum.IN_INVENTORY,
    "sold": ProductStatusEnum.SOLD,
    "melted": ProductStatusEnum.MELTED,
    "undecided": ProductStatusEnum.UNDECIDED,
}


def seed_data_dir() -> Path:
    """Resolve the bundled seed directory across dev and frozen (PyInstaller)."""
    override = os.environ.get("SEED_DATA_DIR", "").strip()
    if override:
        return Path(override).expanduser()
    meipass = getattr(sys, "_MEIPASS", None)
    if getattr(sys, "frozen", False) and meipass:
        return Path(meipass) / "backend" / "seed_data"
    # backend/app/services/seed_inventory.py -> backend/seed_data
    return Path(__file__).resolve().parents[2] / "seed_data"


def _seed_enabled() -> bool:
    return os.environ.get("SEED_INVENTORY_ENABLED", "true").strip().lower() not in ("0", "false", "no")


def _dec(value) -> Decimal | None:
    if value is None:
        return None
    return quantize_2(Decimal(str(value)))


def _parse_date(value: str | None) -> datetime:
    if not value:
        return utc_now()
    try:
        return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)
    except ValueError:
        return utc_now()


def _notes_marker(row: dict) -> str:
    """Provenance marker so ProductOut.import_source_type surfaces 'depolama_seed'
    and the operator can trace a seeded product back to its source row."""
    bits = [f"{SOURCE_TYPE_TAG}depolama_seed]"]
    if row.get("status_note"):
        bits.append(str(row["status_note"]))
    detail = {
        "source_file": row.get("source_file"),
        "source_row": row.get("source_row"),
        "legacy_code": row.get("legacy_code"),
        "afg_number": row.get("afg_number"),
        "source_category": row.get("category"),
    }
    detail = {k: v for k, v in detail.items() if v not in (None, "")}
    if detail:
        bits.append("[depolama_seed] " + json.dumps(detail, ensure_ascii=False))
    return " ".join(bits)


def _build_product(row: dict, product_number: str) -> Product:
    metal = MetalTypeEnum(row["metal_type"])
    ptype = ProductTypeEnum(row["product_type"])
    weight = _dec(row["weight_grams"]) or Decimal("0.01")
    purity_pct = _dec(row.get("purity_percentage"))
    # Preserve the file's fine-gold figure; only compute if the file lacked one.
    pure_gold = _dec(row.get("pure_gold_grams"))
    if pure_gold is None and purity_pct is not None:
        pure_gold = calculate_pure_gold_grams(weight, purity_pct)
    total_weight = _dec(row.get("total_weight_grams")) or quantize_2(weight * Decimal(int(row.get("unit_count") or 1)))
    purchase_date = _parse_date(row.get("purchase_date"))
    category, subcategory = infer_inventory_categories(metal, ptype)
    status = _STATUS_MAP.get(row.get("status", ""), ProductStatusEnum.IN_INVENTORY)

    product = Product(
        product_number=product_number,
        display_name=(row.get("display_name") or None),
        product_type=ptype,
        metal_type=metal,
        weight_grams=weight,
        purity_karat=row.get("purity_karat"),
        purity_percentage=purity_pct,
        pure_gold_grams=pure_gold,
        unit_count=int(row.get("unit_count") or 1),
        total_weight_grams=total_weight,
        purchase_date=purchase_date,
        purchase_price_dkk=_dec(row["purchase_price_dkk"]) or Decimal("0.01"),
        commission=Decimal("0"),
        # Seed items are the pre-existing historical catalogue: never GDPR-held.
        gdpr_release_date=purchase_date + timedelta(days=14),
        is_gdpr_locked=False,
        status=status,
        notes=_notes_marker(row),
        length_cm=(str(row["length_cm"])[:30] if row.get("length_cm") else None),
        width_mm=_dec(row.get("width_mm")),
        thickness_mm=_dec(row.get("thickness_mm")),
        producer=(str(row["producer"])[:120] if row.get("producer") else None),
        inventory_category=category,
        inventory_subcategory=subcategory,
        photos=[],
    )
    if status == ProductStatusEnum.MELTED:
        product.melt_reason = (row.get("status_note") or "Smeltet")[:200]
    elif status == ProductStatusEnum.SOLD:
        # actual sale price/date unknown in the source; note kept in ``notes``.
        product.sale_date = None
    return product


def _copy_photo_pool() -> int:
    """Copy the bundled AVIF pool into the served media root. Returns file count."""
    src = seed_data_dir() / "depolama" / "photos"
    if not src.is_dir():
        return 0
    dest = settings.media_root_path() / "seed-library" / "depolama"
    dest.mkdir(parents=True, exist_ok=True)
    copied = 0
    for photo in sorted(src.iterdir()):
        if photo.suffix.lower() in (".avif", ".png", ".webp", ".jpg", ".jpeg", ".json"):
            target = dest / photo.name
            if not target.exists():
                shutil.copy2(photo, target)
                copied += 1
    return copied


async def ensure_seed_inventory(session_factory=AsyncSessionLocal) -> None:
    """Idempotent one-time depolama seed on a fresh install.

    ``session_factory`` is injectable so tests can drive it against a throwaway
    engine; production uses the app's ``AsyncSessionLocal``.
    """
    if not _seed_enabled():
        return
    seed_file = seed_data_dir() / "depolama" / "inventory_seed.json"
    if not seed_file.is_file():
        logger.info("Depolama seed atlandı: artefakt yok (%s)", seed_file)
        return

    async with session_factory() as session:
        # Tek-seferlik kapı YALNIZ marker'a dayanır (products-boş şartı YOK):
        #   marker.next_value > 0  -> gerçekten seed'lendi -> atla
        #   marker yok / next_value == 0 (zehirli: eski "atla+0 yaz" davranışı)
        #                          -> seed'le. Böylece mevcut kuruluma (ör. tek
        #   "test takı" ürünü olan) 625 ürün additive eklenir; daha önce doğru
        #   seed'lenmiş kurulum tekrar etmez.
        marker = await session.get(ReferenceSequence, SEED_MARKER_KEY)
        if marker is not None and int(marker.next_value) > 0:
            await session.rollback()
            return

        try:
            rows = json.loads(seed_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            logger.exception("Depolama seed okunamadı: %s", seed_file)
            return

        # max(product_number)+1 — dolu DB'de mevcut ürünlerin ötesinden başlar,
        # çakışma olmaz (ör. "test takı"=0001 -> seed 0002'den).
        next_number = await infer_product_number_seed(session)
        created = 0
        for row in rows:
            try:
                product = _build_product(row, f"{next_number:04d}")
            except (KeyError, ValueError, TypeError):
                logger.warning("Depolama seed satırı atlandı (row=%s)", row.get("source_row"), exc_info=True)
                continue
            session.add(product)
            next_number += 1
            created += 1

        # Advance the shared product-number sequence past the seeded block so
        # the first operator-created product continues cleanly.
        seq = await session.get(ReferenceSequence, PRODUCT_NUMBER_SEQUENCE_KEY)
        if seq is None:
            session.add(ReferenceSequence(key=PRODUCT_NUMBER_SEQUENCE_KEY, next_value=next_number))
        else:
            seq.next_value = max(int(seq.next_value), next_number)

        photos = _copy_photo_pool()
        # Marker'ı "gerçekten seed'lendi" (>0) olarak yaz. Zehirli/mevcut satır
        # varsa güncelle (PK çakışması olmasın); yoksa ekle.
        done_value = max(created, 1)
        if marker is not None:
            marker.next_value = done_value
        else:
            session.add(ReferenceSequence(key=SEED_MARKER_KEY, next_value=done_value))
        await session.commit()
        logger.info("Depolama seed yüklendi: %s ürün, %s foto (havuz)", created, photos)
