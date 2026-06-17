#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("SMOKE_BASE_URL", "https://seroguld.193.234.88.63.sslip.io").rstrip("/")
TIMEOUT = float(os.environ.get("SMOKE_TIMEOUT", "20"))


@dataclass
class Check:
    name: str
    ok: bool
    detail: str


checks: list[Check] = []
token: str | None = None
workspace_id: str | None = None


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def record(name: str, ok: bool, detail: str) -> None:
    checks.append(Check(name=name, ok=ok, detail=detail))
    print(f"{'PASS' if ok else 'FAIL'} {name}: {detail}")


def request(
    method: str,
    path: str,
    *,
    data: dict[str, Any] | None = None,
    auth: bool = False,
    expect: int | tuple[int, ...] = 200,
) -> tuple[int, bytes, dict[str, str]]:
    expected = (expect,) if isinstance(expect, int) else expect
    body = None if data is None else json.dumps(data).encode("utf-8")
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if auth:
        if not token:
            raise RuntimeError("auth token missing")
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{BASE_URL}{path}", data=body, headers=headers, method=method)
    context = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=context) as response:
            payload = response.read()
            status = int(response.status)
            response_headers = dict(response.headers)
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        status = int(exc.code)
        response_headers = dict(exc.headers)
    if status not in expected:
        preview = payload[:500].decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} returned {status}, expected {expected}: {preview}")
    return status, payload, response_headers


def path_from_base_url(url: str) -> str:
    if not url.startswith(BASE_URL):
        raise RuntimeError(f"url is outside smoke base: {url}")
    parsed = urllib.parse.urlparse(url)
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    return path


def json_request(method: str, path: str, **kwargs: Any) -> Any:
    _, payload, _ = request(method, path, **kwargs)
    if not payload:
        return None
    return json.loads(payload.decode("utf-8"))


def main() -> int:
    global token, workspace_id
    load_env(ROOT / ".env")

    request("GET", "/health")
    record("public-health", True, "/health 200")

    _, html, _ = request("GET", "/", expect=200)
    record("frontend-shell", b'id="root"' in html or b"/assets/" in html, "index html served")

    _, onlyoffice_health, _ = request("GET", "/healthcheck", expect=200)
    record("onlyoffice-public-health", onlyoffice_health.strip() == b"true", "/healthcheck true")

    login_email = os.environ.get("INITIAL_ADMIN_EMAIL", "")
    login_password = os.environ.get("INITIAL_ADMIN_PASSWORD", "")
    login = json_request("POST", "/api/auth/login", data={"email": login_email, "password": login_password})
    token = str(login["access_token"])
    record("auth-login", login.get("user", {}).get("email") == login_email, f"admin={login.get('user', {}).get('email')}")

    me = json_request("GET", "/api/auth/me", auth=True)
    record("auth-me", me.get("role") == "admin", f"role={me.get('role')}")

    bootstrap = json_request("GET", "/api/v2/bootstrap", auth=True)
    record("bootstrap", bool(bootstrap), "v2 bootstrap returned")

    dashboard = json_request("GET", "/api/v2/dashboard", auth=True)
    record("dashboard-customer-reset", int(dashboard.get("musteriSayisi", -1)) == 0, f"musteriSayisi={dashboard.get('musteriSayisi')}")

    customers = json_request("GET", "/api/v2/musteriler?page=1&page_size=5", auth=True)
    customer_total = customers.get("total", customers.get("pagination", {}).get("total", 0))
    record("customers-zero", int(customer_total or 0) == 0, f"total={customer_total}")

    alis_list = json_request("GET", "/api/v2/alis/list?limit=5", auth=True)
    record("alis-list-zero", isinstance(alis_list, list) and len(alis_list) == 0, f"items={len(alis_list) if isinstance(alis_list, list) else 'n/a'}")

    workspace = json_request("POST", "/api/v2/alis/workspace", auth=True, data={"force_new_session": True, "payment_method": "bank"})
    workspace_id = str(workspace.get("session", {}).get("id") or "")
    display_token = str(workspace.get("session", {}).get("display_token") or "")
    payment_method = str(workspace.get("payment_method") or workspace.get("customer", {}).get("payment_method") or "bank")
    record("alis-open-bank-only", bool(workspace_id) and payment_method == "bank", f"session={workspace_id[:8]} payment={payment_method}")

    display = json_request("GET", f"/api/v2/display/{display_token}", auth=False)
    display_ok = bool(display.get("session") or display.get("lines") is not None)
    record("customer-display-api", display_ok, f"display_token={display_token[:8]}")

    office = json_request("GET", "/api/v2/office-runtime/status?kind=alis-workspace", auth=True)
    record(
        "office-runtime",
        office.get("provider") == "onlyoffice" and bool(office.get("runtime_available")),
        f"provider={office.get('provider')} available={office.get('runtime_available')} reason={office.get('reason')}",
    )

    launch = json_request("GET", f"/api/v2/office-documents/alis-workspace/{workspace_id}/launch", auth=True)
    onlyoffice_api_js_url = str(launch.get("onlyoffice_api_js_url") or "")
    onlyoffice_config = launch.get("onlyoffice_config") if isinstance(launch.get("onlyoffice_config"), dict) else {}
    document_config = onlyoffice_config.get("document") if isinstance(onlyoffice_config.get("document"), dict) else {}
    editor_config = onlyoffice_config.get("editorConfig") if isinstance(onlyoffice_config.get("editorConfig"), dict) else {}
    onlyoffice_download_url = str(document_config.get("url") or "")
    onlyoffice_callback_url = str(editor_config.get("callbackUrl") or "")
    record(
        "office-launch",
        bool(launch.get("office_available"))
        and launch.get("launch_mode") == "onlyoffice-docs-api"
        and onlyoffice_api_js_url.startswith(BASE_URL),
        f"available={launch.get('office_available')} launch_mode={launch.get('launch_mode')}",
    )
    _, api_js, _ = request("GET", path_from_base_url(onlyoffice_api_js_url), expect=200)
    record("onlyoffice-api-js", b"DocsAPI" in api_js and len(api_js) > 1000, f"bytes={len(api_js)}")
    record(
        "onlyoffice-public-config-urls",
        onlyoffice_download_url.startswith(BASE_URL) and onlyoffice_callback_url.startswith(BASE_URL),
        f"download_public={onlyoffice_download_url.startswith(BASE_URL)} callback_public={onlyoffice_callback_url.startswith(BASE_URL)}",
    )
    _, workbook_bytes, workbook_headers = request("GET", path_from_base_url(onlyoffice_download_url), expect=200)
    workbook_type = workbook_headers.get("Content-Type", "")
    record(
        "onlyoffice-download",
        len(workbook_bytes) > 1000 and (
            "spreadsheet" in workbook_type
            or "officedocument" in workbook_type
            or workbook_bytes[:2] == b"PK"
        ),
        f"bytes={len(workbook_bytes)} content_type={workbook_type}",
    )

    inventory = json_request("GET", "/api/v2/depolama/workspace", auth=True)
    record("inventory-workspace", "products" in inventory or "summary" in inventory, "inventory workspace returned")

    woo = json_request("GET", "/api/v2/woocommerce/workspace", auth=True)
    record("woocommerce-workspace", "summary" in woo and "rows" in woo, f"rows={len(woo.get('rows', []))}")

    gdpr = json_request("GET", "/api/v2/gdpr/retention-policies", auth=True)
    policy = next((item for item in gdpr if item.get("policy_key") == "customer_master"), None)
    record("gdpr-customer-master-5y", bool(policy) and int(policy.get("retention_days", 0)) == 1825, f"retention_days={policy.get('retention_days') if policy else 'missing'}")

    readiness = json_request("GET", "/api/v2/runtime/readiness", auth=True, expect=(200, 503))
    record("runtime-readiness-response", "checks" in readiness, f"ready={readiness.get('ready')}")
    for item in readiness.get("checks", []):
        if not item.get("ok"):
            print(f"READINESS_FAIL {item.get('name')}: {item.get('detail')}")

    if workspace_id:
        request("POST", f"/api/v2/alis/workspace/{workspace_id}/cancel", auth=True, data={}, expect=(200, 204))
        record("alis-smoke-cleanup", True, f"cancelled={workspace_id[:8]}")

    failed = [check for check in checks if not check.ok]
    print(f"SUMMARY passed={len(checks) - len(failed)} failed={len(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
