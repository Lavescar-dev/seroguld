#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from typing import Any
from urllib import error, request


def http_request(
    base_url: str,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    token: str | None = None,
    timeout: float = 12.0,
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
        detail: Any = raw
        try:
            parsed = json.loads(raw) if raw else {}
            if isinstance(parsed, dict):
                detail = parsed.get("detail", parsed)
            else:
                detail = parsed
        except Exception:
            pass
        raise RuntimeError(f"{method} {path} -> {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"{method} {path} -> ağ hatası: {exc.reason}") from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sero Guld CRM MVP demo smoke check")
    parser.add_argument("--base-url", default="http://127.0.0.1:8100", help="Backend base URL")
    parser.add_argument("--email", default="admin@seroguld.dk", help="Admin email")
    parser.add_argument("--password", default="Admin123!", help="Admin password")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    base_url = args.base_url.rstrip("/")

    print(f"[demo-check] backend: {base_url}")

    _, login = http_request(
        base_url,
        "POST",
        "/api/auth/login",
        payload={"email": args.email, "password": args.password},
    )
    token = login.get("access_token")
    if not token:
        raise RuntimeError("Login başarılı ama access_token yok.")
    print("[demo-check] login: OK")

    for endpoint in (
        "/api/dashboard/summary",
        "/api/dashboard/stock-value",
        "/api/dashboard/calendar",
        "/api/dashboard/profit",
    ):
        http_request(base_url, "GET", endpoint, token=token)
    print("[demo-check] dashboard endpointleri: OK")

    _, customers = http_request(base_url, "GET", "/api/customers?page=1&page_size=1", token=token)
    items = customers.get("items", []) if isinstance(customers, dict) else []
    if not items:
        raise RuntimeError(
            "Müşteri verisi yok. Önce `make demo-seed` çalıştırın."
        )
    customer_id = items[0]["id"]
    print("[demo-check] müşteri listesi: OK")

    _, pos_session = http_request(
        base_url,
        "POST",
        "/api/pos/sessions",
        payload={"trade_side": "buy_from_customer", "customer_id": customer_id},
        token=token,
    )
    session_id = pos_session["id"]
    display_token = pos_session["display_token"]
    print("[demo-check] pos session açma: OK")

    http_request(
        base_url,
        "PATCH",
        f"/api/pos/sessions/{session_id}/quote",
        payload={
            "product_type": "bracelet",
            "metal_type": "yellow_gold",
            "weight_grams": 24.5,
            "purity_karat": "18K",
            "purity_percentage": 75,
            "margin_percent_internal": 8,
        },
        token=token,
    )
    http_request(base_url, "POST", f"/api/pos/sessions/{session_id}/rate/sync", payload={}, token=token)
    print("[demo-check] pos teklif + kur: OK")

    _, display = http_request(base_url, "GET", f"/api/pos/display/{display_token}")
    if not isinstance(display, dict):
        raise RuntimeError("Display snapshot beklenmeyen format.")
    print(
        "[demo-check] display snapshot: OK | "
        f"müşteri={display.get('customer_name') or '-'} | "
        f"teklif={display.get('final_offer_dkk') or '-'} DKK"
    )

    print("[demo-check] MVP demo akışı başarılı.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n[demo-check] iptal edildi.")
        raise SystemExit(130)
    except Exception as exc:
        print(f"[demo-check] hata: {exc}", file=sys.stderr)
        raise SystemExit(1)
