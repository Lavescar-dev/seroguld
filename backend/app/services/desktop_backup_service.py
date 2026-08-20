from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
import uuid
import zipfile
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

from app.config import ROOT_ENV_FILE, get_settings


BACKUP_FORMAT_VERSION = 1
SNAPSHOT_PREFIX = "seroguld-snapshot-"
ENCRYPTED_SUFFIX = ".sgbackup"

# Yedeğe yalnız felaket kurtarma için ZORUNLU config anahtarları girer.
# FIELD_ENCRYPTION_KEY olmadan geri yüklenen DB'deki şifreli CPR/adres
# alanları çözülemez; JWT sırları ve üçüncü parti kimlik bilgileri
# (Uniconta/Woo/OpenAI parolaları) yeniden girilebilir olduğundan düz
# metin staging ZIP'ine asla yazılmaz.
BACKUP_ENV_ALLOWLIST = ("FIELD_ENCRYPTION_KEY",)


def _redacted_runtime_env(config_file: Path, target: Path) -> Path | None:
    try:
        raw_lines = config_file.read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return None
    kept: list[str] = [
        "# Sero Guld yedek kopyası — yalnız geri yükleme için zorunlu anahtarlar.",
        "# Uniconta/Woo/OpenAI kimlik bilgileri ve JWT sırları bilinçli olarak dışarıda.",
    ]
    for raw_line in raw_lines:
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key = line.split("=", 1)[0].strip()
        if key in BACKUP_ENV_ALLOWLIST:
            kept.append(line)
    if len(kept) == 2:
        return None
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(kept) + "\n", encoding="utf-8")
    return target


class BackupError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class SnapshotResult:
    snapshot_path: Path
    created_at: datetime
    file_count: int
    total_bytes: int
    sha256: str


def _sqlite_path() -> Path:
    raw = get_settings().database_url.strip()
    normalized = raw.replace("sqlite+aiosqlite://", "sqlite://", 1)
    parsed = urlsplit(normalized)
    if parsed.scheme != "sqlite":
        raise BackupError("Windows masaüstü yedeği yalnız yerel SQLite veritabanını destekler.")
    path_text = unquote(parsed.path)
    if os.name == "nt" and path_text.startswith("/") and len(path_text) > 2 and path_text[2] == ":":
        path_text = path_text[1:]
    path = Path(path_text).expanduser().resolve()
    if not path.is_file():
        raise BackupError("Yedeklenecek SQLite veritabanı bulunamadı.")
    return path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _safe_members(root: Path, *, skip_working: bool = False):
    if not root.exists():
        return
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(root)
        if skip_working and relative.parts and relative.parts[0].lower() == "working":
            continue
        if path.name.endswith((".tmp", ".partial", ".lock")):
            continue
        yield path, relative


def _copy_sqlite_online(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True, timeout=15.0)) as source_db:
        with closing(sqlite3.connect(destination, timeout=15.0)) as backup_db:
            source_db.backup(backup_db, pages=256, sleep=0.01)
            result = backup_db.execute("PRAGMA integrity_check").fetchone()
            if not result or str(result[0]).lower() != "ok":
                raise BackupError("SQLite yedek bütünlük kontrolü başarısız oldu.")


def _migration_head(database: Path) -> str | None:
    with closing(sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)) as connection:
        row = connection.execute(
            "SELECT version_num FROM alembic_version ORDER BY version_num DESC LIMIT 1"
        ).fetchone()
    return str(row[0]) if row else None


def create_snapshot(*, reason: str, actor: str) -> SnapshotResult:
    settings = get_settings()
    backup_root = settings.backup_root_path().resolve()
    staging_root = backup_root / "staging"
    staging_root.mkdir(parents=True, exist_ok=True)
    created_at = datetime.now(timezone.utc)
    snapshot_id = uuid.uuid4().hex
    final_path = staging_root / f"{SNAPSHOT_PREFIX}{created_at:%Y%m%d-%H%M%S}-{snapshot_id}.zip"
    partial_path = final_path.with_suffix(".zip.partial")

    # Build everything outside the published staging name. A crash can leave
    # only a disposable .partial file, never a plausible-looking backup.
    with tempfile.TemporaryDirectory(prefix="seroguld-backup-") as temp_dir:
        temp_root = Path(temp_dir)
        database_copy = temp_root / "database" / "seroguld.db"
        _copy_sqlite_online(_sqlite_path(), database_copy)

        source_entries: list[tuple[Path, str]] = [(database_copy, "database/seroguld.db")]
        documents = settings.document_root_path().resolve()
        for source, relative in _safe_members(documents, skip_working=True) or []:
            source_entries.append((source, (Path("documents") / relative).as_posix()))
        uploads = settings.media_root_path().resolve()
        for source, relative in _safe_members(uploads) or []:
            source_entries.append((source, (Path("uploads") / relative).as_posix()))
        config_file = Path(ROOT_ENV_FILE).expanduser().resolve()
        if config_file.is_file():
            redacted = _redacted_runtime_env(config_file, temp_root / "config" / "runtime.env")
            if redacted is not None:
                source_entries.append((redacted, "config/runtime.env"))

        files: list[dict[str, object]] = []
        total_bytes = 0
        for source, archive_name in source_entries:
            size = source.stat().st_size
            total_bytes += size
            files.append({"path": archive_name, "size": size, "sha256": _sha256(source)})

        manifest = {
            "format": "seroguld-desktop-backup",
            "format_version": BACKUP_FORMAT_VERSION,
            "created_at": created_at.isoformat(),
            "reason": reason[:80],
            "actor": actor[:200],
            "migration_head": _migration_head(database_copy),
            "database": "database/seroguld.db",
            "files": files,
            "file_count": len(files),
            "total_bytes": total_bytes,
        }
        try:
            with zipfile.ZipFile(partial_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for source, archive_name in source_entries:
                    archive.write(source, archive_name)
                archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            verify_snapshot(partial_path, require_staging=False)
            os.replace(partial_path, final_path)
        finally:
            partial_path.unlink(missing_ok=True)

    return SnapshotResult(
        snapshot_path=final_path,
        created_at=created_at,
        file_count=len(files),
        total_bytes=total_bytes,
        sha256=_sha256(final_path),
    )


def _validated_staging_path(path: Path) -> Path:
    backup_root = get_settings().backup_root_path().resolve()
    staging_root = (backup_root / "staging").resolve()
    candidate = path.expanduser().resolve()
    if candidate.parent != staging_root or not candidate.name.startswith(SNAPSHOT_PREFIX):
        raise BackupError("Snapshot yolu yedek staging alanının dışında.")
    if candidate.suffix not in {".zip", ".partial"} or not candidate.is_file():
        raise BackupError("Snapshot dosyası bulunamadı.")
    return candidate


def verify_snapshot(path: Path, *, require_staging: bool = True) -> dict[str, object]:
    candidate = _validated_staging_path(path) if require_staging else path.resolve()
    try:
        with zipfile.ZipFile(candidate, "r") as archive:
            if archive.testzip() is not None:
                raise BackupError("Snapshot ZIP bütünlüğü bozuk.")
            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
            if manifest.get("format") != "seroguld-desktop-backup" or manifest.get("format_version") != 1:
                raise BackupError("Snapshot formatı desteklenmiyor.")
            members = set(archive.namelist())
            for record in manifest.get("files") or []:
                name = str(record.get("path") or "")
                if not name or name not in members or name.startswith(("/", "\\")) or ".." in Path(name).parts:
                    raise BackupError("Snapshot manifestinde geçersiz dosya yolu var.")
                payload = archive.read(name)
                if len(payload) != int(record.get("size") or -1):
                    raise BackupError("Snapshot dosya boyutu manifest ile eşleşmiyor.")
                if hashlib.sha256(payload).hexdigest() != record.get("sha256"):
                    raise BackupError("Snapshot dosya özeti manifest ile eşleşmiyor.")

            database_bytes = archive.read(str(manifest.get("database")))
            with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as handle:
                handle.write(database_bytes)
                database_temp = Path(handle.name)
            try:
                with closing(sqlite3.connect(f"file:{database_temp.as_posix()}?mode=ro", uri=True)) as connection:
                    result = connection.execute("PRAGMA integrity_check").fetchone()
                    if not result or str(result[0]).lower() != "ok":
                        raise BackupError("Snapshot SQLite bütünlük kontrolü başarısız.")
            finally:
                database_temp.unlink(missing_ok=True)
    except (OSError, KeyError, ValueError, zipfile.BadZipFile, json.JSONDecodeError) as exc:
        raise BackupError("Snapshot doğrulanamadı.") from exc
    return manifest


def cleanup_staging(*, max_age_hours: int = 24) -> None:
    staging = get_settings().backup_root_path().resolve() / "staging"
    if not staging.exists():
        return
    cutoff = datetime.now(timezone.utc).timestamp() - max_age_hours * 3600
    for candidate in staging.iterdir():
        try:
            if candidate.is_file() and candidate.stat().st_mtime < cutoff:
                candidate.unlink(missing_ok=True)
        except OSError:
            continue


def backup_status() -> dict[str, object]:
    root = get_settings().backup_root_path().resolve()
    daily = root / "daily"
    encrypted = sorted(daily.glob(f"*{ENCRYPTED_SUFFIX}"), key=lambda path: path.stat().st_mtime, reverse=True) if daily.exists() else []
    latest = encrypted[0] if encrypted else None
    restore_root = get_settings().backup_restore_drill_path().resolve()
    restore_drills = sorted(
        (path for path in restore_root.glob("restore-*") if path.is_dir()),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    ) if restore_root.exists() else []
    latest_restore = restore_drills[0] if restore_drills else None
    restore_age = (
        datetime.now(timezone.utc).timestamp() - latest_restore.stat().st_mtime
        if latest_restore
        else None
    )
    return {
        "local_backup_count": len(encrypted),
        "latest_local_backup_at": datetime.fromtimestamp(latest.stat().st_mtime, tz=timezone.utc).isoformat() if latest else None,
        "latest_local_backup_name": latest.name if latest else None,
        "latest_local_backup_size": latest.stat().st_size if latest else None,
        "backup_due": latest is None or (datetime.now(timezone.utc).timestamp() - latest.stat().st_mtime) >= 24 * 3600,
        "latest_restore_drill_at": datetime.fromtimestamp(latest_restore.stat().st_mtime, tz=timezone.utc).isoformat() if latest_restore else None,
        "restore_drill_due": restore_age is None or restore_age >= 7 * 24 * 3600,
    }


def delete_snapshot(path: Path) -> None:
    _validated_staging_path(path).unlink(missing_ok=True)


def inspect_snapshot(path: Path) -> tuple[dict[str, object], dict[str, bytes]]:
    candidate = _validated_staging_path(path)
    manifest = verify_snapshot(candidate)
    with zipfile.ZipFile(candidate, "r") as archive:
        files = {
            str(record["path"]): archive.read(str(record["path"]))
            for record in manifest.get("files") or []
        }
    return manifest, files


def stage_restore(path: Path) -> dict[str, object]:
    """Verify an encrypted/decrypted snapshot and stage a reversible restore.

    Publishing the live database requires restarting the owned runtime, so the
    HTTP layer deliberately stops at a fully verified staged restore. The UI
    labels this as verification/preparation instead of claiming live recovery.
    """

    candidate = _validated_staging_path(path)
    manifest, files = inspect_snapshot(candidate)
    restore_root = get_settings().backup_restore_drill_path().resolve()
    target = restore_root / f"restore-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:8]}"
    target.mkdir(parents=True, exist_ok=False)
    try:
        for name, payload in files.items():
            destination = (target / name).resolve()
            if target not in destination.parents:
                raise BackupError("Restore manifestinde geçersiz yol var.")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(payload)
        (target / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception:
        shutil.rmtree(target, ignore_errors=True)
        raise
    database = target / str(manifest["database"])
    with closing(sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)) as connection:
        result = connection.execute("PRAGMA integrity_check").fetchone()
        if not result or str(result[0]).lower() != "ok":
            shutil.rmtree(target, ignore_errors=True)
            raise BackupError("Restore staging SQLite bütünlük kontrolü başarısız.")
    completed = sorted(
        (path for path in restore_root.glob("restore-*") if path.is_dir()),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for expired in completed[4:]:
        shutil.rmtree(expired, ignore_errors=True)
    return {"status": "staged", "restore_path": str(target), "manifest": manifest}
