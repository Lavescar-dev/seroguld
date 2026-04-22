# Sero Guld Production Desktop Runbook

Bu belge ilk prod-grade hedef olan `desktop-first` runtime icin operasyon adimlarini toplar.

Kapsam:

- signed/release Tauri paketi
- yerel backend + yerel veri klasorleri
- guvenli `.env` bootstrap
- ilk admin bootstrap
- readiness kontrolu
- backup / verify / restore proseduru

Bu belge `docker-compose` web stack'ini kanonik production hedef olarak kabul etmez.

## 1. Hedef Runtime

Ilk production hedef:

- masaustu uygulama: Tauri
- frontend: build edilmis Vite bundle
- backend: ayni makinede calisan FastAPI runtime
- veri: yerel path'ler (`data/`)
- office runtime: local/edge service olarak yonetilen `ONLYOFFICE` / `Collabora`

## 2. Ilk Kurulum Sirasi

1. Guvenli production env hazirla:

```bash
make prod-bootstrap
```

2. Veritabani migration uygula:

```bash
cd backend
.venv/bin/python -m alembic upgrade head
```

3. Ilk admini olustur/guncelle:

```bash
make bootstrap-admin
```

4. Runtime readiness kontrolu:

```bash
make readiness-smoke
```

## 3. Production Guardrail'ler

`ENV=production` altinda backend boot etmeden once su kurallari validate eder:

- `JWT_ACCESS_SECRET` guvenli olmali
- `JWT_REFRESH_SECRET` guvenli olmali
- `FIELD_ENCRYPTION_KEY` guvenli olmali
- `ONLYOFFICE_JWT_SECRET` guvenli olmali
- `INITIAL_ADMIN_PASSWORD` guvenli olmali
- `DATABASE_AUTO_CREATE=false`
- `INITIAL_ADMIN_AUTO_SEED=false`

Bu kosullar saglanmazsa backend bilincli olarak boot etmez.

## 4. Readiness Yuzeyleri

Public readiness:

```text
GET /readyz
```

Admin readiness:

```text
GET /api/v2/runtime/readiness
```

Kontrol edilen ana alanlar:

- database baglantisi
- media/documents/backup/restore-drill write testi
- backup freshness
- restore-drill freshness
- offsite sync freshness
- office runtime availability

## 5. Backup ve Restore

Lokal backup:

```bash
make backup
make backup-verify
make backup-restore-drill
```

Kontrollu restore:

```bash
make restore-from-backup
```

Opsiyonel olarak belirli bir arsiv ve hedef dizin verilebilir:

```bash
bash scripts/restore-from-backup.sh /path/to/archive.tar.gz /safe/restore/dir
```

## 6. Release Build

Release gate:

- backend pytest green
- frontend typecheck green
- frontend build green
- Tauri release build green

Komut:

```bash
make release-desktop
```

Bu komut sirasiyla backend test, frontend typecheck, frontend build ve Tauri release build calistirir.

## 7. Operasyon Notlari

- Default admin seed production'da otomatik calismaz.
- `Base.metadata.create_all()` production'da otomatik calismaz.
- Web/compose stack secondary kabul edilir; production desktop icin ana teslim yolu degildir.
- Backup health veya restore drill stale ise runtime teknik olarak acilsa bile operasyonel olarak `ready` sayilmaz.
