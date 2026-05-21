"""Uniconta smoke test — synthetic 1 DKK test faturası push'ı.

Bu script gerçek bir PosDocument akışı yerine in-memory synthetic objeler
kullanarak `sync_pos_document_to_uniconta()` fonksiyonunu doğrudan çağırır.
R1/R2/R3 düzeltmeleri + free-text line builder + DebtorClient ensure +
GenerateDebtorInvoice akışını uçtan uca dener.

Kullanım:
  cd backend
  .venv/bin/python ../scripts/uniconta_smoke_push.py            # dry-run
  .venv/bin/python ../scripts/uniconta_smoke_push.py --push     # tek push
  .venv/bin/python ../scripts/uniconta_smoke_push.py --r1       # 3-aşamalı R1 testi
  .venv/bin/python ../scripts/uniconta_smoke_push.py --push --force  # idempotency bypass test

UYARI: --push verildiğinde Uniconta'da GERÇEK fatura kaydı oluşur
(simulate=False hard-coded). Sonra Uniconta'da kreditnota gerekir.
"""

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace


BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))


class _Document:
    """Synthetic PosDocument — sync fonksiyonu için yeterli attribute set."""

    def __init__(self, sequence_no: int) -> None:
        self.sequence_no = sequence_no
        self.customer_name = "TEST Kunde - Sero Guld Smoke Test"
        self.customer_phone = "+45 12 34 56 78"
        self.customer_email = "smoketest@seroguld.dk"
        self.customer_address = "Valby Langgade 84"
        self.notes = "Smoke test - sembolik 1 DKK"
        self.gross_amount_dkk = 1.0
        self.uniconta_sync_status: str | None = None
        self.uniconta_invoice_number: str | None = None
        self.uniconta_account: str | None = None
        self.uniconta_invoice_date: str | None = None
        self.uniconta_pdf_path: str | None = None
        self.uniconta_synced_at = None
        self.uniconta_sync_error: str | None = None


class _Customer:
    def __init__(self) -> None:
        self.id = "TEST-SMOKE-001"
        self.name = "TEST Kunde - Sero Guld Smoke Test"
        self.phone = "+45 12 34 56 78"
        self.email = "smoketest@seroguld.dk"
        self.city = "Valby"
        self.postal_code = "2500"


class _Session:
    def __init__(self) -> None:
        self.customer = _Customer()
        self.customer_id = self.customer.id
        self.notes = None


class _Line:
    """Free-text line builder. 1 g × 100 DKK/g = 100 DKK toplam.

    Önceki dry-run'da 0.001g × 1000 DKK Total=0 sonuç verdi (Uniconta
    muhtemelen küçük Qty'yi yuvarladı). 1g × 100 DKK ile doğrulama daha
    deterministik.
    """

    def __init__(self) -> None:
        self.metal_type = SimpleNamespace(value="GOLD")
        self.purity_karat = 24
        self.purity_percentage = 999
        self.weight_grams = 1.0
        self.rate_dkk = 100.0
        self.line_offer_dkk = 100.0


async def _push_once(doc, session, lines, *, force: bool, label: str) -> dict:
    from app.services.uniconta_service import sync_pos_document_to_uniconta

    print(f"\n--- {label} (force={force}) ---")
    print(f"  pre  status   : {doc.uniconta_sync_status}")
    print(f"  pre  invoice# : {doc.uniconta_invoice_number}")
    result = await sync_pos_document_to_uniconta(
        None,
        doc,
        pos_session=session,
        pos_lines=lines,
        pdf_cache_dir=str(BACKEND_DIR.parent / "data/documents/uniconta"),
        force=force,
    )
    print(f"  result        : ok={result.get('ok')}  idempotent={result.get('idempotent')}")
    print(f"  result msg    : {result.get('message')}")
    print(f"  post status   : {doc.uniconta_sync_status}")
    print(f"  post invoice# : {doc.uniconta_invoice_number}")
    print(f"  post pdf      : {doc.uniconta_pdf_path}")
    if doc.uniconta_sync_error:
        print(f"  post error    : {doc.uniconta_sync_error}")
    return result


async def main(push: bool, force: bool, r1_test: bool) -> int:
    from app.services.uniconta_service import (
        sync_pos_document_to_uniconta,
        get_uniconta_client,
        build_uniconta_lines_from_pos_lines,
    )

    client = get_uniconta_client()
    print("=" * 72)
    print("UNICONTA SMOKE PUSH — synthetic 1 DKK test faturası")
    print("=" * 72)
    print(f"Mode             : {'PUSH (gerçek!)' if push else 'DRY-RUN (Uniconta yok)'}")
    print(f"Force            : {force}")
    print(f"Base URL         : {client.base_url}")
    print(f"Credentials      : {'OK' if client.has_credentials else 'EKSİK'}")
    print(f"Send email       : {os.getenv('UNICONTA_SEND_EMAIL_ON_FINALIZE', 'false')}")
    print(f"Send XML         : {os.getenv('UNICONTA_SEND_XML_ON_FINALIZE', 'false')}")
    print()

    doc = _Document(sequence_no=int(datetime.now().strftime("%Y%m%d%H%M")))
    session = _Session()
    lines = [_Line()]

    print(f"Customer.id      : {session.customer.id}")
    print(f"Customer.name    : {session.customer.name}")
    print(f"Customer.city    : {session.customer.city}")
    print(f"Customer.postal  : {session.customer.postal_code}")
    print(f"PosDocument.seq  : {doc.sequence_no}")
    print(f"Expected Account : CRM-{session.customer.id}")
    print()

    payload_lines = build_uniconta_lines_from_pos_lines(lines)
    print("Lines payload preview:")
    for ln in payload_lines:
        print(f"  - Item={ln['Item']} | Text='{ln['Text']}' | Qty={ln['Qty']} | Price={ln['Price']} DKK")
    print()

    if not (push or r1_test):
        print("[DRY-RUN] --push veya --r1 verilmedi. Uniconta'ya gönderilmiyor.")
        return 0

    if r1_test:
        print("[R1 TEST] 3-aşamalı idempotency + force testi")
        print("  Beklenen: 2 gerçek Uniconta faturası + 1 idempotent skip")

        r1 = await _push_once(doc, session, lines, force=False, label="Push #1 (fresh)")
        if not r1.get("ok"):
            print("\n[FAIL] Push #1 hata verdi, sonraki adımlar atlandı.")
            return 1
        if r1.get("idempotent"):
            print("\n[FAIL] Push #1 idempotent dönmemeliydi (fresh state).")
            return 1

        r2 = await _push_once(doc, session, lines, force=False, label="Push #2 (idempotent test)")
        if not r2.get("idempotent"):
            print("\n[FAIL] Push #2 idempotent=True dönmeliydi (R1 bozuk).")
            return 1

        r3 = await _push_once(doc, session, lines, force=True, label="Push #3 (force bypass)")
        if r3.get("idempotent"):
            print("\n[FAIL] Push #3 idempotent dönmemeliydi (force=True bypass etmeli).")
            return 1
        if not r3.get("ok"):
            print("\n[FAIL] Push #3 hata verdi.")
            return 1

        print("\n[PASS] R1 testi başarılı:")
        print(f"  - Push #1: yeni fatura oluştu (status='{doc.uniconta_sync_status}')")
        print(f"  - Push #2: idempotent skip (Uniconta'ya istek gitmedi)")
        print(f"  - Push #3: force bypass ile ikinci API call yapıldı")
        print(f"\nUniconta'da kreditnota ile iptal edilecek faturalar:")
        print(f"  Account: {doc.uniconta_account}")
        print(f"  Date:    {doc.uniconta_invoice_date}")
        print(f"  Adet:    2 (Push #1 + Push #3)")
        return 0

    # tek push (legacy --push)
    await _push_once(doc, session, lines, force=force, label="Single push")
    return 0 if doc.uniconta_sync_status == "synced" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--push", action="store_true",
        help="Uniconta'ya gerçek istek at (yoksa sadece payload göster)."
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Idempotency guard'ı bypass et (--push ile birlikte).",
    )
    parser.add_argument(
        "--r1", action="store_true",
        help="3-aşamalı R1 idempotency testi (2 gerçek fatura + 1 idempotent skip).",
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(main(push=args.push, force=args.force, r1_test=args.r1)))
