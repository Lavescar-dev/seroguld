#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("SMOKE_BASE_URL", "https://seroguld.193.234.88.63.sslip.io").rstrip("/")
TIMEOUT = 20
token: str | None = None
failures = 0


def load_env(path: Path) -> None:
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def request(method: str, path: str, *, data: dict[str, Any] | None = None, auth: bool = False) -> Any:
    body = None if data is None else json.dumps(data).encode("utf-8")
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if auth:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{BASE_URL}{path}", data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=ssl.create_default_context()) as response:
        payload = response.read()
    if not payload:
        return None
    try:
        return json.loads(payload.decode("utf-8"))
    except json.JSONDecodeError:
        return payload.decode("utf-8", errors="replace")


def check(name: str, ok: bool, detail: str) -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'} {name}: {detail}")


def main() -> int:
    global token
    load_env(ROOT / ".env")
    health = request("GET", "/health")
    check("health", health.get("status") == "ok", str(health))

    login = request("POST", "/api/auth/login", data={"email": os.environ["INITIAL_ADMIN_EMAIL"], "password": os.environ["INITIAL_ADMIN_PASSWORD"]})
    token = login["access_token"]
    check("auth", login.get("user", {}).get("email") == "info@seroguld.dk", login.get("user", {}).get("email", "missing"))

    customers = request("GET", "/api/v2/musteriler?page=1&page_size=5", auth=True)
    check("customers-zero", int(customers.get("total", 0)) == 0, f"total={customers.get('total')}")

    alis = request("GET", "/api/v2/alis/list?limit=5", auth=True)
    check("alis-list-zero", isinstance(alis, list) and len(alis) == 0, f"items={len(alis) if isinstance(alis, list) else 'n/a'}")

    office = request("GET", "/api/v2/office-runtime/status?kind=alis-workspace", auth=True)
    check("office", office.get("runtime_available") is True and office.get("provider") == "onlyoffice", f"{office.get('provider')} available={office.get('runtime_available')}")

    woo = request("GET", "/api/v2/woocommerce/workspace", auth=True)
    check("woocommerce", "summary" in woo and "rows" in woo, f"rows={len(woo.get('rows', []))}")

    readiness = request("GET", "/api/v2/runtime/readiness", auth=True)
    check("readiness", readiness.get("ready") is True, f"ready={readiness.get('ready')}")

    print(f"SUMMARY failed={failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
