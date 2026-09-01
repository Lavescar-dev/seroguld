# Sero Guld Production Desktop Runbook

> **Son güncellenme:** 2026-05-18
> **Hedef sürüm:** v0.2.0
> **Migration head:** `0019_log_module_audit`

Bu belge ilk prod-grade hedef olan **desktop-first** runtime için operasyon adımlarını toplar.

Kapsam:
- signed/release Tauri paketi
- yerel backend + yerel veri klasörleri
- güvenli `.env` bootstrap
- ilk admin bootstrap
- readiness kontrolü
- backup / verify / restore prosedürü
- üretim öncesi güvenlik kontrol listesi (yeni)

Bu belge `docker-compose` web stack'ini kanonik production hedef olarak kabul etmez. Web mod opsiyoneldir.

---

## 1. Hedef Runtime

İlk production hedef:
- **masaüstü uygulama:** Tauri 2 (release build)
- **frontend:** build edilmiş Vite bundle (Tauri içinde embedded)
- **backend:** aynı makinede çalışan FastAPI runtime (uvicorn `--workers 1`)
- **veri:** yerel path'ler (`data/`)
- **office runtime:** local/edge service olarak yönetilen `ONLYOFFICE` / `Collabora`

**Önemli:**
- Production'da `uvicorn --workers 1` zorunlu (Uniconta singleton cache + OPMC orders cache + DebtorClient cache process-local).
- SQLite veya PostgreSQL kullanılabilir; tek-makinede SQLite önerilir.

---

## 2. İlk Kurulum Sırası

### 2.1 Güvenli production env hazırla
```bash
make prod-bootstrap
```

Bu komut `.env`'i güvenli default'larla doldurur. **Manuel kontrol gereken alanlar:**
- `JWT_ACCESS_SECRET` ve `JWT_REFRESH_SECRET` — en az 32 byte, rastgele
- `FIELD_ENCRYPTION_KEY` — base64 32 byte, rastgele
- `ONLYOFFICE_JWT_SECRET` — değiştir
- `INITIAL_ADMIN_EMAIL` ve `INITIAL_ADMIN_PASSWORD` — güçlü parola
- `INITIAL_ADMIN_AUTO_SEED=false` (prod'da)
- `DATABASE_AUTO_CREATE=false` (prod'da)
- Entegrasyon credential'ları (WC, Uniconta, OpenAI, WP) gerçek değerler

### 2.2 Veritabanı migration uygula
```bash
cd backend
.venv/bin/python -m alembic upgrade head
```
Beklenen head: `0019_log_module_audit`.

### 2.3 İlk admini oluştur/güncelle
```bash
make bootstrap-admin
```

### 2.4 Runtime readiness kontrolü
```bash
make readiness-smoke
```

---

## 3. Production Guardrail'leri

`ENV=production` altında backend boot etmeden önce şu kuralları validate eder:

| Kural | Açıklama |
|---|---|
| `JWT_ACCESS_SECRET` | `change-me-*` değil ve uzunluk ≥32 |
| `JWT_REFRESH_SECRET` | Aynı |
| `FIELD_ENCRYPTION_KEY` | base64 32 byte |
| `ONLYOFFICE_JWT_SECRET` | Default değil |
| `INITIAL_ADMIN_PASSWORD` | Güvenli (en az 8 char + karışık) |
| `DATABASE_AUTO_CREATE` | `false` olmalı |
| `INITIAL_ADMIN_AUTO_SEED` | `false` olmalı |

Bu koşullar sağlanmazsa backend bilinçli olarak boot etmez.

---

## 4. Readiness Yüzeyleri

### 4.1 Public readiness
```
GET /readyz
```

### 4.2 Admin readiness
```
GET /api/v2/runtime/readiness
```

### 4.3 Kontrol edilen alanlar
- database bağlantısı
- media / documents / backup / restore-drill write testi
- backup freshness
- restore-drill freshness
- offsite sync freshness
- office runtime availability
- migration head doğru mu

---

## 5. Backup ve Restore

### 5.1 Lokal backup
```bash
make backup                  # GFS rotasyonlu (hourly+daily+weekly)
make backup-verify           # son backup integrity check
make backup-restore-drill    # restore tatbikatı
```

### 5.2 Offsite mirror
```bash
make backup-rclone-setup     # rclone binary indir + config
make backup-offsite          # rclone sync hedef'e
```

### 5.3 Cron kurulumu
```bash
make backup-cron-install     # crontab'a 4 cron job
make backup-cron-uninstall   # kaldır
```

### 5.4 Kontrollü restore
```bash
make restore-from-backup
# veya:
bash scripts/restore-from-backup.sh /path/to/archive.tar.gz /safe/restore/dir
```

### 5.5 ⚠️ Üretim öncesi eksik
- **Backup encryption yok** — yedek dosyalar plaintext, CPR/kimlik bilgisi açık.
  - Çözüm: `gpg --symmetric` veya `age` ile yedek tar'ları şifrele.
  - Detay: `docs/PROJECT_HEALTH_AUDIT.md` §2.1.A #9

---

## 6. Release Build

### 6.1 Release gate (her biri yeşil olmalı)
- backend pytest green: `make backend-test`
- frontend typecheck green: `cd frontend && npm run typecheck`
- frontend vitest green: `cd frontend && npm test`
- frontend build green: `cd frontend && npm run build`
- Tauri release build green

### 6.2 Tek komut
```bash
make release-desktop
```

Bu komut sırasıyla backend test, frontend typecheck, frontend build ve Tauri release build çalıştırır.

### 6.3 Çıktı yerleri
- Linux: `desktop/src-tauri/target/release/bundle/{deb,appimage}/`
- Windows: `desktop/src-tauri/target/release/bundle/{msi,nsis}/`
- macOS: `desktop/src-tauri/target/release/bundle/{macos,dmg}/`

### 6.4 ⚠️ Eksik: Code signing
- Windows: SignTool ile imzala (yoksa "unknown publisher" uyarısı)
- macOS: codesign + notarize (yoksa Gatekeeper engeller)
- Linux: AppImage detached signature (opsiyonel)

> Detay: `docs/PROJECT_HEALTH_AUDIT.md` §2.1 — Tauri prod hardening

---

## 7. Operasyon Notları

### 7.1 Critical guardrails
- Default admin seed production'da otomatik çalışmaz (`INITIAL_ADMIN_AUTO_SEED=false`)
- `Base.metadata.create_all()` production'da otomatik çalışmaz (`DATABASE_AUTO_CREATE=false`)
- Web/compose stack secondary kabul edilir; production desktop için ana teslim yolu değildir
- Backup health veya restore drill stale ise runtime teknik olarak açılsa bile operasyonel olarak `ready` sayılmaz

### 7.2 Multi-worker uyarısı
Uniconta + OPMC + DebtorClient cache'ler process-singleton. Production'da `uvicorn --workers 1` zorunlu. Eğer çoklu worker gerekiyorsa:
- Redis backed cache implementasyonu eklenmelidir
- Şu an `.env` yorum bloğunda not edilmiştir

### 7.3 Uniconta toggle'ları
`POST /api/v2/uniconta/connect` ile UI'dan yazılır:
- `UNICONTA_SEND_EMAIL_ON_FINALIZE` — finalize sonrası müşteriye email
- `UNICONTA_SEND_XML_ON_FINALIZE` — OIOUBL e-fatura XML gönderim

### 7.4 Office runtime
OnlyOffice + Collabora docker compose ile başlatılır:
```bash
docker compose -f docker-compose.yml up -d onlyoffice collabora
```
Health: `GET /api/v2/office-runtime/status?kind=alis-workspace`

---

## 8. Üretim Öncesi Güvenlik Checklist (KRİTİK)

Production'a çıkmadan önce şu liste 100% tamamlanmalı:

> Detay: `docs/PROJECT_HEALTH_AUDIT.md` §2.1.A

- [ ] **`.env` credential'ları repo'dan temizlendi** (git history rewrite)
- [ ] OpenAI API key rotate edildi
- [ ] WC consumer key/secret rotate edildi
- [ ] WP application password rotate edildi
- [ ] Uniconta password rotate edildi
- [ ] `JWT_ACCESS_SECRET` prod'da değiştirildi (≥32 byte)
- [ ] `JWT_REFRESH_SECRET` prod'da değiştirildi (≥32 byte)
- [ ] `FIELD_ENCRYPTION_KEY` prod'da değiştirildi
- [ ] `ONLYOFFICE_JWT_SECRET` prod'da değiştirildi
- [ ] `INITIAL_ADMIN_PASSWORD` güçlendirildi
- [ ] `INITIAL_ADMIN_AUTO_SEED=false`
- [ ] `DATABASE_AUTO_CREATE=false`
- [ ] Nginx HTTPS + HSTS kuruldu (web stack için)
- [ ] CSP daraltıldı (Tauri prod build için `unsafe-eval` çıkartıldı)
- [ ] Backup encryption (gpg/age) eklendi
- [ ] Backup cron aktif (`make backup-cron-install`)
- [ ] GDPR runner systemd timer aktif (`make gdpr-systemd-install`)
- [ ] Rate limit middleware (FastAPI slowapi) eklendi
- [ ] CSRF protection (fastapi-csrf) eklendi
- [ ] Sentry / error tracking entegre edildi
- [ ] `/readyz` ve `/api/v2/runtime/readiness` yeşil
- [ ] Restore drill başarılı (`make backup-restore-drill`)
- [ ] AFG e-posta: `WP_BRIDGE_SECRET` üretildi (`openssl rand -hex 32`), WP option'a + CRM `.env`'e yazıldı (bkz. §11)

---

## 9. Operasyonel Bakım

### 9.1 Günlük (operatör)
```bash
make desktop-dev          # Sabah başlat
# ... çalışma ...
make desktop-stop         # Akşam kapat
```

### 9.2 Haftalık (admin)
```bash
make backup-verify
make backup-offsite
make gdpr-scan
make readiness-smoke
```

### 9.3 Aylık (admin)
```bash
make backup-restore-drill
# .env credential rotation (3 ay'da bir)
# DB index audit (slow query log)
```

### 9.4 Acil durum: Backend çökmüş
```bash
make desktop-restart                   # Full restart
journalctl --user -u seroguld-backend -n 100   # systemd ise log
tail -f .run/desktop-dev.log                    # dev modunda
sqlite3 data/desktop.db "PRAGMA integrity_check;"
cd backend && .venv/bin/alembic current
```

### 9.5 Veri kurtarma
```bash
make restore-from-backup
# Manuel SQLite:
cp data/backups/YYYY-MM-DD/desktop.db data/desktop.db.recovery
sqlite3 data/desktop.db.recovery "PRAGMA integrity_check;"
mv data/desktop.db data/desktop.db.broken
mv data/desktop.db.recovery data/desktop.db
make desktop-restart
```

---

## 11. AFG E-posta Kurulumu (WP Bridge — şifresiz CRM)

AFG (afregningsbilag) finalize edildiğinde müşteriye PDF e-posta ile gider
(R2-16 + AFG-P1/P2). Transport `EMAIL_TRANSPORT` env'iyle seçilir:

- **`wp-bridge`** (önerilen — şifresiz CRM): seroguld.dk'daki WordPress
  eklentisi (`ops/wordpress/seroguld-crm-bridge/`) e-postayı `wp_mail()` +
  WP Mail SMTP ile gönderir. SMTP şifresi WordPress'te kalır; CRM'e ASLA
  girmez. (`websmtp.simply.com` yalnız Simply sunucularından erişilebildiği
  için masaüstü CRM'in tek şifresiz yolu budur.)
- **`smtp`** (fallback): CRM'den direkt `smtp.simply.com:587` — auth zorunlu,
  şifre `.env`'de düz metin. wp-bridge başarısızsa bir kez otomatik denenir.

### 11.1 Kurulum

```bash
# 1. Secret üret
openssl rand -hex 32

# 2. WordPress tarafına kur (ssh seroguld.dk@linux185.unoeuro.com):
bash scripts/package-wordpress-bridge.sh        # → .run/seroguld-crm-bridge-<ver>.zip
# zip'i wp-content/plugins/ altına aç, eklentiyi etkinleştir:
ssh seroguld.dk@linux185.unoeuro.com \
  'cd /var/www/seroguld.dk/public_html/wp-content/plugins && unzip -o /tmp/seroguld-crm-bridge-*.zip'
ssh seroguld.dk@linux185.unoeuro.com \
  'cd /var/www/seroguld.dk/public_html && wp plugin activate seroguld-crm-bridge'
ssh seroguld.dk@linux185.unoeuro.com \
  'cd /var/www/seroguld.dk/public_html && wp option add seroguld_crm_bridge_secret "<32-hex>"'

# 2. CRM .env (müşteri Windows kurulumu):
#    EMAIL_TRANSPORT=wp-bridge
#    WP_BRIDGE_URL=https://seroguld.dk/wp-json/seroguld/v1/send-afg-email
#    WP_BRIDGE_SECRET=<aynı 32-hex>
#    AFG_EMAIL_ENABLED=true
```

### 11.2 Canlı smoke

```bash
TOKEN=<32-hex>; URL=https://seroguld.dk/wp-json/seroguld/v1/send-afg-email
# 200 + {"sent":true}; yanlış token 401; 12MB 413; 11. istek 429; http:// 403
curl -s -X POST "$URL" -H "X-SeroGuld-Bridge-Token: $TOKEN" \
  -H 'Content-Type: application/json' -d '{"to":"test@example.dk","customer_name":"T","document_number":"T-1","pdf_base64":""}'
```

Detaylı smoke seti: `ops/wordpress/seroguld-crm-bridge/readme.txt`.

## 12. İlgili dökümanlar

- `docs/PROJECT_SYSTEM_GUIDE_TR.md` — Ana sistem dokümantasyonu
- `docs/HANDOVER.md` — Detaylı teknisyen devir kılavuzu
- `docs/PROJECT_HEALTH_AUDIT.md` — Üretim öncesi açıkların tam listesi
- `docs/DEV_RUNTIME_PROTOCOL.md` — Dev runtime protokolü
- `docs/DESKTOP_SMOKE_PREREQUISITES_TR.md` — Smoke test önkoşullar
- `docs/GDPR_TAURI_SMOKE_TR.md` — GDPR smoke akışı
