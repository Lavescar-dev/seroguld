from __future__ import annotations

import mimetypes
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps
from sqlalchemy.ext.asyncio import AsyncSession

try:
    import pillow_avif  # noqa: F401
except Exception:  # pragma: no cover - plugin may be unavailable in some envs
    pillow_avif = None  # type: ignore[assignment]

try:
    # iPhone HEIC/HEIF fotoğrafları Pillow'un açabilmesi için opener'ı kaydet.
    from pillow_heif import register_heif_opener

    register_heif_opener()
    _HEIF_SUPPORTED = True
except Exception:  # pragma: no cover - plugin may be unavailable in some envs
    _HEIF_SUPPORTED = False

from app.config import get_settings
from app.models.product import Product

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "avif", "heic", "heif"}
ALLOWED_MIME_PREFIX = "image/"


class PhotoService:
    def __init__(self) -> None:
        settings = get_settings()
        self.media_root = settings.media_root_path()
        self.max_size_bytes = max(1, int(settings.photo_max_size_mb)) * 1024 * 1024
        self.media_root.mkdir(parents=True, exist_ok=True)

    def _utc_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _safe_ext(self, filename: str, content_type: str | None, image_format: str | None) -> str:
        ext = Path(filename).suffix.lower().lstrip(".")
        if ext in ALLOWED_EXTENSIONS:
            return ext

        guessed = (mimetypes.guess_extension((content_type or "").split(";")[0].strip()) or "").lstrip(".")
        if guessed in ALLOWED_EXTENSIONS:
            return guessed

        if image_format:
            fmt = image_format.lower()
            if fmt == "jpeg":
                return "jpg"
            if fmt in ALLOWED_EXTENSIONS:
                return fmt

        return "jpg"

    def _product_photo_dir(self, product: Product) -> Path:
        path = self.media_root / "products" / str(product.id)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _public_url_for(self, path: Path) -> str:
        relative = path.resolve().relative_to(self.media_root).as_posix()
        return f"/media/{relative}"

    def _open_image(self, raw_bytes: bytes) -> Image.Image:
        try:
            image = Image.open(BytesIO(raw_bytes))
            image.load()
            return image
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Yüklenen dosya geçerli bir görsel değil.",
            ) from exc

    def _normalize_image(self, image: Image.Image) -> Image.Image:
        normalized = ImageOps.exif_transpose(image)
        if normalized.mode not in {"RGB", "RGBA"}:
            normalized = normalized.convert("RGB")
        return normalized

    def _save_optimized(self, image: Image.Image, product_dir: Path, photo_id: str) -> tuple[Path, str]:
        avif_path = product_dir / f"{photo_id}.avif"
        try:
            image.save(avif_path, format="AVIF", quality=55, speed=6)
            return avif_path, "image/avif"
        except Exception:
            webp_path = product_dir / f"{photo_id}.webp"
            try:
                image.save(webp_path, format="WEBP", quality=82, method=6)
                return webp_path, "image/webp"
            except Exception:
                # Last-resort fallback: keep original visual format.
                fallback_path = product_dir / f"{photo_id}.jpg"
                image.convert("RGB").save(fallback_path, format="JPEG", quality=88, optimize=True)
                return fallback_path, "image/jpeg"

    async def upload_product_photos(
        self,
        *,
        product: Product,
        files: list[UploadFile],
        db: AsyncSession | None = None,
    ) -> list[dict[str, Any]]:
        if not files:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Yüklenecek dosya bulunamadı.")

        current_photos: list[dict[str, Any]] = list(product.photos or [])
        product_dir = self._product_photo_dir(product)
        added_items: list[dict[str, Any]] = []

        for upload in files:
            filename = (upload.filename or "").strip()
            if not filename:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dosya adı boş olamaz.")

            content_type = (upload.content_type or "").strip().lower()
            if content_type and not content_type.startswith(ALLOWED_MIME_PREFIX):
                raise HTTPException(
                    status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                    detail=f"Desteklenmeyen dosya türü: {content_type}",
                )

            raw_bytes = await upload.read()
            if not raw_bytes:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{filename} dosyası boş.")
            if len(raw_bytes) > self.max_size_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"{filename} boyutu limitin üzerinde (max {self.max_size_bytes // (1024 * 1024)} MB).",
                )

            image = self._normalize_image(self._open_image(raw_bytes))
            photo_id = uuid.uuid4().hex
            source_ext = self._safe_ext(filename, content_type, image.format)

            original_path = product_dir / f"{photo_id}_orig.{source_ext}"
            original_path.write_bytes(raw_bytes)

            optimized_path, optimized_mime = self._save_optimized(image, product_dir, photo_id)

            item = {
                "id": photo_id,
                "url": self._public_url_for(optimized_path),
                "filename": filename,
                "is_primary": False,
                "uploaded_at": self._utc_iso(),
                "mime_type": optimized_mime,
                "size_bytes": len(raw_bytes),
                "avif_url": self._public_url_for(optimized_path) if optimized_mime == "image/avif" else None,
                "original_url": self._public_url_for(original_path),
                # Internal absolute paths are used by Woo media upload fallback logic.
                "avif_path": str(optimized_path),
                "original_path": str(original_path),
            }
            added_items.append(item)

        merged = current_photos + added_items
        if merged:
            has_primary = any(bool(photo.get("is_primary")) for photo in merged)
            if not has_primary:
                merged[0]["is_primary"] = True
        return merged

    def delete_product_photo(self, *, product: Product, photo_id: str) -> list[dict[str, Any]]:
        existing: list[dict[str, Any]] = list(product.photos or [])
        if not existing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Üründe fotoğraf bulunamadı.")

        target: dict[str, Any] | None = None
        remaining: list[dict[str, Any]] = []

        for item in existing:
            if str(item.get("id")) == str(photo_id):
                target = item
                continue
            remaining.append(item)

        if not target:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fotoğraf bulunamadı.")

        for key in ("avif_path", "original_path"):
            value = target.get(key)
            if not value:
                continue
            try:
                path = Path(str(value)).expanduser().resolve()
                if path.exists():
                    path.unlink()
            except Exception:
                # Dosya silme hatası akışı durdurmamalı; kayıt yine de kaldırılır.
                pass

        if target.get("is_primary") and remaining:
            remaining[0]["is_primary"] = True

        return remaining


def reorder_photos(product, photo_ids: list[str]) -> list[dict]:
    """R1-36 — operatörün sürükle-bırak sırası kalıcılaşır.

    Verilen id sırası sort_order olarak yazılır; İLK görsel otomatik Primær
    olur (diğerleri düşer). Listede olmayan (eşzamanlı eklenen) fotoğraflar
    mevcut göreli sırasıyla sona eklenir."""
    photos = list(product.photos or [])
    by_id = {str(item.get("id")): item for item in photos if item.get("id")}
    ordered: list[dict] = []
    for photo_id in photo_ids:
        item = by_id.pop(str(photo_id), None)
        if item is not None:
            ordered.append(item)
    # id'siz veya listede anılmayanlar sona (mevcut sırayla)
    ordered.extend(item for item in photos if item not in ordered)
    for index, item in enumerate(ordered):
        item["sort_order"] = index
        item["is_primary"] = index == 0
    return ordered


def sorted_photos_for_publish(product) -> list[dict]:
    """Operatör sırası (sort_order) esastır; yoksa is_primary önce, sonra
    uploaded_at — Woo/AI tüketicilerinin ortak sırası (images[0] öne çıkan
    görsel olur)."""
    photos = list(product.photos or [])
    photos.sort(
        key=lambda item: (
            item.get("sort_order") if isinstance(item.get("sort_order"), int) else 10_000,
            0 if bool(item.get("is_primary")) else 1,
            str(item.get("uploaded_at") or ""),
        )
    )
    return photos
