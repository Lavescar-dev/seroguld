#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import random
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from urllib import error, request


BASE_CANDIDATES = [
    "http://127.0.0.1:8100",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:3300",
    "http://127.0.0.1:3000",
]

PRODUCT_TYPES = ["bracelet", "ring", "necklace", "earring", "chain", "bar", "jewelry"]
METALS = ["yellow_gold", "white_gold", "silver", "platinum", "palladium"]
IDENTITY_DOCS = ["passport", "id_card", "driver_license"]
STORAGE_LOCATIONS = ["Kasa-A1", "Kasa-A2", "Tezgah-1", "Depo-Beyaz", "Depo-Ayirma"]


@dataclass
class LoginResult:
    ok: bool
    reachable: bool
    status: int | None
    token: str | None = None
    detail: str | None = None


def quantize_2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def http_request(
    base_url: str,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    token: str | None = None,
    timeout: float = 15.0,
) -> tuple[int, Any]:
    url = f"{base_url.rstrip('/')}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if payload is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")

    try:
        with request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            parsed = json.loads(raw) if raw else {}
            return resp.status, parsed
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8") if exc.fp else ""
        parsed: Any = None
        if raw:
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = raw
        detail = parsed.get("detail") if isinstance(parsed, dict) else parsed
        raise RuntimeError(f"{method} {path} -> {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"{method} {path} -> ağ hatası: {exc.reason}") from exc


def try_login(base_url: str, email: str, password: str) -> LoginResult:
    url = f"{base_url.rstrip('/')}/api/auth/login"
    data = json.dumps({"email": email, "password": password}).encode("utf-8")
    req = request.Request(url, data=data, method="POST")
    req.add_header("Accept", "application/json")
    req.add_header("Content-Type", "application/json")
    try:
        with request.urlopen(req, timeout=6.0) as resp:
            raw = resp.read().decode("utf-8")
            payload = json.loads(raw) if raw else {}
            token = payload.get("access_token")
            if resp.status == 200 and token:
                return LoginResult(ok=True, reachable=True, status=200, token=token)
            return LoginResult(ok=False, reachable=True, status=resp.status, detail="Beklenmeyen login yanıtı")
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8") if exc.fp else ""
        detail = None
        if raw:
            try:
                body = json.loads(raw)
                detail = body.get("detail")
            except Exception:
                detail = raw
        return LoginResult(ok=False, reachable=True, status=exc.code, detail=str(detail or "HTTP error"))
    except error.URLError:
        return LoginResult(ok=False, reachable=False, status=None, detail="erişim yok")


def resolve_base_and_token(base: str | None, email: str, password: str) -> tuple[str, str]:
    if base:
        login = try_login(base, email, password)
        if login.ok and login.token:
            return base.rstrip("/"), login.token
        if login.reachable:
            raise SystemExit(
                f"Sunucu bulundu ama login başarısız ({login.status}): {login.detail}. "
                "Admin email/şifreyi kontrol edin."
            )
        raise SystemExit(f"Belirtilen base URL erişilemedi: {base}")

    for candidate in BASE_CANDIDATES:
        login = try_login(candidate, email, password)
        if login.ok and login.token:
            return candidate.rstrip("/"), login.token
        if login.reachable and login.status == 401:
            raise SystemExit(
                f"Sunucu bulundu ({candidate}) ama login başarısız (401). "
                "Admin email/şifreyi kontrol edin."
            )

    raise SystemExit(
        "Çalışan API bulunamadı. Önce backend'i açın "
        "(desktop için `make desktop-dev`, docker için `docker compose up -d`)."
    )


def choose_metal_profile(rng: random.Random, metal: str) -> tuple[Decimal, Decimal, str]:
    if metal in {"yellow_gold", "white_gold"}:
        options = [
            (Decimal("58.5"), "14K"),
            (Decimal("75.0"), "18K"),
            (Decimal("91.6"), "22K"),
            (Decimal("99.9"), "24K"),
        ]
        purity, karat = rng.choice(options)
        rate = Decimal("615.5") if metal == "yellow_gold" else Decimal("618.0")
        return purity, rate, karat
    if metal == "silver":
        options = [
            (Decimal("80.0"), "800"),
            (Decimal("92.5"), "925"),
            (Decimal("99.9"), "999"),
        ]
        purity, karat = rng.choice(options)
        return purity, Decimal("7.8"), karat
    if metal == "platinum":
        return Decimal("95.0"), Decimal("250.0"), "950"
    return Decimal("95.0"), Decimal("320.0"), "950"


def build_customer_payload(index: int, seed_tag: str, rng: random.Random) -> dict[str, Any]:
    suffix = f"{seed_tag}-{index:03d}"
    cpr_digits = f"{rng.randint(1, 28):02d}{rng.randint(1, 12):02d}{rng.randint(60, 99):02d}{rng.randint(1000, 9999)}"
    return {
        "name": f"Mock Musteri {suffix}",
        "email": f"mock.customer.{suffix}@seroguld.dk",
        "phone": f"+45 2{rng.randint(1000000, 9999999)}",
        "address": f"Mock Caddesi {index}, Kobenhavn",
        "cpr_number": cpr_digits,
        "identity_doc_type": rng.choice(IDENTITY_DOCS),
        "identity_doc_number": f"ID-{rng.randint(100000, 999999)}",
        "identity_doc_country": "DK",
        "identity_photo_refs": [],
        "password": "Mock12345!",
    }


def build_product_payload(
    index: int,
    seller_customer_id: str,
    rng: random.Random,
) -> dict[str, Any]:
    metal = rng.choice(METALS)
    product_type = rng.choice(PRODUCT_TYPES)
    purity, rate, karat = choose_metal_profile(rng, metal)
    weight = quantize_2(Decimal(str(rng.uniform(2.0, 75.0))))
    commission = quantize_2(Decimal(str(rng.uniform(4.0, 12.0))))
    pure_grams = weight * (purity / Decimal("100"))
    offer = quantize_2(pure_grams * rate * (Decimal("1") - (commission / Decimal("100"))))

    # Karışık dağılım: yaklaşık %60 kilit açık, %40 kilitli
    is_unlock_candidate = rng.random() < 0.6
    if is_unlock_candidate:
        days_ago = rng.randint(16, 45)
    else:
        days_ago = rng.randint(0, 10)

    purchase_date = datetime.now(timezone.utc) - timedelta(days=days_ago, hours=rng.randint(0, 23))
    purchase_iso = purchase_date.isoformat().replace("+00:00", "Z")

    return {
        "reference_number": str(9600 + index),
        "product_type": product_type,
        "metal_type": metal,
        "weight_grams": str(weight),
        "purity_karat": karat,
        "purity_percentage": str(purity),
        "purchase_date": purchase_iso,
        "purchase_price_dkk": str(max(offer, Decimal("150.00"))),
        "gold_rate_at_purchase": str(rate),
        "commission": str(commission),
        "seller_customer_id": seller_customer_id,
        "notes": f"Mock seed urunu #{index}",
        "storage_location": rng.choice(STORAGE_LOCATIONS),
        "needs_cleaning": (index % 3 == 0),
        "photos": [],
    }


def apply_status_mix(
    base_url: str,
    token: str,
    product: dict[str, Any],
    customer_ids: list[str],
    index: int,
    rng: random.Random,
) -> str:
    product_id = product["id"]
    if product.get("is_gdpr_locked"):
        return "locked"

    mode = index % 4
    if mode == 0:
        http_request(base_url, "PATCH", f"/api/products/{product_id}/status", {"status": "for_sale"}, token)
        return "for_sale"
    if mode == 1:
        http_request(base_url, "PATCH", f"/api/products/{product_id}/status", {"status": "undecided"}, token)
        return "undecided"
    if mode == 2:
        http_request(
            base_url,
            "PATCH",
            f"/api/products/{product_id}/status",
            {"status": "melted", "melt_reason": "Mock eritme testi"},
            token,
        )
        return "melted"

    # sold
    http_request(base_url, "PATCH", f"/api/products/{product_id}/status", {"status": "for_sale"}, token)
    purchase_price = Decimal(str(product.get("purchase_price_dkk") or "0"))
    sale_price = quantize_2(purchase_price * Decimal("1.18"))
    buyer_id = rng.choice(customer_ids) if customer_ids else None
    payload: dict[str, Any] = {"status": "sold", "sale_price_dkk": str(max(sale_price, Decimal("200.00")))}
    if buyer_id:
        payload["buyer_customer_id"] = buyer_id
    http_request(base_url, "PATCH", f"/api/products/{product_id}/status", payload, token)
    return "sold"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sero Guld CRM mock veri uretici")
    parser.add_argument("--base-url", default=None, help="API base URL (ornek: http://127.0.0.1:8100)")
    parser.add_argument("--email", default="admin@seroguld.dk", help="Admin email")
    parser.add_argument("--password", default="Admin123!", help="Admin sifre")
    parser.add_argument("--customers", type=int, default=20, help="Eklenecek musteri adedi")
    parser.add_argument("--products", type=int, default=20, help="Eklenecek urun adedi")
    parser.add_argument("--seed", type=int, default=20260226, help="Rastgelelik seed degeri")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    rng = random.Random(args.seed)
    seed_tag = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

    base_url, token = resolve_base_and_token(args.base_url, args.email, args.password)
    print(f"[seed] API bulundu: {base_url}")

    created_customer_ids: list[str] = []
    created_products: list[dict[str, Any]] = []
    status_counts: dict[str, int] = {}

    # customers
    for idx in range(1, args.customers + 1):
        payload = build_customer_payload(idx, seed_tag, rng)
        _, customer = http_request(base_url, "POST", "/api/customers", payload, token)
        created_customer_ids.append(customer["id"])

    # products
    sellers_pool = created_customer_ids[:] or []
    if not sellers_pool:
        raise SystemExit("Urun icin seller havuzu bos kaldi.")

    for idx in range(1, args.products + 1):
        seller_id = rng.choice(sellers_pool)
        payload = build_product_payload(idx, seller_id, rng)
        _, product = http_request(base_url, "POST", "/api/products", payload, token)
        created_products.append(product)
        status_label = apply_status_mix(base_url, token, product, created_customer_ids, idx, rng)
        status_counts[status_label] = status_counts.get(status_label, 0) + 1

    print(
        "[seed] Tamamlandi | "
        f"musteri={len(created_customer_ids)} | urun={len(created_products)} | "
        f"status_dagilimi={status_counts}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n[seed] Islem iptal edildi.")
        raise SystemExit(130)
