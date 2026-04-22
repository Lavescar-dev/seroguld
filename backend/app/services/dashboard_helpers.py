from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from app.models.enums import ProductStatusEnum
from app.utils.helpers import to_decimal

STATUS_LABELS = {
    ProductStatusEnum.PURCHASED: "Alındı",
    ProductStatusEnum.IN_INVENTORY: "Envanterde",
    ProductStatusEnum.FOR_SALE: "Satışta",
    ProductStatusEnum.SOLD: "Satıldı",
    ProductStatusEnum.MELTED: "Eritildi",
    ProductStatusEnum.UNDECIDED: "Kararsız",
}

METAL_LABELS = {
    "yellow_gold": "Sarı Altın",
    "white_gold": "Beyaz Altın",
    "silver": "Gümüş",
    "platinum": "Platin",
    "palladium": "Palladium",
}


def to_utc(dt):
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def quantize_cost(value: Decimal | str | int | float | None) -> str:
    quantized = to_decimal(value).quantize(Decimal("0.00000001"))
    return format(quantized, "f")


def money(value: Decimal | str | int | float | None) -> str:
    return format(to_decimal(value).quantize(Decimal("0.01")), "f")


def has_any_photo(raw_photos: object) -> bool:
    if not isinstance(raw_photos, list):
        return False
    for item in raw_photos:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if url:
            return True
    return False


def parse_backup_timestamp_from_name(name: str) -> datetime | None:
    # expected: seroguld-backup-YYYYMMDD-HHMMSS.tar.gz
    prefix = "seroguld-backup-"
    suffix = ".tar.gz"
    if not (name.startswith(prefix) and name.endswith(suffix)):
        return None
    raw = name[len(prefix) : -len(suffix)]
    try:
        return datetime.strptime(raw, "%Y%m%d-%H%M%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def find_latest_hourly_backup(backup_root: Path) -> datetime | None:
    hourly_dir = backup_root / "hourly"
    if not hourly_dir.exists() or not hourly_dir.is_dir():
        return None
    latest: datetime | None = None
    for file in hourly_dir.glob("seroguld-backup-*.tar.gz"):
        parsed = parse_backup_timestamp_from_name(file.name)
        if not parsed:
            continue
        if latest is None or parsed > latest:
            latest = parsed
    return latest


def find_latest_restore_drill(restore_drill_root: Path) -> datetime | None:
    if not restore_drill_root.exists() or not restore_drill_root.is_dir():
        return None
    latest: datetime | None = None
    for item in restore_drill_root.glob("restore-*"):
        if not item.is_dir():
            continue
        raw = item.name.replace("restore-", "", 1)
        try:
            parsed = datetime.strptime(raw, "%Y%m%d-%H%M%S").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if latest is None or parsed > latest:
            latest = parsed
    return latest


def find_last_offsite_sync(status_file: Path) -> datetime | None:
    if not status_file.exists() or not status_file.is_file():
        return None
    try:
        payload = json.loads(status_file.read_text(encoding="utf-8"))
    except Exception:
        return None
    value = payload.get("timestamp_utc")
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    return to_utc(parsed)


def age_minutes(now: datetime, past: datetime | None) -> int | None:
    if past is None:
        return None
    delta = now - past
    return max(0, int(delta.total_seconds() // 60))


def age_hours(now: datetime, past: datetime | None) -> int | None:
    if past is None:
        return None
    delta = now - past
    return max(0, int(delta.total_seconds() // 3600))
