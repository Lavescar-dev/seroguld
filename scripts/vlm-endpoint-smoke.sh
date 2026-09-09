#!/usr/bin/env bash
# Kimlik VLM katmani — tek komut smoke testi (her OpenAI-uyumlu uc icin).
#
# Uclar:
#   - Azure AB (uretim):  IDENTITY_EXTRACT_BASE_URL=https://<kaynak>.openai.azure.com/openai/v1
#   - OpenRouter (SADECE sentetik test; kredi kisitli): https://openrouter.ai/api/v1
#     GERCEK kart goruntusu OpenRouter'a ASLA gonderilmez (GDPR: islemci AB
#     bolgesinde degil — ayrinti: docs/IDENTITY_VLM_DPIA_NOTE_TR.md).
#
# Ne yapar:
#   1) uc ayarlarini okur: once export edilmis degiskenler, yoksa backend/.env
#      (anahtar EKRANA BASILMAZ — sadece HTTP kod/cevap govdesi basilir)
#   2) uca kucuk bir chat-completions "ping" atar — deployment/model var mi?
#   3) varsa sentetik Code 128 goruntusuyle extract_identity'i gercekten
#      cagirir: source=merged, usage dolu, strict json_schema kabul edilmi.
#      (Testlerle ayni sentetik barkod; gercek kart verisi YOK.)
#
# Kullanim (VDS, repo koku):
#   bash scripts/vlm-endpoint-smoke.sh                     # .env'deki uca
#   IDENTITY_EXTRACT_BASE_URL=... IDENTITY_EXTRACT_API_KEY=... \
#     IDENTITY_EXTRACT_MODEL=... bash scripts/vlm-endpoint-smoke.sh   # ezme
#
# Cikis kodlari: 0 = tamam, 1 = yapilandirma eksik, 2 = uc/deployment hatasi,
# 3 = extract smoke basarisiz.
#
# Azure onkosulu: Foundry'de deployment adi = model adi (gpt-5-mini), tip
# EU Data Zone veya Regional — Global YASAK.

set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${SEROGULD_CONFIG_FILE:-backend/.env}"
PY="$PWD/backend/.venv/bin/python"  # mutlak: asagida cd backend var

die() { echo "SMOKE BASARISIZ: $1" >&2; exit "${2:-1}"; }

[ -x "$PY" ] || die "venv yok: $PY (backend kurulumu eksik)" 1

# .env opsiyonel: export edilmis degiskenler ONCELIK alir (test uclari).
env_val() {
    [ -f "$ENV_FILE" ] || return 0
    sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 | sed 's/^"//;s/"$//'
}

BASE_URL="${IDENTITY_EXTRACT_BASE_URL:-$(env_val IDENTITY_EXTRACT_BASE_URL)}"
KEY="${IDENTITY_EXTRACT_API_KEY:-$(env_val IDENTITY_EXTRACT_API_KEY)}"
MODEL="${IDENTITY_EXTRACT_MODEL:-$(env_val IDENTITY_EXTRACT_MODEL)}"
[ -n "$MODEL" ] || MODEL="gpt-5-mini"

[ -n "$BASE_URL" ] || die "uc bos: IDENTITY_EXTRACT_BASE_URL verin (export veya $ENV_FILE)" 1
[ -n "$KEY" ] || die "anahtar bos: IDENTITY_EXTRACT_API_KEY verin (export veya $ENV_FILE)" 1

echo "== Adim 1/2: ping ($MODEL @ $BASE_URL)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CODE=$(curl -sS -o "$TMP/resp.json" -w '%{http_code}' --max-time 90 \
    -X POST "$BASE_URL/chat/completions" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}]}") || die "uc adresine baglanilamadi" 2

if [ "$CODE" != "200" ]; then
    echo "HTTP $CODE — ilk 300 karakter:" >&2
    head -c 300 "$TMP/resp.json" >&2; echo >&2
    if echo "$CODE" | grep -q '^40'; then
        die "uc/model bulunamadi. Azure ise: Foundry > Deployments > New — model gpt-5-mini, deployment ADI da 'gpt-5-mini' (ad = model adi), tip EU Data Zone/Regional (Global YASAK). Sonra tekrar calistir." 2
    fi
    die "uc beklenmeyen kod dondu (yukariya bakin)" 2
fi
echo "   tamam — cevap 200."

echo "== Adim 2/2: sentetik barkodla extract_identity (gercek veri YOK)"
export IDENTITY_EXTRACT_ENABLED=true
export IDENTITY_EXTRACT_BASE_URL="$BASE_URL"
export IDENTITY_EXTRACT_API_KEY="$KEY"
export IDENTITY_EXTRACT_MODEL="$MODEL"
cd backend
"$PY" - <<'PYEOF'
import asyncio
import base64
import io
import json
import sys

import zxingcpp
from PIL import Image

from app.services.identity_extract_service import extract_identity

CPR = "0101011119"  # mod-11 gecerli sentetik CPR (testlerle ayni)


def barcode_data_url(text: str) -> str:
    bc = zxingcpp.create_barcode(text, zxingcpp.BarcodeFormat.Code128)
    img = zxingcpp.write_barcode_to_image(bc)
    pil = Image.frombuffer(
        "L", (img.shape[1], img.shape[0]), memoryview(img), "raw", "L", 0, 1
    ).convert("RGB")
    buf = io.BytesIO()
    pil.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


async def main() -> int:
    r = await extract_identity(image_data_url=barcode_data_url(CPR), side="front")
    summary = {
        "source": r.source,
        "model": r.model,
        "cpr": r.fields["cpr_number"].value,
        "cpr_review": r.fields["cpr_number"].review,
        "usage_total_tokens": r.usage.total_tokens if r.usage else None,
        "warnings": r.warnings,
    }
    print(json.dumps(summary, ensure_ascii=True, indent=2))
    ok = (
        r.model is not None
        and r.usage is not None
        and r.fields["cpr_number"].value == CPR
    )
    if not ok:
        print("BASARISIZ: model/usage bos veya CPR kurtarilamadi", file=sys.stderr)
        return 3
    return 0


sys.exit(asyncio.run(main()))
PYEOF

echo
echo "SMOKE TAMAM — VLM zinciri bu uçta calisiyor."
echo "Hatirlatma: uretim anahtarlari is bitince Portal'dan regenerate edilip"
echo "backend/.env guncellenmeli (sohbete yapistirilanlar)."
