"""seroguld.dk Woo/WP keşif probu — Settings eşleme haritalarını hazırlar.

Siteye erişimi olan makinede (backend venv) koşulur:
    .\\.venv\\Scripts\\python.exe -m app.tools.probe_woocommerce_site --product-id 37844
    .\\.venv\\Scripts\\python.exe -m app.tools.probe_woocommerce_site --test-upload C:\\path\\foto.jpg

Ne yapar:
  1. Kategori ağacını ID'leriyle listeler (id | parent | name | slug).
  2. Referans ürünün TÜM meta_data key'lerini + attributes + categories +
     tags döker (StoneX / Product Badge meta key keşfi için).
  3. (isteğe bağlı --test-upload) WP medya kanalına küçük bir dosya yükler,
     yanıtı raporlar ve siler (--keep-test-media ile bırakır). Bu adım
     SİTEYE YAZAR; bayrak vermeden çalışmaz.
Sonunda Settings > WooCommerce Eşlemeleri'ne yapıştırılacak HAZIR JSON
taslaklarını basar (kategori id'leri isim sezgileriyle önerilir).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import mimetypes
from pathlib import Path
from typing import Any

import httpx

from app.services.woocommerce import WooCommerceService

# Sitedeki bilinen kategori adları → harita hedefleri (küçük harf eşleşme).
_PRIMARY_NAME_HINTS: dict[str, tuple[str, str]] = {
    "guldsmykker": ("taki", "gold"),
    "sølvsmykker": ("taki", "silver"),
    "solvsmykker": ("taki", "silver"),
    "guldbarrer": ("kulce", "gold"),
    "sølvbarrer": ("kulce", "silver"),
    "solvbarrer": ("kulce", "silver"),
    "guldmønter": ("sikke", "gold"),
    "guldmonter": ("sikke", "gold"),
    "sølvmønter": ("sikke", "silver"),
    "solvmonter": ("sikke", "silver"),
    "platin": ("platin_pd", "platinum"),
    "palladium": ("platin_pd", "palladium"),
}


def build_category_map_draft(categories: list[dict[str, Any]]) -> dict[str, Any]:
    """Kategori listesinden Settings taslağı üretir (saf; testlenebilir).

    Karat kategorileri "14 kt. guld" / "8 kt guld" gibi adlardan yakalanır.
    """
    import re

    primary: dict[str, dict[str, int]] = {}
    karat: dict[str, int] = {}
    for item in categories:
        name = str(item.get("name") or "").strip().lower()
        category_id = item.get("id")
        if category_id is None:
            continue
        hint = _PRIMARY_NAME_HINTS.get(name)
        if hint:
            inventory_category, metal_group = hint
            primary.setdefault(inventory_category, {})[metal_group] = int(category_id)
            continue
        karat_match = re.match(r"^(\d{1,2}(?:[.,]\d)?)\s*kt\.?\s*guld$", name)
        if karat_match:
            karat[karat_match.group(1).replace(",", ".")] = int(category_id)
    draft: dict[str, Any] = {}
    if primary:
        draft["primary"] = primary
    if karat:
        draft["karat"] = karat
    return draft


def _print_header(title: str) -> None:
    print()
    print(f"=== {title} " + "=" * max(1, 60 - len(title)))


async def _fetch_all_categories(service: WooCommerceService) -> list[dict[str, Any]]:
    categories: list[dict[str, Any]] = []
    page = 1
    while True:
        batch = await service._wc_request(
            "GET", "/products/categories", params={"per_page": 100, "page": page}
        )
        if not isinstance(batch, list) or not batch:
            break
        categories.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return categories


def _print_category_tree(categories: list[dict[str, Any]]) -> None:
    by_parent: dict[int, list[dict[str, Any]]] = {}
    for item in categories:
        by_parent.setdefault(int(item.get("parent") or 0), []).append(item)

    def walk(parent: int, depth: int) -> None:
        for item in sorted(by_parent.get(parent, []), key=lambda entry: str(entry.get("name"))):
            indent = "  " * depth
            print(f"{indent}{item['id']:>6} | {item.get('name')} ({item.get('slug')})")
            walk(int(item["id"]), depth + 1)

    walk(0, 0)


async def _dump_reference_product(service: WooCommerceService, product_id: int) -> None:
    product = await service._wc_request("GET", f"/products/{product_id}")
    _print_header(f"Referans ürün #{product_id}: {product.get('name')}")
    print("categories:", [(c.get("id"), c.get("name")) for c in product.get("categories", [])])
    print("tags:", [(t.get("id"), t.get("name")) for t in product.get("tags", [])])
    print("attributes:")
    for attribute in product.get("attributes", []):
        print(f"  id={attribute.get('id')} name={attribute.get('name')!r} options={attribute.get('options')}")
    print("meta_data key'leri (değer ilk 120 karakter):")
    for meta in product.get("meta_data", []):
        value = str(meta.get("value"))
        print(f"  {meta.get('key')} = {value[:120]}")


async def _test_media_upload(service: WooCommerceService, file_path: Path, keep: bool) -> None:
    _print_header("WP medya test yüklemesi")
    if not service._can_upload_media():
        print("WP app password ayarları eksik — test atlandı.")
        return
    content = file_path.read_bytes()
    content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    media_url = f"{service.wp_base_url}/wp-json/wp/v2/media"
    async with httpx.AsyncClient(timeout=service.timeout) as client:
        response = await client.post(
            media_url,
            auth=(service.wp_app_username, service.wp_app_password),
            headers={
                "Content-Disposition": f'attachment; filename="{file_path.name}"',
                "Content-Type": content_type,
                "User-Agent": "SeroGuldCRM/1.0",
            },
            content=content,
        )
        print(f"POST {media_url} → {response.status_code}")
        if response.status_code >= 400:
            print("Yanıt:", response.text[:400])
            return
        media_id = response.json().get("id")
        print(f"media id: {media_id} (mime: {content_type})")
        if keep or not media_id:
            return
        delete = await client.delete(
            f"{media_url}/{media_id}",
            params={"force": "true"},
            auth=(service.wp_app_username, service.wp_app_password),
        )
        print(f"DELETE media/{media_id} → {delete.status_code} (test dosyası temizlendi)")


async def _run(args: argparse.Namespace) -> None:
    service = WooCommerceService()

    _print_header("Kategori ağacı")
    categories = await _fetch_all_categories(service)
    _print_category_tree(categories)

    if args.product_id:
        await _dump_reference_product(service, args.product_id)

    if args.test_upload:
        await _test_media_upload(service, Path(args.test_upload), keep=args.keep_test_media)

    _print_header("Settings > WooCommerce Eşlemeleri taslakları")
    draft = build_category_map_draft(categories)
    print("Kategori haritası (kontrol edip yapıştırın):")
    print(json.dumps(draft, ensure_ascii=False, indent=2) if draft else "{}  # isim sezgisi eşleşmedi — ağaçtan elle doldurun")
    print()
    print("StoneX meta haritası şablonu (key'leri yukarıdaki meta_data dökümünden alın):")
    print(json.dumps(
        {"metal_type": "<wp_meta_key>", "metal_weight": "<wp_meta_key>", "metal_purity": "<wp_meta_key>"},
        ensure_ascii=False, indent=2,
    ))
    print()
    print("Badge meta şablonu:")
    print(json.dumps(
        {"entries": [
            {"key": "<badge_meta_key>", "value": "Ny vare"},
            {"key": "<schedule_end_meta_key>", "value_kind": "publish_date_plus_days", "days": 30, "format": "iso_date"},
        ]},
        ensure_ascii=False, indent=2,
    ))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--product-id", type=int, default=None, help="Referans Woo ürün id (ör. 37844)")
    parser.add_argument("--test-upload", type=str, default=None, help="WP medya kanalını test etmek için yerel görsel yolu (siteye yazar, sonra siler)")
    parser.add_argument("--keep-test-media", action="store_true", help="Test medyasını silme")
    args = parser.parse_args()
    asyncio.run(_run(args))


if __name__ == "__main__":
    main()
