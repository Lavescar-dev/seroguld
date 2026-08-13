#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-${ENV_FILE:-${ROOT_DIR}/.env}}"
ENV_EXAMPLE="${ROOT_DIR}/.env.example"

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${ENV_EXAMPLE}" "${ENV_FILE}"
  echo "[prod-bootstrap] .env bulunamadı, .env.example kopyalandı: ${ENV_FILE}"
fi

PYTHONPATH="${ROOT_DIR}/backend" python3 - "${ENV_FILE}" <<'PY'
import base64
import secrets
import sys
from pathlib import Path

from app.utils.env_file import upsert_env_values


env_path = Path(sys.argv[1])


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key] = value
    return values


current = parse_env(env_path)
generated: dict[str, str] = {}


def ensure_value(key: str, *, blocked: set[str], factory, min_length: int | None = None) -> str:
    existing = current.get(key, "").strip()
    if existing and existing not in blocked and (min_length is None or len(existing) >= min_length):
        return existing
    value = factory()
    generated[key] = value
    return value


updates = {
    "ENV": "production",
    "DATABASE_AUTO_CREATE": "false",
    "INITIAL_ADMIN_AUTO_SEED": "true",
    "INITIAL_ADMIN_FORCE_PASSWORD_CHANGE": "true",
    "INITIAL_ADMIN_EMAIL": "info@seroguld.dk",
    "INITIAL_ADMIN_NAME": "Recai",
    "JWT_ACCESS_SECRET": ensure_value(
        "JWT_ACCESS_SECRET",
        blocked={"change-me-access-secret"},
        factory=lambda: secrets.token_urlsafe(48),
        min_length=32,
    ),
    "JWT_REFRESH_SECRET": ensure_value(
        "JWT_REFRESH_SECRET",
        blocked={"change-me-refresh-secret"},
        factory=lambda: secrets.token_urlsafe(48),
        min_length=32,
    ),
    "FIELD_ENCRYPTION_KEY": ensure_value(
        "FIELD_ENCRYPTION_KEY",
        blocked={"change-me-32-byte-base64-key"},
        factory=lambda: base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("utf-8"),
        min_length=32,
    ),
    "ONLYOFFICE_JWT_SECRET": ensure_value(
        "ONLYOFFICE_JWT_SECRET",
        blocked={"seroguld-onlyoffice-secret"},
        factory=lambda: secrets.token_urlsafe(36),
        min_length=24,
    ),
    "INITIAL_ADMIN_PASSWORD": "admin",
}

upsert_env_values(env_path, updates)

print(f"[prod-bootstrap] production env hazırlandı: {env_path}")
print("[prod-bootstrap] ilk admin: info@seroguld.dk / geçici parola; ilk girişte değişiklik zorunlu")
if generated:
    print("[prod-bootstrap] güvenli değer üretilen anahtarlar:")
    for key in sorted(generated):
        if key == "INITIAL_ADMIN_PASSWORD":
            print(f"  - {key}=<generated>")
        else:
            print(f"  - {key}")
else:
    print("[prod-bootstrap] mevcut güvenli değerler korundu, yeni secret üretilmedi.")
print("[prod-bootstrap] sonraki adımlar: alembic upgrade head && make bootstrap-admin && make readiness-smoke")
PY
