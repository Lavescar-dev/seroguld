from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_usage_log import AIUsageLog
from app.models.enums import MetalTypeEnum, ProductTypeEnum
from app.models.pos_session_product_link import PosSessionProductLink
from app.models.product import Product
from app.models.product_history import ProductHistory
from app.models.woocommerce_log import WooCommerceSyncLog
from app.utils.helpers import quantize_2, utc_now

_TEXT_NORMALIZE_MAP = str.maketrans(
    {
        "æ": "ae",
        "ø": "oe",
        "å": "aa",
        "ä": "a",
        "ö": "o",
        "ü": "u",
    }
)

_KARAT_TO_PURITY: dict[int, Decimal] = {
    8: Decimal("33.3"),
    9: Decimal("37.5"),
    10: Decimal("41.7"),
    14: Decimal("58.5"),
    18: Decimal("75.0"),
    22: Decimal("91.6"),
    24: Decimal("99.9"),
}

_SALE_ORDER_STATUSES = {"processing", "completed"}
SOURCE_TYPE_COIN_TAG = "[SOURCE_TYPE:coin]"
MANUAL_REVIEW_TAG_PREFIX = "[MANUAL_REVIEW:"


def _normalize_text(value: str) -> str:
    return value.lower().translate(_TEXT_NORMALIZE_MAP)


def _to_decimal(value: object) -> Decimal | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    clean = text.replace("\xa0", "").replace(" ", "").replace(",", ".")
    try:
        return Decimal(clean)
    except InvalidOperation:
        return None


def parse_wc_datetime(raw: object) -> datetime | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    candidate = raw.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def extract_order_match_for_wc_product(
    order: dict[str, object],
    *,
    wc_product_id: int,
) -> dict[str, object] | None:
    order_status = str(order.get("status") or "").strip().lower()
    if order_status not in _SALE_ORDER_STATUSES:
        return None

    line_items = order.get("line_items")
    if not isinstance(line_items, list):
        return None

    for item in line_items:
        if not isinstance(item, dict):
            continue
        try:
            item_wc_id = int(item.get("product_id"))
        except (TypeError, ValueError):
            continue
        if item_wc_id != wc_product_id:
            continue

        sale_price = (
            _to_decimal(item.get("total"))
            or _to_decimal(item.get("price"))
            or _to_decimal(item.get("subtotal"))
        )
        sale_date = (
            parse_wc_datetime(order.get("date_paid"))
            or parse_wc_datetime(order.get("date_completed"))
            or parse_wc_datetime(order.get("date_created"))
            or utc_now()
        )
        return {
            "order_id": order.get("id"),
            "line_item_id": item.get("id"),
            "sale_price_dkk": quantize_2(sale_price) if sale_price is not None else None,
            "sale_date": sale_date,
            "order_status": order_status,
        }

    return None


def _combine_wc_text(wc_product: dict) -> str:
    categories = wc_product.get("categories") or []
    cat_bits: list[str] = []
    for item in categories:
        if not isinstance(item, dict):
            continue
        cat_bits.extend(
            [
                str(item.get("name") or ""),
                str(item.get("slug") or ""),
            ]
        )

    attributes = wc_product.get("attributes") or []
    attr_bits: list[str] = []
    for attr in attributes:
        if not isinstance(attr, dict):
            continue
        attr_bits.extend([str(attr.get("name") or ""), str(attr.get("slug") or "")])
        options = attr.get("options") or []
        if isinstance(options, list):
            attr_bits.extend(str(option or "") for option in options)
        elif isinstance(options, str):
            attr_bits.append(options)

    parts = [
        str(wc_product.get("name") or ""),
        str(wc_product.get("short_description") or ""),
        str(wc_product.get("description") or ""),
        *cat_bits,
        *attr_bits,
    ]
    return " ".join(part for part in parts if part).strip()


def _contains_any(text: str, patterns: list[str]) -> bool:
    return any(re.search(pattern, text) is not None for pattern in patterns)


def _wc_text_scopes(wc_product: dict) -> tuple[str, str, str]:
    categories = wc_product.get("categories") or []
    cat_bits: list[str] = []
    for item in categories:
        if not isinstance(item, dict):
            continue
        cat_bits.extend([str(item.get("name") or ""), str(item.get("slug") or "")])

    attributes = wc_product.get("attributes") or []
    attr_bits: list[str] = []
    for attr in attributes:
        if not isinstance(attr, dict):
            continue
        attr_bits.extend([str(attr.get("name") or ""), str(attr.get("slug") or "")])
        options = attr.get("options") or []
        if isinstance(options, list):
            attr_bits.extend(str(option or "") for option in options)
        elif isinstance(options, str):
            attr_bits.append(options)

    name_text = _normalize_text(str(wc_product.get("name") or ""))
    category_attr_text = _normalize_text(" ".join(part for part in [*cat_bits, *attr_bits] if part))
    full_text = _normalize_text(_combine_wc_text(wc_product))
    return name_text, category_attr_text, full_text


_PRODUCT_TYPE_PATTERNS: list[tuple[str, ProductTypeEnum, list[str]]] = [
    # Coin comes first and is intentionally mapped as BAR in CRM.
    (
        "coin",
        ProductTypeEnum.BAR,
        [
            r"\bcoins?\b",
            r"\bmoent(?:er)?\b",
            r"\bmunt(?:er)?\b",
            r"\bcentenario\b",
            r"\bliberty\b",
            r"\bkrugerrand\b",
            r"\bmaple(?:\s+leaf)?\b",
            r"\bphilharmoniker\b",
            r"\bsovereign\b",
        ],
    ),
    (
        "bar",
        ProductTypeEnum.BAR,
        [
            r"\bbarre?r?\b",
            r"\bbars?\b",
            r"\bbullion\b",
            r"\bguldbarrer\b",
            r"\bsoelvbarrer\b",
        ],
    ),
    ("bracelet", ProductTypeEnum.BRACELET, [r"\barmbaand\b", r"\barmband\b", r"\barmring\b"]),
    ("earring", ProductTypeEnum.EARRING, [r"\boereringe?\b", r"\boreringe?\b", r"\bearrings?\b"]),
    ("necklace", ProductTypeEnum.NECKLACE, [r"\bhalskaede\b", r"\bhalskade\b", r"\bnecklaces?\b"]),
    ("ring", ProductTypeEnum.RING, [r"\bringe?\b"]),
    ("chain", ProductTypeEnum.CHAIN, [r"\bkaede\b", r"\bkade\b", r"\bchains?\b"]),
]


def infer_product_type_details(wc_product: dict) -> tuple[ProductTypeEnum, str | None, list[str]]:
    name_text, category_attr_text, full_text = _wc_text_scopes(wc_product)
    for text in (name_text, category_attr_text, full_text):
        for source_key, mapped_type, patterns in _PRODUCT_TYPE_PATTERNS:
            if _contains_any(text, patterns):
                if source_key == "coin":
                    return mapped_type, "coin", []
                return mapped_type, source_key, []

    if _contains_any(full_text, [r"\bsmykke(?:r)?\b", r"\bjewel(?:ry|ries)?\b"]):
        return ProductTypeEnum.JEWELRY, "jewelry", []

    return ProductTypeEnum.JEWELRY, None, ["type_unknown"]


_METAL_PATTERNS: list[tuple[MetalTypeEnum, list[str]]] = [
    (
        MetalTypeEnum.WHITE_GOLD,
        [
            r"\bhvidguld\b",
            r"\bhvidt?\s*guld\b",
            r"\bwhite[\s-]?gold\b",
        ],
    ),
    (MetalTypeEnum.PALLADIUM, [r"\bpalladium\b", r"\bpd\b"]),
    (MetalTypeEnum.PLATINUM, [r"\bplatin\b", r"\bplatinum\b"]),
    (MetalTypeEnum.SILVER, [r"\bsoelv\b", r"\bsilver\b"]),
    (
        MetalTypeEnum.YELLOW_GOLD,
        [
            r"\bgult?\s*guld\b",
            r"\bgul\s*guld\b",
            r"\bguld[a-z]*\b",
            r"\bguld\b",
            r"\bgold\b",
        ],
    ),
]


def _detect_metal_from_text(text: str) -> MetalTypeEnum | None:
    scored: list[tuple[int, int, MetalTypeEnum]] = []
    for priority, (metal_type, patterns) in enumerate(_METAL_PATTERNS):
        score = sum(1 for pattern in patterns if re.search(pattern, text))
        if score > 0:
            scored.append((score, -priority, metal_type))
    if not scored:
        return None
    scored.sort(reverse=True)
    return scored[0][2]


def infer_metal_type_details(wc_product: dict) -> tuple[MetalTypeEnum, list[str]]:
    name_text, category_attr_text, full_text = _wc_text_scopes(wc_product)
    for text in (name_text, category_attr_text, full_text):
        detected = _detect_metal_from_text(text)
        if detected is not None:
            return detected, []
    return MetalTypeEnum.YELLOW_GOLD, ["metal_unknown"]


def compose_import_notes(
    *,
    title: str,
    is_update: bool,
    source_type: str | None,
    manual_review_reasons: list[str],
) -> str:
    tokens: list[str] = []
    if source_type == "coin":
        tokens.append(SOURCE_TYPE_COIN_TAG)
    if manual_review_reasons:
        reasons = ",".join(dict.fromkeys(reason.strip() for reason in manual_review_reasons if reason.strip()))
        tokens.append(f"{MANUAL_REVIEW_TAG_PREFIX}{reasons}]")

    base = "Woo import update" if is_update else "Woo import"
    if title:
        base = f"{base} · {title}"
    full = " ".join([*tokens, base]).strip()
    return full[:500]


def clear_manual_review_marker(notes: str | None) -> str | None:
    text = str(notes or "")
    cleaned = re.sub(r"\[MANUAL_REVIEW:[^\]]*\]\s*", "", text, flags=re.IGNORECASE).strip()
    return cleaned or None


def extract_weight_grams(wc_product: dict) -> Decimal | None:
    # 1) WooCommerce native "weight" field (unit is store-configured, usually grams in this project).
    raw_weight = _to_decimal(wc_product.get("weight"))
    candidate_weights: list[Decimal] = []

    # 2) Attributes often carry "Vægt" for jewelry products.
    attributes = wc_product.get("attributes") or []
    for attr in attributes:
        if not isinstance(attr, dict):
            continue
        attr_name = _normalize_text(str(attr.get("name") or ""))
        attr_slug = _normalize_text(str(attr.get("slug") or ""))
        if not any(key in f"{attr_name} {attr_slug}" for key in ("vaegt", "weight", "gram", "oz")):
            continue
        options = attr.get("options") or []
        option_text = " ".join(str(item or "") for item in options) if isinstance(options, list) else str(options or "")
        normalized_option = _normalize_text(option_text)
        gram_match = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:g|gr|gram)\b", normalized_option)
        if gram_match:
            value = _to_decimal(gram_match.group(1))
            if value and value > 0:
                candidate_weights.append(value)
        oz_match = re.search(r"(\d+(?:[.,]\d+)?)\s*oz\b", normalized_option)
        if oz_match:
            value = _to_decimal(oz_match.group(1))
            if value and value > 0:
                candidate_weights.append(value * Decimal("31.1035"))

    # 3) Fallback to all searchable text (name/description/categories/attributes).
    text = _normalize_text(_combine_wc_text(wc_product))

    gram_match = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:g|gr|gram)\b", text)
    if gram_match:
        value = _to_decimal(gram_match.group(1))
        if value and value > 0:
            candidate_weights.append(value)

    oz_match = re.search(r"(\d+(?:[.,]\d+)?)\s*oz\b", text)
    if oz_match:
        value = _to_decimal(oz_match.group(1))
        if value and value > 0:
            candidate_weights.append(value * Decimal("31.1035"))

    if raw_weight and raw_weight > 0:
        if candidate_weights:
            inferred = max(candidate_weights)
            # Woo ürünlerinde sık görülen placeholder "1g" değerini,
            # isim/attribute içindeki gerçek ağırlıkla düzelt.
            if raw_weight <= Decimal("2") and inferred >= Decimal("5"):
                return quantize_2(inferred)
        return quantize_2(raw_weight)

    if candidate_weights:
        return quantize_2(max(candidate_weights))

    return None


def extract_purity(metal_type: MetalTypeEnum, wc_product: dict) -> tuple[str | None, Decimal]:
    text = _normalize_text(_combine_wc_text(wc_product))

    karat_match = re.search(r"\b(8|9|10|14|18|22|24)\s*k\b", text)
    if karat_match:
        karat = int(karat_match.group(1))
        return f"{karat}K", _KARAT_TO_PURITY[karat]

    for raw, purity in (
        ("9999", Decimal("99.99")),
        ("999", Decimal("99.90")),
        ("950", Decimal("95.00")),
        ("925", Decimal("92.50")),
        ("916", Decimal("91.60")),
        ("900", Decimal("90.00")),
        ("875", Decimal("87.50")),
        ("800", Decimal("80.00")),
        ("750", Decimal("75.00")),
        ("585", Decimal("58.50")),
    ):
        if raw in text:
            return raw, purity

    if metal_type == MetalTypeEnum.SILVER:
        return "999", Decimal("99.90")
    if metal_type in {MetalTypeEnum.PLATINUM, MetalTypeEnum.PALLADIUM}:
        return "950", Decimal("95.00")
    return "24K", Decimal("99.90")


def extract_wc_price_dkk(wc_product: dict) -> Decimal | None:
    for key in ("regular_price", "price", "sale_price"):
        value = _to_decimal(wc_product.get(key))
        if value and value > 0:
            return quantize_2(value)
    return None


def map_wc_images(wc_product: dict) -> list[dict]:
    images = wc_product.get("images") or []
    now_iso = utc_now().isoformat()
    mapped: list[dict] = []
    for idx, image in enumerate(images):
        if not isinstance(image, dict):
            continue
        url = str(image.get("src") or "").strip()
        if not url:
            continue
        filename = str(image.get("name") or "").strip() or None
        mapped.append(
            {
                "id": str(image.get("id") or f"wc-{idx + 1}"),
                "url": url,
                "filename": filename,
                "is_primary": idx == 0,
                "uploaded_at": now_iso,
                "original_url": url,
            }
        )
    return mapped


def _html_to_plain_text(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    collapsed = re.sub(r"<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", collapsed).strip()


def build_wc_product_summary(wc_product: dict) -> dict[str, object]:
    categories = []
    for item in wc_product.get("categories") or []:
        if isinstance(item, dict):
            categories.append(
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "slug": item.get("slug"),
                }
            )

    tags = []
    for item in wc_product.get("tags") or []:
        if isinstance(item, dict):
            tags.append(
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "slug": item.get("slug"),
                }
            )

    attributes = []
    for item in wc_product.get("attributes") or []:
        if not isinstance(item, dict):
            continue
        options_raw = item.get("options")
        if isinstance(options_raw, list):
            options = [str(opt or "").strip() for opt in options_raw if str(opt or "").strip()]
        elif options_raw:
            options = [str(options_raw).strip()]
        else:
            options = []
        attributes.append(
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "slug": item.get("slug"),
                "options": options,
                "visible": bool(item.get("visible", False)),
                "variation": bool(item.get("variation", False)),
            }
        )

    images = []
    for idx, item in enumerate(wc_product.get("images") or []):
        if isinstance(item, dict):
            images.append(
                {
                    "id": item.get("id"),
                    "src": item.get("src"),
                    "name": item.get("name"),
                    "alt": item.get("alt"),
                    "is_primary": idx == 0,
                }
            )

    short_description_text = _html_to_plain_text(wc_product.get("short_description"))
    description_text = _html_to_plain_text(wc_product.get("description"))

    return {
        "id": wc_product.get("id"),
        "name": wc_product.get("name"),
        "slug": wc_product.get("slug"),
        "permalink": wc_product.get("permalink"),
        "status": wc_product.get("status"),
        "catalog_visibility": wc_product.get("catalog_visibility"),
        "sku": wc_product.get("sku"),
        "type": wc_product.get("type"),
        "price": wc_product.get("price"),
        "regular_price": wc_product.get("regular_price"),
        "sale_price": wc_product.get("sale_price"),
        "on_sale": bool(wc_product.get("on_sale", False)),
        "currency": wc_product.get("currency"),
        "stock_status": wc_product.get("stock_status"),
        "stock_quantity": wc_product.get("stock_quantity"),
        "manage_stock": bool(wc_product.get("manage_stock", False)),
        "backorders": wc_product.get("backorders"),
        "weight": wc_product.get("weight"),
        "dimensions": wc_product.get("dimensions"),
        "total_sales": wc_product.get("total_sales"),
        "date_created": wc_product.get("date_created"),
        "date_modified": wc_product.get("date_modified"),
        "short_description_text": short_description_text,
        "description_text": description_text,
        "categories": categories,
        "tags": tags,
        "attributes": attributes,
        "images": images,
    }


async def delete_mock_seed_products(db: AsyncSession) -> int:
    mock_ids = list(
        (
            await db.scalars(
                select(Product.id).where(
                    Product.woocommerce_product_id.is_(None),
                    (
                        Product.notes.ilike("%mock%")
                        | Product.notes.ilike("%smoke%")
                        | Product.reference_number.ilike("MNSM%")
                        | Product.reference_number.ilike("R-%")
                    ),
                )
            )
        ).all()
    )
    if not mock_ids:
        return 0

    await db.execute(delete(AIUsageLog).where(AIUsageLog.product_id.in_(mock_ids)))
    await db.execute(delete(PosSessionProductLink).where(PosSessionProductLink.product_id.in_(mock_ids)))
    await db.execute(delete(ProductHistory).where(ProductHistory.product_id.in_(mock_ids)))
    await db.execute(delete(WooCommerceSyncLog).where(WooCommerceSyncLog.product_id.in_(mock_ids)))
    await db.execute(delete(Product).where(Product.id.in_(mock_ids)))
    await db.commit()
    return len(mock_ids)
