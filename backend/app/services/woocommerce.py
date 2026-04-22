from __future__ import annotations

import mimetypes
import re
import html
import json
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.config import get_settings
from app.models.product import Product
from app.utils.helpers import quantize_2


PRODUCT_TYPE_DA = {
    "bracelet": "Armbånd",
    "ring": "Ring",
    "necklace": "Halskæde",
    "earring": "Øreringe",
    "chain": "Kæde",
    "bar": "Barre",
    "jewelry": "Smykke",
}

METAL_TYPE_DA = {
    "yellow_gold": "Gult Guld",
    "white_gold": "Hvidguld",
    "silver": "Sølv",
    "platinum": "Platin",
    "palladium": "Palladium",
}

PRODUCT_TYPE_SLUG_DA = {
    "bracelet": "armbaand",
    "ring": "ring",
    "necklace": "halskaede",
    "earring": "oereringe",
    "chain": "kaede",
    "bar": "barre",
    "jewelry": "smykke",
}

METAL_TYPE_SLUG_DA = {
    "yellow_gold": "gult-guld",
    "white_gold": "hvidguld",
    "silver": "soelv",
    "platinum": "platin",
    "palladium": "palladium",
}

SEO_SECTION_KEYS = {
    "SEO_TITLE": "seo_title",
    "SHORT_DESCRIPTION": "short_description",
    "LONG_DESCRIPTION_HTML": "long_description_html",
    "META_DESCRIPTION": "meta_description",
    "URL_SLUG": "url_slug",
}

REQUIRED_SEO_FIELDS: list[tuple[str, str]] = [
    ("seo_title", "SEO Title"),
    ("short_description", "Kısa Açıklama"),
    ("long_description_html", "Uzun Açıklama (HTML)"),
    ("meta_description", "Meta Description"),
    ("url_slug", "URL Slug"),
]


def _strip_code_fence(value: str) -> str:
    text = value.strip()
    match = re.match(r"^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$", text)
    if match:
        return match.group(1).strip()
    return text


def _sanitize_slug(value: str) -> str:
    slug = value.strip().lower()
    if not slug:
        return ""

    replacements = {
        "æ": "ae",
        "ø": "oe",
        "å": "aa",
        "ä": "a",
        "ö": "o",
        "ü": "u",
        "é": "e",
        "è": "e",
        "ê": "e",
        "ë": "e",
    }
    for source, target in replacements.items():
        slug = slug.replace(source, target)

    slug = re.sub(r"[^a-z0-9-]+", "-", slug)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    return slug


def _normalize_long_description_html(value: str) -> str:
    text = value.strip()
    if not text:
        return text

    lines = text.splitlines()
    normalized: list[str] = []
    paragraph_buffer: list[str] = []

    def flush_paragraph() -> None:
        if not paragraph_buffer:
            return
        content = " ".join(part.strip() for part in paragraph_buffer if part.strip()).strip()
        paragraph_buffer.clear()
        if content:
            normalized.append(f"<p>{html.escape(content, quote=False)}</p>")

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            flush_paragraph()
            continue

        if line.startswith("<"):
            flush_paragraph()
            normalized.append(line)
            continue

        paragraph_buffer.append(line)

    flush_paragraph()
    return "\n".join(normalized).strip()


def _parse_ai_description_seo_bundle(text: str) -> dict[str, str]:
    if not text or not text.strip():
        return {}

    parsed: dict[str, str] = {}
    current_key: str | None = None
    buffer: list[str] = []

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        section_match = re.match(
            r"^\s*(SEO_TITLE|SHORT_DESCRIPTION|LONG_DESCRIPTION_HTML|META_DESCRIPTION|URL_SLUG)\s*:\s*(.*)$",
            line,
        )
        if section_match:
            if current_key is not None:
                parsed[current_key] = _strip_code_fence("\n".join(buffer).strip())
            current_key = SEO_SECTION_KEYS[section_match.group(1)]
            inline_value = section_match.group(2).strip()
            buffer = [inline_value] if inline_value else []
            continue

        if current_key is not None:
            buffer.append(line)

    if current_key is not None:
        parsed[current_key] = _strip_code_fence("\n".join(buffer).strip())

    clean = {key: value.strip() for key, value in parsed.items() if value and value.strip()}
    if "url_slug" in clean:
        clean["url_slug"] = _sanitize_slug(clean["url_slug"])
        if not clean["url_slug"]:
            clean.pop("url_slug", None)
    if "long_description_html" in clean:
        clean["long_description_html"] = _normalize_long_description_html(clean["long_description_html"])
    return clean


def parse_ai_description_seo_bundle(text: str) -> dict[str, str]:
    return _parse_ai_description_seo_bundle(text)


def missing_required_seo_fields(text: str) -> list[str]:
    bundle = _parse_ai_description_seo_bundle(text)
    missing: list[str] = []
    for key, label in REQUIRED_SEO_FIELDS:
        if not str(bundle.get(key) or "").strip():
            missing.append(label)
    return missing


class WooCommerceService:
    def __init__(self) -> None:
        settings = get_settings()
        self.wc_base_url = settings.woocommerce_base_url.rstrip("/")
        self.consumer_key = settings.woocommerce_consumer_key.strip()
        self.consumer_secret = settings.woocommerce_consumer_secret.strip()
        self.timeout = max(5.0, float(settings.woocommerce_timeout_seconds))

        wp_base = settings.wordpress_base_url.rstrip("/")
        if not wp_base and self.wc_base_url:
            wp_base = self.wc_base_url.split("/wp-json/")[0].rstrip("/")
        self.wp_base_url = wp_base
        self.wp_app_username = settings.wp_app_username.strip()
        self.wp_app_password = settings.wp_app_password.replace(" ", "").strip()

    def _ensure_wc_config(self) -> None:
        if not self.wc_base_url or not self.consumer_key or not self.consumer_secret:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="WooCommerce ayarları eksik (WOOCOMMERCE_BASE_URL / KEY / SECRET).",
            )

    def _can_upload_media(self) -> bool:
        return bool(self.wp_base_url and self.wp_app_username and self.wp_app_password)

    async def _wc_request(
        self,
        method: str,
        path: str,
        *,
        json_payload: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any] | list[Any]:
        self._ensure_wc_config()
        url = f"{self.wc_base_url}/{path.lstrip('/')}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.request(
                    method,
                    url,
                    auth=(self.consumer_key, self.consumer_secret),
                    json=json_payload,
                    params=params,
                    headers={"User-Agent": "SeroGuldCRM/1.0"},
                )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"WooCommerce bağlantı hatası: {exc}",
            ) from exc

        if response.status_code >= 400:
            upstream_message = response.text[:500]
            try:
                payload = response.json()
            except json.JSONDecodeError:
                payload = None

            if isinstance(payload, dict):
                candidate = str(payload.get("message") or "").strip()
                if candidate:
                    upstream_message = candidate

            if response.status_code == status.HTTP_404_NOT_FOUND:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=upstream_message or "WooCommerce kaynağı bulunamadı.",
                )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"WooCommerce hata ({response.status_code}): {upstream_message}",
            )

        return response.json()

    async def _ensure_category(self, name: str) -> int:
        existing = await self._wc_request("GET", "/products/categories", params={"search": name, "per_page": 100})
        if isinstance(existing, list):
            for item in existing:
                if str(item.get("name", "")).strip().lower() == name.lower():
                    return int(item["id"])

        created = await self._wc_request("POST", "/products/categories", json_payload={"name": name})
        return int(created["id"])

    async def _load_photo_bytes(self, photo_url: str) -> tuple[bytes, str]:
        if photo_url.startswith("http://") or photo_url.startswith("https://"):
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(photo_url, follow_redirects=True)
                response.raise_for_status()
                content_type = response.headers.get("content-type", "application/octet-stream")
                return response.content, content_type

        path_value = photo_url[7:] if photo_url.startswith("file://") else photo_url
        local_path = Path(path_value).expanduser().resolve()
        if not local_path.exists():
            raise FileNotFoundError(f"Fotoğraf bulunamadı: {local_path}")
        content = local_path.read_bytes()
        content_type = mimetypes.guess_type(local_path.name)[0] or "application/octet-stream"
        return content, content_type

    async def _upload_media(self, photo_item: dict[str, Any]) -> dict[str, Any] | None:
        if not self._can_upload_media():
            return None

        photo_url = str(
            photo_item.get("avif_path")
            or photo_item.get("original_path")
            or photo_item.get("url")
            or photo_item.get("original_url")
            or ""
        ).strip()
        if not photo_url:
            return None

        try:
            content, content_type = await self._load_photo_bytes(photo_url)
        except Exception:
            return None

        filename = str(photo_item.get("filename") or "").strip()
        if not filename:
            filename = Path(photo_url.split("?")[0]).name or "seroguld-product.jpg"

        media_url = f"{self.wp_base_url}/wp-json/wp/v2/media"
        headers = {
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Type": content_type,
            "User-Agent": "SeroGuldCRM/1.0",
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    media_url,
                    auth=(self.wp_app_username, self.wp_app_password),
                    headers=headers,
                    content=content,
                )
        except Exception:
            return None

        if response.status_code >= 400:
            return None

        payload = response.json()
        media_id = payload.get("id")
        if not media_id:
            return None
        return {"id": int(media_id)}

    def _default_name(self, product: Product) -> str:
        product_type = PRODUCT_TYPE_DA.get(getattr(product.product_type, "value", str(product.product_type)), "Smykke")
        metal_type = METAL_TYPE_DA.get(getattr(product.metal_type, "value", str(product.metal_type)), "Ædelmetal")
        return f"{product_type} - {metal_type} #{product.product_number}"

    def _default_slug(self, product: Product) -> str:
        product_type_key = getattr(product.product_type, "value", str(product.product_type))
        metal_type_key = getattr(product.metal_type, "value", str(product.metal_type))
        product_token = PRODUCT_TYPE_SLUG_DA.get(product_type_key, "smykke")
        metal_token = METAL_TYPE_SLUG_DA.get(metal_type_key, "aedelmetal")
        karat_token = _sanitize_slug(str(product.purity_karat or "").replace(" ", ""))

        weight_token = ""
        if getattr(product, "weight_grams", None) is not None:
            weight_token = f"{str(product.weight_grams).replace('.', '-') }g"
            weight_token = _sanitize_slug(weight_token)

        ref = (product.reference_number or product.product_number or "").strip()
        ref_token = _sanitize_slug(f"ref-{ref}") if ref else ""

        parts = [metal_token, product_token, karat_token, weight_token, ref_token]
        slug = "-".join(part for part in parts if part)
        return _sanitize_slug(slug)

    def _is_slug_consistent(self, slug: str, product: Product) -> bool:
        product_type_key = getattr(product.product_type, "value", str(product.product_type))
        expected_token = PRODUCT_TYPE_SLUG_DA.get(product_type_key, "")
        if not expected_token:
            return True
        return expected_token in slug

    async def publish_product(
        self,
        *,
        product: Product,
        regular_price_dkk: Decimal,
        name: str | None = None,
    ) -> dict[str, Any]:
        category_names = [
            METAL_TYPE_DA.get(getattr(product.metal_type, "value", str(product.metal_type)), "Ædelmetal"),
            PRODUCT_TYPE_DA.get(getattr(product.product_type, "value", str(product.product_type)), "Smykke"),
        ]
        category_ids = [await self._ensure_category(cat_name) for cat_name in category_names]

        images: list[dict[str, Any]] = []
        for photo_item in product.photos or []:
            uploaded = await self._upload_media(photo_item)
            if uploaded:
                images.append(uploaded)

        ai_text = (product.ai_description or "").strip()
        seo_bundle = _parse_ai_description_seo_bundle(ai_text)
        description_value = seo_bundle.get("long_description_html") or ai_text
        short_description_value = seo_bundle.get("short_description")
        slug_value = seo_bundle.get("url_slug")
        meta_description_value = seo_bundle.get("meta_description")
        seo_title_value = seo_bundle.get("seo_title")
        if not slug_value or not self._is_slug_consistent(slug_value, product):
            slug_value = self._default_slug(product)

        payload: dict[str, Any] = {
            "name": name.strip() if name and name.strip() else (seo_title_value or self._default_name(product)),
            "description": description_value,
            "regular_price": str(quantize_2(regular_price_dkk)),
            "categories": [{"id": category_id} for category_id in category_ids],
            "status": "publish",
            "meta_data": [{"key": "crm_product_id", "value": str(product.id)}],
        }
        if short_description_value:
            payload["short_description"] = short_description_value
        if slug_value:
            payload["slug"] = slug_value
        if meta_description_value:
            payload["meta_data"].extend(
                [
                    {"key": "_yoast_wpseo_metadesc", "value": meta_description_value},
                    {"key": "rank_math_description", "value": meta_description_value},
                    {"key": "crm_meta_description", "value": meta_description_value},
                ]
            )
        if images:
            payload["images"] = images

        if product.woocommerce_product_id:
            result = await self._wc_request(
                "PUT",
                f"/products/{product.woocommerce_product_id}",
                json_payload=payload,
            )
        else:
            result = await self._wc_request("POST", "/products", json_payload=payload)
        return result

    async def unpublish_product(self, wc_product_id: int) -> dict[str, Any]:
        return await self._wc_request(
            "PUT",
            f"/products/{wc_product_id}",
            json_payload={"status": "draft"},
        )

    async def fetch_recent_published_products(self, *, limit: int = 100) -> list[dict[str, Any]]:
        target = max(1, min(int(limit or 0), 100))
        payload = await self._wc_request(
            "GET",
            "/products",
            params={
                "status": "publish",
                "per_page": target,
                "page": 1,
                "orderby": "date",
                "order": "desc",
            },
        )
        if not isinstance(payload, list):
            return []
        return [item for item in payload[:target] if isinstance(item, dict)]

    async def fetch_product(self, *, wc_product_id: int) -> dict[str, Any]:
        payload = await self._wc_request("GET", f"/products/{int(wc_product_id)}")
        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="WooCommerce ürün yanıtı beklenen formatta değil.",
            )
        return payload

    async def fetch_recent_orders(
        self,
        *,
        days: int = 7,
        per_page: int = 50,
        statuses: str = "processing,completed",
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "status": statuses,
            "per_page": max(1, min(per_page, 100)),
            "orderby": "date",
            "order": "desc",
        }
        if days > 0:
            from datetime import timedelta
            from app.utils.helpers import utc_now

            after = (utc_now() - timedelta(days=days)).isoformat()
            params["after"] = after

        payload = await self._wc_request("GET", "/orders", params=params)
        if not isinstance(payload, list):
            return []
        return [item for item in payload if isinstance(item, dict)]

    async def fetch_order_notes(self, *, order_id: int, per_page: int = 20) -> list[dict[str, Any]]:
        payload = await self._wc_request(
            "GET",
            f"/orders/{int(order_id)}/notes",
            params={
                "per_page": max(1, min(per_page, 100)),
                "orderby": "date",
                "order": "desc",
            },
        )
        if not isinstance(payload, list):
            return []
        return [item for item in payload if isinstance(item, dict)]

    async def fetch_order(self, *, order_id: int) -> dict[str, Any]:
        payload = await self._wc_request("GET", f"/orders/{int(order_id)}")
        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="WooCommerce sipariş yanıtı beklenen formatta değil.",
            )
        return payload

    async def fetch_customers(self, *, limit: int = 1000) -> list[dict[str, Any]]:
        target = max(1, min(int(limit or 0), 5000))
        per_page = min(100, target)
        page = 1
        customers: list[dict[str, Any]] = []

        while len(customers) < target:
            payload = await self._wc_request(
                "GET",
                "/customers",
                params={
                    "per_page": per_page,
                    "page": page,
                    "orderby": "registered_date",
                    "order": "desc",
                },
            )
            if not isinstance(payload, list) or not payload:
                break

            chunk = [item for item in payload if isinstance(item, dict)]
            customers.extend(chunk)
            if len(payload) < per_page:
                break
            page += 1

        return customers[:target]

    @staticmethod
    def _normalize_customer_phone(value: str | None) -> str:
        return "".join(ch for ch in str(value or "") if ch.isdigit())

    async def fetch_customer_by_id(self, *, customer_id: int) -> dict[str, Any] | None:
        try:
            payload = await self._wc_request("GET", f"/customers/{int(customer_id)}")
        except HTTPException as exc:
            if exc.status_code == status.HTTP_404_NOT_FOUND:
                return None
            raise
        if not isinstance(payload, dict):
            return None
        return payload

    async def _find_matching_customers(
        self,
        *,
        email: str | None,
        phone: str | None,
    ) -> list[dict[str, Any]]:
        normalized_email = str(email or "").strip().lower()
        normalized_phone = self._normalize_customer_phone(phone)
        candidates: list[dict[str, Any]] = []

        if normalized_email:
            payload = await self._wc_request(
                "GET",
                "/customers",
                params={"search": normalized_email, "per_page": 100},
            )
            if isinstance(payload, list):
                candidates.extend(item for item in payload if isinstance(item, dict))

        if not candidates and normalized_phone:
            candidates = await self.fetch_customers(limit=500)

        matched: list[dict[str, Any]] = []
        seen_ids: set[int] = set()
        for item in candidates:
            item_id = int(item.get("id") or 0)
            if item_id and item_id in seen_ids:
                continue
            item_email = str(item.get("email") or "").strip().lower()
            billing = item.get("billing") if isinstance(item.get("billing"), dict) else {}
            item_phone = self._normalize_customer_phone(str((billing or {}).get("phone") or ""))
            email_match = bool(normalized_email and item_email == normalized_email)
            phone_match = bool(normalized_phone and item_phone == normalized_phone)
            if not email_match and not phone_match:
                continue
            if item_id:
                seen_ids.add(item_id)
            matched.append(item)
        return matched

    async def _resolve_privacy_customer_match(
        self,
        *,
        woocommerce_customer_id: str | None,
        email: str | None,
        phone: str | None,
    ) -> dict[str, Any]:
        explicit_id = str(woocommerce_customer_id or "").strip()
        if explicit_id:
            explicit_customer = await self.fetch_customer_by_id(customer_id=int(explicit_id))
            if explicit_customer is None:
                return {
                    "status": "no_match",
                    "matched_by": "woocommerce_customer_id",
                    "matches": [],
                    "warnings": [f"Woo customer bulunamadı: {explicit_id}"],
                }
            return {
                "status": "matched",
                "matched_by": "woocommerce_customer_id",
                "matches": [explicit_customer],
                "warnings": [],
            }

        normalized_email = str(email or "").strip().lower()
        if normalized_email:
            email_matches = await self._find_matching_customers(email=normalized_email, phone=None)
            if len(email_matches) == 1:
                return {
                    "status": "matched",
                    "matched_by": "email",
                    "matches": email_matches,
                    "warnings": [],
                }
            if len(email_matches) > 1:
                return {
                    "status": "ambiguous",
                    "matched_by": "email",
                    "matches": email_matches,
                    "warnings": [f"Woo email eşleşmesi birden fazla sonuç döndürdü ({len(email_matches)})."],
                }

        normalized_phone = self._normalize_customer_phone(phone)
        if normalized_phone:
            phone_matches = await self._find_matching_customers(email=None, phone=normalized_phone)
            if len(phone_matches) == 1:
                return {
                    "status": "matched",
                    "matched_by": "phone",
                    "matches": phone_matches,
                    "warnings": [],
                }
            if len(phone_matches) > 1:
                return {
                    "status": "ambiguous",
                    "matched_by": "phone",
                    "matches": phone_matches,
                    "warnings": [f"Woo telefon eşleşmesi birden fazla sonuç döndürdü ({len(phone_matches)})."],
                }

        return {
            "status": "no_match",
            "matched_by": None,
            "matches": [],
            "warnings": ["Woo tarafında benzersiz müşteri eşleşmesi bulunamadı."],
        }

    async def pseudonymize_customer(
        self,
        *,
        woocommerce_customer_id: str | None,
        email: str | None,
        phone: str | None,
        placeholder_email: str | None,
    ) -> dict[str, Any]:
        resolution = await self._resolve_privacy_customer_match(
            woocommerce_customer_id=woocommerce_customer_id,
            email=email,
            phone=phone,
        )
        if resolution["status"] != "matched":
            return {
                "status": resolution["status"],
                "matched_by": resolution.get("matched_by"),
                "updated_ids": [],
                "warnings": resolution.get("warnings", []),
            }

        placeholder = str(placeholder_email or "").strip().lower() or None
        updated_ids: list[int] = []
        for item in resolution["matches"]:
            customer_id = int(item["id"])
            payload: dict[str, Any] = {
                "first_name": "GDPR",
                "last_name": "Redacted",
                "billing": {
                    "first_name": "GDPR",
                    "last_name": "Redacted",
                    "company": "",
                    "address_1": "",
                    "address_2": "",
                    "city": "",
                    "state": "",
                    "postcode": "",
                    "country": "",
                    "phone": "",
                    "email": placeholder or str(item.get("email") or "").strip().lower(),
                },
                "shipping": {
                    "first_name": "GDPR",
                    "last_name": "Redacted",
                    "company": "",
                    "address_1": "",
                    "address_2": "",
                    "city": "",
                    "state": "",
                    "postcode": "",
                    "country": "",
                },
                "meta_data": [
                    {"key": "seroguld_gdpr_status", "value": "pseudonymized"},
                ],
            }
            if placeholder:
                payload["email"] = placeholder
            await self._wc_request("PUT", f"/customers/{customer_id}", json_payload=payload)
            updated_ids.append(customer_id)
        return {
            "status": "synced",
            "matched_by": resolution.get("matched_by"),
            "updated_ids": updated_ids,
            "warnings": [],
        }

    async def marketing_opt_out_customer(
        self,
        *,
        woocommerce_customer_id: str | None,
        email: str | None,
        phone: str | None,
    ) -> dict[str, Any]:
        resolution = await self._resolve_privacy_customer_match(
            woocommerce_customer_id=woocommerce_customer_id,
            email=email,
            phone=phone,
        )
        if resolution["status"] != "matched":
            return {
                "status": resolution["status"],
                "matched_by": resolution.get("matched_by"),
                "updated_ids": [],
                "warnings": resolution.get("warnings", []),
            }

        updated_ids: list[int] = []
        for item in resolution["matches"]:
            customer_id = int(item["id"])
            payload = {
                "meta_data": [
                    {"key": "seroguld_marketing_opt_out", "value": "true"},
                ]
            }
            await self._wc_request("PUT", f"/customers/{customer_id}", json_payload=payload)
            updated_ids.append(customer_id)
        return {
            "status": "synced",
            "matched_by": resolution.get("matched_by"),
            "updated_ids": updated_ids,
            "warnings": [],
        }
