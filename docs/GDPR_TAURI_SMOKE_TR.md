# GDPR Tauri Smoke

> **Son güncellenme:** 2026-05-18

## Hedef
Desktop/Tauri içinde GDPR cockpit ve public bridge yüzeylerinin operatör gözüyle doğrulanması.

## Ön Koşul
- `make desktop-dev` çalışır durumda
- admin login tamam
- backend reachable (`GET /readyz` → `ready`)
- migration head: `0019_log_module_audit`

## Kontrol Listesi

1. Sidebar'dan `GDPR` modülünü açın.
2. `Overview` kartlarında queued/failed job ve scan/run zamanları görünmeli.
3. `Requests` listesi render olmalı; bir request seçildiğinde detail drawer veya detail panel açılmalı.
4. `Retention Policies` kartında **7 policy** görünmeli:
   - `financial_ledger` (5y, keep_restrict)
   - `afg_purchase_documents` (5y, keep_restrict) — Bogføringsloven §10
   - **`afg_melt_lots`** (5y, keep_restrict) — yeni (M4)
   - `customer_master` (5y, pseudonymize)
   - `gdpr_audit` (5y, keep_restrict)
   - `operational_logs` (90d, delete)
   - `local_backups` (35d, delete)
   - `offsite_backups` (90d, delete)
5. `WordPress Bridge` kartında privacy/cookies/request URL'leri ve cookie-config endpointi görünmeli.
6. `Jobs` panelinde yakın tarihli runner/request job kayıtları görünmeli.
7. Customer modülünden `GDPR Dossier` deep-link'i ile `/gdpr?customer=<id>` açılmalı.
8. Yeni bir public request oluşturup admin verify/approve/execute akışını deneyin.
9. Export request tamamlanınca `Export indir` çalışmalı.
10. Pseudonymize request sonrası ilgili customer detail'de `gdpr_status = pseudonymized` görünmeli.

## Public Sayfalar (token gerekmez)

- `/gdpr/privacy` — Privatlivspolitik
- `/gdpr/cookies` — Cookies
- `/gdpr/request` — Anmod om dataindsigt (yeni request submit)
- `/gdpr/request/:token` — Status takibi

## Scripted Yardımcı Kontrol

```bash
make gdpr-smoke         # temp backend ile çalışır, canlı veriyi mutate etmez
make gdpr-smoke-live    # canlı backend üzerinde mutate eder — DİKKAT
```

`gdpr-smoke-live` ise mevcut backend üzerinde public request, verify/approve/execute, export download ve pseudonymize akışını doğrular; **yalnız bilinçli canlı operasyon doğrulaması için** kullanılmalıdır.

## Otomatik Runner

```bash
make gdpr-runner                  # tek-shot queued job runner
make gdpr-systemd-install         # user systemd timer + service
make gdpr-systemd-status          # durum kontrol
make gdpr-systemd-uninstall       # kaldır
```

## İlgili dökümanlar

- `docs/PROJECT_SYSTEM_GUIDE_TR.md` §6.13 (GDPR modülü)
- `docs/WORDPRESS_GDPR_BRIDGE_TR.md` — WP entegrasyonu
- `backend/app/services/gdpr_service.py` — `DEFAULT_RETENTION_POLICIES`
