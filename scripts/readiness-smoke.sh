#!/usr/bin/env bash
set -euo pipefail

TARGET_URL="${1:-http://127.0.0.1:8100/readyz}"

tmp_body="$(mktemp)"
trap 'rm -f "${tmp_body}"' EXIT

http_code="$(curl -sS -o "${tmp_body}" -w '%{http_code}' "${TARGET_URL}")"

if [[ "${http_code}" != "200" ]]; then
  echo "[readiness-smoke] readiness başarısız (${http_code}): ${TARGET_URL}" >&2
  cat "${tmp_body}" >&2
  exit 1
fi

echo "[readiness-smoke] readiness başarılı: ${TARGET_URL}"
cat "${tmp_body}"
