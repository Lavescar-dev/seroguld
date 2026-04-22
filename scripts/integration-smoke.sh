#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
DATA_DIR="${ROOT_DIR}/data"

BACKEND_HOST="${SMOKE_BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${SMOKE_BACKEND_PORT:-8110}"
BACKEND_URL="http://${BACKEND_HOST}:${BACKEND_PORT}"
SMOKE_DB_PATH="${DATA_DIR}/integration-smoke.db"
SMOKE_DB_URL="sqlite+aiosqlite:///${SMOKE_DB_PATH}"
BACKEND_LOG="${ROOT_DIR}/.run/integration-smoke-backend.log"

if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  echo "[integration-smoke] .env bulunamadı. Önce .env dosyasını oluşturun." >&2
  exit 1
fi

if [[ ! -x "${BACKEND_DIR}/.venv/bin/python" ]]; then
  echo "[integration-smoke] backend/.venv bulunamadı. Önce 'make setup' çalıştırın." >&2
  exit 1
fi

mkdir -p "${ROOT_DIR}/.run" "${DATA_DIR}"

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

OPENAI_API_KEY="$(read_env_value OPENAI_API_KEY)"
OPENAI_BASE_URL="$(read_env_value OPENAI_BASE_URL)"
OPENAI_MODEL="$(read_env_value OPENAI_MODEL)"
OPENAI_TIMEOUT_SECONDS="$(read_env_value OPENAI_TIMEOUT_SECONDS)"
WOOCOMMERCE_BASE_URL="$(read_env_value WOOCOMMERCE_BASE_URL)"
WOOCOMMERCE_CONSUMER_KEY="$(read_env_value WOOCOMMERCE_CONSUMER_KEY)"
WOOCOMMERCE_CONSUMER_SECRET="$(read_env_value WOOCOMMERCE_CONSUMER_SECRET)"
WOOCOMMERCE_TIMEOUT_SECONDS="$(read_env_value WOOCOMMERCE_TIMEOUT_SECONDS)"
WORDPRESS_BASE_URL="$(read_env_value WORDPRESS_BASE_URL)"
WP_APP_USERNAME="$(read_env_value WP_APP_USERNAME)"
WP_APP_PASSWORD="$(read_env_value WP_APP_PASSWORD)"
INITIAL_ADMIN_EMAIL="$(read_env_value INITIAL_ADMIN_EMAIL)"
INITIAL_ADMIN_PASSWORD="$(read_env_value INITIAL_ADMIN_PASSWORD)"
INITIAL_ADMIN_NAME="$(read_env_value INITIAL_ADMIN_NAME)"

export OPENAI_API_KEY OPENAI_BASE_URL OPENAI_MODEL OPENAI_TIMEOUT_SECONDS
export WOOCOMMERCE_BASE_URL WOOCOMMERCE_CONSUMER_KEY WOOCOMMERCE_CONSUMER_SECRET WOOCOMMERCE_TIMEOUT_SECONDS
export WORDPRESS_BASE_URL WP_APP_USERNAME WP_APP_PASSWORD
export INITIAL_ADMIN_EMAIL INITIAL_ADMIN_PASSWORD INITIAL_ADMIN_NAME

required_vars=(
  OPENAI_API_KEY
  WOOCOMMERCE_BASE_URL
  WOOCOMMERCE_CONSUMER_KEY
  WOOCOMMERCE_CONSUMER_SECRET
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "[integration-smoke] Eksik ayar: ${var_name}" >&2
    exit 1
  fi
done

if [[ -n "${WP_APP_USERNAME:-}" && -z "${WP_APP_PASSWORD:-}" ]]; then
  echo "[integration-smoke] WP_APP_USERNAME dolu ama WP_APP_PASSWORD boş." >&2
  exit 1
fi

if [[ -n "${WP_APP_PASSWORD:-}" ]]; then
  WP_APP_PASSWORD="${WP_APP_PASSWORD// /}"
  export WP_APP_PASSWORD
fi

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

rm -f "${SMOKE_DB_PATH}"

echo "[integration-smoke] Backend başlatılıyor: ${BACKEND_URL}"
cd "${BACKEND_DIR}"
env \
  PYTHONPATH="${BACKEND_DIR}" \
  DATABASE_URL="${SMOKE_DB_URL}" \
  CORS_ORIGINS="http://127.0.0.1:3300,http://localhost:3300" \
  APP_URL="http://127.0.0.1:3300" \
  "${BACKEND_DIR}/.venv/bin/python" -m uvicorn app.main:app \
  --host "${BACKEND_HOST}" --port "${BACKEND_PORT}" \
  >"${BACKEND_LOG}" 2>&1 &
BACKEND_PID=$!
echo "${BACKEND_PID}" > "${ROOT_DIR}/.run/integration-smoke-backend.pid"
cd "${ROOT_DIR}"

for i in $(seq 1 90); do
  if curl -fsS "${BACKEND_URL}/health" >/dev/null 2>&1; then
    break
  fi
  if [[ "${i}" -eq 90 ]]; then
    echo "[integration-smoke] Backend health timeout." >&2
    tail -n 120 "${BACKEND_LOG}" >&2 || true
    exit 1
  fi
  sleep 1
done

echo "[integration-smoke] Akış test ediliyor (login -> create -> AI -> approve -> publish -> webhook sold sync)..."
"${BACKEND_DIR}/.venv/bin/python" - <<'PY'
from __future__ import annotations

import os
import base64
import hashlib
import hmac
import uuid
from pathlib import Path

import httpx


BASE_URL = os.getenv("SMOKE_API_URL", "http://127.0.0.1:8110").rstrip("/")
ADMIN_EMAIL = os.getenv("INITIAL_ADMIN_EMAIL", "admin@seroguld.dk")
ADMIN_PASSWORD = os.getenv("INITIAL_ADMIN_PASSWORD", "Admin123!")
WC_BASE_URL = os.getenv("WOOCOMMERCE_BASE_URL", "").rstrip("/")
WC_KEY = os.getenv("WOOCOMMERCE_CONSUMER_KEY", "")
WC_SECRET = os.getenv("WOOCOMMERCE_CONSUMER_SECRET", "")
WEBHOOK_SECRET = os.getenv("WOOCOMMERCE_WEBHOOK_SECRET", "")


def write_tiny_png(path: Path) -> None:
    tiny_png_hex = (
        "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489"
        "0000000A49444154789C6360000000020001E221BC330000000049454E44AE426082"
    )
    path.write_bytes(bytes.fromhex(tiny_png_hex))


def assert_status(resp: httpx.Response, expected: int | tuple[int, ...], label: str) -> None:
    expected_codes = (expected,) if isinstance(expected, int) else expected
    if resp.status_code not in expected_codes:
        snippet = resp.text[:600]
        raise RuntimeError(f"{label} failed ({resp.status_code}): {snippet}")


def main() -> None:
    temp_img = Path("/tmp/seroguld-integration-smoke.png")
    write_tiny_png(temp_img)

    created_wc_product_id: int | None = None

    with httpx.Client(timeout=120.0) as client:
        login_resp = client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        )
        assert_status(login_resp, 200, "login")
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        print("login: ok")

        create_resp = client.post(
            f"{BASE_URL}/api/products",
            headers=headers,
            json={
                "reference_number": f"SMK{uuid.uuid4().hex[:6].upper()}",
                "product_type": "bracelet",
                "metal_type": "yellow_gold",
                "weight_grams": "12.40",
                "purity_karat": "18K",
                "purity_percentage": "75",
                "purchase_date": "2025-01-05T10:00:00Z",
                "purchase_price_dkk": "4200",
                "gold_rate_at_purchase": "610",
                "commission": "8",
                "seller_new": {
                    "name": "Integration Smoke Customer",
                    "email": f"smoke-{uuid.uuid4().hex[:8]}@example.com",
                    "phone": "+45 11 22 33 44",
                    "cpr_number": "120385-1234",
                },
                "notes": "Integration smoke publish test",
                "storage_location": "SMOKE-A1",
                "needs_cleaning": False,
                "photos": [
                    {
                        "url": f"file://{temp_img}",
                        "filename": "integration-smoke.png",
                        "is_primary": True,
                    }
                ],
            },
        )
        assert_status(create_resp, 201, "create product")
        product = create_resp.json()
        product_id = product["id"]
        print(f"create product: ok ({product_id})")

        ai_resp = client.post(f"{BASE_URL}/api/products/{product_id}/ai-describe", headers=headers)
        assert_status(ai_resp, 200, "ai describe")
        ai_product = ai_resp.json()
        ai_description = ai_product.get("ai_description", "")
        if len(ai_description.strip()) < 20:
            raise RuntimeError("ai description too short")
        print("ai describe: ok")

        approve_resp = client.put(
            f"{BASE_URL}/api/products/{product_id}/ai-describe",
            headers=headers,
            json={"ai_description": ai_description, "ai_description_approved": True},
        )
        assert_status(approve_resp, 200, "ai approve")
        print("ai approve: ok")

        publish_resp = client.post(
            f"{BASE_URL}/api/products/{product_id}/publish",
            headers=headers,
            json={
                "regular_price_dkk": "5400",
                "name": f"Integration Smoke Armband {uuid.uuid4().hex[:6].upper()}",
            },
        )
        assert_status(publish_resp, 200, "publish")
        publish_payload = publish_resp.json()
        created_wc_product_id = publish_payload.get("wc_product_id")
        if not created_wc_product_id:
            raise RuntimeError("publish missing wc_product_id")
        print(f"publish: ok (wc_id={created_wc_product_id})")

        webhook_payload = {
            "id": 999001,
            "status": "completed",
            "date_paid": "2026-02-27T12:00:00Z",
            "line_items": [
                {
                    "id": 91,
                    "product_id": created_wc_product_id,
                    "total": "5550.00",
                    "quantity": 1,
                }
            ],
        }
        webhook_headers: dict[str, str] = {"Content-Type": "application/json"}
        webhook_body = httpx.Request("POST", "http://localhost", json=webhook_payload).content
        if WEBHOOK_SECRET:
            signature = base64.b64encode(
                hmac.new(WEBHOOK_SECRET.encode("utf-8"), webhook_body, hashlib.sha256).digest()
            ).decode("utf-8")
            webhook_headers["X-WC-Webhook-Signature"] = signature
            webhook_headers["X-WC-Webhook-Topic"] = "order.updated"
            webhook_headers["X-WC-Webhook-Delivery-ID"] = f"smoke-{uuid.uuid4().hex[:10]}"

        webhook_resp = client.post(
            f"{BASE_URL}/api/webhooks/woocommerce",
            content=webhook_body,
            headers=webhook_headers,
        )
        assert_status(webhook_resp, 200, "woocommerce webhook sold sync")
        webhook_json = webhook_resp.json()
        if int(webhook_json.get("processed", 0)) < 1:
            raise RuntimeError(f"webhook processed count invalid: {webhook_json}")
        print("webhook sold sync: ok")

        sold_check = client.get(f"{BASE_URL}/api/products/{product_id}", headers=headers)
        assert_status(sold_check, 200, "get product after webhook")
        sold_payload = sold_check.json()
        if sold_payload.get("status") != "sold":
            raise RuntimeError(f"product status not sold after webhook: {sold_payload.get('status')}")
        print("product status sold: ok")

    # Clean up remote Woo product to keep production catalog tidy.
    if created_wc_product_id and WC_BASE_URL and WC_KEY and WC_SECRET:
        with httpx.Client(timeout=60.0, auth=(WC_KEY, WC_SECRET)) as wc_client:
            delete_resp = wc_client.delete(
                f"{WC_BASE_URL}/products/{created_wc_product_id}",
                params={"force": "true"},
            )
            assert_status(delete_resp, (200, 202), "woo delete")
            print("woo cleanup delete: ok")

    print("integration smoke: success")


if __name__ == "__main__":
    main()
PY

echo "[integration-smoke] Başarılı."
