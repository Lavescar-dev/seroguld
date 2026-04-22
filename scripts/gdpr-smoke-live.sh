#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
BASE_URL="${GDPR_SMOKE_BASE_URL:-${BASE_URL:-http://127.0.0.1:8100}}"

if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  echo "[gdpr-smoke-live] .env bulunamadı." >&2
  exit 1
fi

if [[ ! -x "${BACKEND_DIR}/.venv/bin/python" ]]; then
  echo "[gdpr-smoke-live] backend/.venv bulunamadı. Önce 'make setup' çalıştırın." >&2
  exit 1
fi

if [[ "${GDPR_SMOKE_SKIP_WARNING:-0}" != "1" ]]; then
  echo "[gdpr-smoke-live] UYARI: bu komut canlı backend üzerinde customer/request mutate eder."
fi

read_env_value() {
  local key="$1"
  python3 - "$ROOT_DIR/.env" "$key" <<'PY'
import sys
from pathlib import Path

env_path = Path(sys.argv[1])
target_key = sys.argv[2]

for raw in env_path.read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.strip() == target_key:
        print(value.strip())
        break
PY
}

INITIAL_ADMIN_EMAIL="${INITIAL_ADMIN_EMAIL:-$(read_env_value INITIAL_ADMIN_EMAIL)}"
INITIAL_ADMIN_PASSWORD="${INITIAL_ADMIN_PASSWORD:-$(read_env_value INITIAL_ADMIN_PASSWORD)}"
export INITIAL_ADMIN_EMAIL INITIAL_ADMIN_PASSWORD BASE_URL

"${BACKEND_DIR}/.venv/bin/python" - <<'PY'
from __future__ import annotations

import io
import os
import uuid
import zipfile

import httpx


BASE_URL = os.environ["BASE_URL"].rstrip("/")
ADMIN_EMAIL = os.getenv("INITIAL_ADMIN_EMAIL", "admin@seroguld.dk")
ADMIN_PASSWORD = os.getenv("INITIAL_ADMIN_PASSWORD", "Admin123!")


def assert_status(response: httpx.Response, expected: int | tuple[int, ...], label: str) -> None:
    expected_codes = (expected,) if isinstance(expected, int) else expected
    if response.status_code not in expected_codes:
        raise RuntimeError(f"{label} failed ({response.status_code}): {response.text[:500]}")


def find_request_id(items: list[dict], reference_number: str) -> str:
    for item in items:
        if item.get("reference_number") == reference_number:
            return str(item["id"])
    raise RuntimeError(f"request not found: {reference_number}")


with httpx.Client(timeout=90.0) as client:
    login_resp = client.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert_status(login_resp, 200, "login")
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    bridge_resp = client.get(f"{BASE_URL}/api/v2/public/gdpr/bridge-config")
    assert_status(bridge_resp, 200, "bridge-config")
    bridge_payload = bridge_resp.json()
    if not bridge_payload.get("privacy_policy_url") or not bridge_payload.get("cookie_config_url"):
        raise RuntimeError("bridge-config eksik alan döndü")

    customer_payload = {
        "name": f"GDPR Smoke {uuid.uuid4().hex[:6].upper()}",
        "email": f"gdpr-smoke-{uuid.uuid4().hex[:8]}@example.com",
        "phone": "+45 20202020",
        "address": "Valby Langgade 84",
        "postal_code": "2500",
        "password": "SmokePass123!",
    }
    create_customer_resp = client.post(f"{BASE_URL}/api/customers", headers=headers, json=customer_payload)
    assert_status(create_customer_resp, 201, "create-customer")
    customer = create_customer_resp.json()

    export_public_resp = client.post(
        f"{BASE_URL}/api/v2/public/gdpr/request",
        json={
            "request_type": "access_export",
            "subject_name": customer["name"],
            "subject_email": customer["email"],
            "subject_phone": customer["phone"],
            "message": "Smoke export request",
            "accepted_privacy": True,
        },
    )
    assert_status(export_public_resp, 200, "public-export-request")
    export_request = export_public_resp.json()

    export_status_resp = client.get(f"{BASE_URL}/api/v2/public/gdpr/request/{export_request['tracking_token']}")
    assert_status(export_status_resp, 200, "public-export-status")

    requests_resp = client.get(f"{BASE_URL}/api/v2/gdpr/requests", headers=headers)
    assert_status(requests_resp, 200, "gdpr-requests")
    export_request_id = find_request_id(requests_resp.json(), export_request["reference_number"])

    verify_export_resp = client.post(
        f"{BASE_URL}/api/v2/gdpr/requests/{export_request_id}/verify",
        headers=headers,
        json={"customer_id": customer["id"]},
    )
    assert_status(verify_export_resp, 200, "verify-export")
    approve_export_resp = client.post(
        f"{BASE_URL}/api/v2/gdpr/requests/{export_request_id}/approve",
        headers=headers,
        json={"reason": "Smoke approve export"},
    )
    assert_status(approve_export_resp, 200, "approve-export")
    enqueue_export_resp = client.post(
        f"{BASE_URL}/api/v2/gdpr/requests/{export_request_id}/enqueue",
        headers=headers,
    )
    assert_status(enqueue_export_resp, 200, "enqueue-export")
    execute_export_resp = client.post(
        f"{BASE_URL}/api/v2/gdpr/requests/{export_request_id}/execute",
        headers=headers,
    )
    assert_status(execute_export_resp, 200, "execute-export")
    export_detail = execute_export_resp.json()
    if not export_detail.get("export_download_path"):
        raise RuntimeError("export download path missing")

    export_download_resp = client.get(f"{BASE_URL}{export_detail['export_download_path']}", headers=headers)
    assert_status(export_download_resp, 200, "download-export")
    with zipfile.ZipFile(io.BytesIO(export_download_resp.content)) as archive:
        expected_names = {"subject.json", "customer.csv", "transactions.csv", "documents_manifest.csv", "processor_actions.json"}
        if not expected_names.issubset(set(archive.namelist())):
            raise RuntimeError("export archive expected files missing")

    erase_public_resp = client.post(
        f"{BASE_URL}/api/v2/public/gdpr/request",
        json={
            "request_type": "erasure_pseudonymize",
            "subject_name": customer["name"],
            "subject_email": customer["email"],
            "subject_phone": customer["phone"],
            "message": "Smoke pseudonymize request",
            "accepted_privacy": True,
        },
    )
    assert_status(erase_public_resp, 200, "public-erase-request")
    erase_request = erase_public_resp.json()

    requests_resp = client.get(f"{BASE_URL}/api/v2/gdpr/requests", headers=headers)
    assert_status(requests_resp, 200, "gdpr-requests-after-erase")
    erase_request_id = find_request_id(requests_resp.json(), erase_request["reference_number"])

    verify_erase_resp = client.post(
        f"{BASE_URL}/api/v2/gdpr/requests/{erase_request_id}/verify",
        headers=headers,
        json={"customer_id": customer["id"]},
    )
    assert_status(verify_erase_resp, 200, "verify-erase")
    approve_erase_resp = client.post(
        f"{BASE_URL}/api/v2/gdpr/requests/{erase_request_id}/approve",
        headers=headers,
        json={"reason": "Smoke approve pseudonymize"},
    )
    assert_status(approve_erase_resp, 200, "approve-erase")
    execute_erase_resp = client.post(
        f"{BASE_URL}/api/v2/gdpr/requests/{erase_request_id}/execute",
        headers=headers,
    )
    assert_status(execute_erase_resp, 200, "execute-erase")
    erase_detail = execute_erase_resp.json()
    if erase_detail["status"] not in {"completed", "completed_with_warnings"}:
        raise RuntimeError("erase request not completed")

    customer_detail_resp = client.get(f"{BASE_URL}/api/customers/{customer['id']}", headers=headers)
    assert_status(customer_detail_resp, 200, "customer-detail")
    customer_detail = customer_detail_resp.json()
    if customer_detail.get("gdpr_status") != "pseudonymized":
        raise RuntimeError("customer was not pseudonymized")

    jobs_resp = client.get(f"{BASE_URL}/api/v2/gdpr/jobs", headers=headers)
    assert_status(jobs_resp, 200, "gdpr-jobs")
    overview_resp = client.get(f"{BASE_URL}/api/v2/gdpr/overview", headers=headers)
    assert_status(overview_resp, 200, "gdpr-overview")

print("[gdpr-smoke-live] GDPR smoke başarılı.")
PY
