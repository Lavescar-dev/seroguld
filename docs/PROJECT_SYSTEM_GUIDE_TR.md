# Sero Guld CRM - Birlesik Proje Dokumantasyonu

Bu belge, Sero Guld CRM projesinin frontend, backend, Tauri masaustu katmani, veri modeli, entegrasyonlari ve operasyon akislarini tek yerde toplayan ana sistem dokumantasyonudur.

Amac:

- projeyi parca parca degil butun sistem olarak anlatmak
- frontend ve backend sorumluluklarini ayni baglamda gostermek
- gelistirme, demo, operasyon ve teslim surecini tek kaynaktan yurutmek
- yeni gelen bir gelistiricinin projeyi hizlica anlayabilmesini saglamak

Bu belge kodun yerine gecmez. Kodun ustunde calisir ve kodu okumayi hizlandirir.

Not (2026-04):

- kanonik frontend/runtime modeli `Vite + React Router + Tauri desktop` tir
- belge icinde gecen `Next.js` veya `App Router` referanslarinin bir kismi tarihsel baglamdir
- production desktop kurulum ve operasyon adimlari icin esas belge `docs/PRODUCTION_DESKTOP_RUNBOOK_TR.md` olmalidir

## 1. Proje Ozeti

Sero Guld CRM, ikinci el kuyumculuk operasyonu icin gelistirilmis iki ekranli bir CRM + POS + envanter yonetim sistemidir.

Sistemin ana amaclari:

- Recai Bey'in Excel tabanli alim, stok ve cikis takibini dijitallestirmek
- musteri ve satici ekranlarini ayirmak
- canli alim/satis akislarini guvenli ve hizli hale getirmek
- urunleri WooCommerce sitesine baglamak
- AI ile urun aciklamasi uretmek
- anti-fraud ve siparis kontrolunu CRM icine almak
- lokal masaustu kullanimina uygun, sunucudan bagimsiz calisabilen bir yapi sunmak

## 2. Teknoloji Stack'i

### Frontend

- Vite 6
- React 18
- TypeScript
- Tailwind CSS
- React Router
- TanStack Query

### Backend

- FastAPI
- SQLAlchemy 2
- Pydantic v2
- Uvicorn

### Veritabani

- Uretim / klasik kurulum: PostgreSQL 16
- Lokal masaustu / demo akisi: SQLite (`data/desktop.db`)

### Masaustu Katmani

- Tauri 2

### Diger Altyapi

- Docker Compose (secondary / web stack)
- Nginx
- OpenAI API
- WooCommerce REST API
- WordPress media / uygulama sifresi baglantisi
- yedekleme scriptleri

## 3. Ust Duzey Mimari

Sistem 4 ana katmandan olusur:

1. Arayuz katmani
   - admin paneli
   - musteri paneli
   - canli POS ekranlari
   - ikinci monitor musteri display ekranlari

2. Uygulama / is kurali katmani
   - FastAPI router'lari
   - servisler
   - sequence, POS, AI, Woo, anti-fraud ve rapor mantigi

3. Veri katmani
   - SQLAlchemy modelleri
   - transaction, product, customer, POS session ve log tablolari

4. Calistirma katmani
   - web gelistirme
   - Docker stack
   - Tauri desktop shell
   - backup / restore / offsite akislari

## 4. Calistirma Modlari

### 4.1 Docker / web modu

`docker-compose.yml` uzerinden:

- `postgres`
- `backend`
- `frontend`
- `nginx`

Bu mod secondary / klasik web deployment senaryosu icin uygundur.
Ilk prod-grade hedef bu mod degil, desktop-first runtime'dir.

### 4.2 Lokal desktop modu

Tauri dev akisi:

- `make desktop-dev`
- `desktop/scripts/dev.js`
- backend'i `127.0.0.1:8100` uzerinde baslatir
- frontend'i `127.0.0.1:3300` uzerinde baslatir
- Tauri penceresini acip Vite uygulamasini masaustu pencerede render eder

Destek komutlari:

- `make desktop-status`
- `make desktop-stop`
- `make desktop-restart`

Bu modun ana avantaji:

- yerel kullanima cok uygun olmasi
- shop icinde server bagimliligini azaltmasi
- SQLite ile tek makinede calisabilmesi

### 4.3 Demo modu

Demo icin hazir scriptler vardir:

- `make demo-start`
- `make demo-seed`
- `make demo-check`
- `make demo-ready`

Bu akista backend `8100`, frontend `3300` portunda calisir ve mock veri yuklenir.

## 5. Kod Klasor Yapisi

```text
seroguld-crm/
├── backend/
├── frontend/
├── desktop/
├── docs/
├── referans/
├── scripts/
├── data/
├── nginx/
├── docker-compose.yml
├── Makefile
└── README.md
```

### 5.1 `backend/`

FastAPI uygulamasi, veri modeli, API router'lari ve servis mantigi burada bulunur.

Ana alanlar:

- `backend/app/main.py`
- `backend/app/config.py`
- `backend/app/api/`
- `backend/app/models/`
- `backend/app/services/`
- `backend/app/schemas/`
- `backend/tests/`

### 5.2 `frontend/`

Vite tabanli admin, customer ve display ekranlari burada bulunur.

Ana alanlar:

- `frontend/src-v2/make/`
- `frontend/src-v2/components/`
- `frontend/src-v2/lib/`
- `frontend/src-v2/types.ts`

### 5.3 `desktop/`

Tauri shell ve lokal startup orchestrator'u burada bulunur.

Ana alanlar:

- `desktop/src-tauri/src/main.rs`
- `desktop/scripts/dev.js`

### 5.4 `referans/` ve `docs/referans/`

Excel referanslari, uyarlama backloglari ve field mapping belgeleri burada tutulur.

Bu klasorler, CRM'in Recai Bey'in mevcut sistemine sadik kalmasi icin source of truth olarak kabul edilir.

## 6. Domain Bazli Birlesik Sistem Haritasi

Bu bolum frontend ve backend'i domain bazinda birlikte anlatir.

### 6.1 Authentication

Frontend:

- login sayfasi: `frontend/src/app/page.tsx`
- token yonetimi: `frontend/src/lib/auth.ts`
- API wrapper: `frontend/src/lib/api.ts`

Backend:

- `backend/app/api/auth.py`

Fonksiyon:

- login
- refresh token
- register
- `me` bilgisi
- admin / customer rol ayrimi

### 6.2 Dashboard

Frontend:

- `frontend/src/app/admin/page.tsx`

Backend:

- `backend/app/api/dashboard.py`
- `backend/app/services/dashboard_helpers.py`

Fonksiyon:

- stok ozeti
- kar gorunumleri
- operasyon kartlari
- AI maliyetleri
- entegrasyon sagligi
- takvim ve grafikler

### 6.3 Customer Management

Frontend:

- `frontend/src/app/admin/customers/page.tsx`

Backend:

- `backend/app/api/customers.py`
- `backend/app/services/customer_service.py`

Fonksiyon:

- musteri listeleme
- arama
- fuzzy benzeri secim akislarina veri saglama
- WooCommerce musterilerini import etme
- detay ve risk sinyalleri

### 6.4 Product / Inventory Management

Frontend:

- `frontend/src/app/admin/products/page.tsx`

Backend:

- `backend/app/api/products.py`
- `backend/app/services/product_service.py`
- `backend/app/services/photo_service.py`
- `backend/app/services/woocommerce_import_helpers.py`

Fonksiyon:

- urun CRUD
- durum gecisleri
- 14 gun kilit mantigi
- foto yukleme
- AI description uretimi
- Woo publish / unpublish
- Woo live import
- Woo raw data inceleme

### 6.5 POS

Frontend:

- `frontend/src/app/admin/pos/page.tsx`
- `frontend/src/app/admin/pos/pos-config.ts`
- `frontend/src/app/admin/pos/pos-types.ts`
- `frontend/src/app/admin/pos/pos-utils.ts`

Backend:

- `backend/app/api/pos.py`
- `backend/app/services/pos_service.py`
- `backend/app/services/pos_transaction_service.py`
- `backend/app/services/pos_document_service.py`
- `backend/app/services/pos_receipt_renderer.py`
- `backend/app/services/sequence_service.py`
- `backend/app/services/realtime.py`
- `backend/app/services/pos_value_helpers.py`

Fonksiyon:

- canli alim / canli satis akisi
- POS oturumu
- display token uretimi
- ikinci ekran snapshot ve websocket
- coklu kalem
- referans / afregnings / invoice numaralari
- belge olusturma
- customer-safe snapshot yansitma

### 6.6 Customer Display

Frontend:

- `frontend/src/app/display/[token]/page.tsx`
- `frontend/src/app/display/idle/page.tsx`
- `frontend/src/app/display/components/*`

Backend:

- POS display endpoint ve websocket, `backend/app/api/pos.py` icinde
- realtime yayin servisi: `backend/app/services/realtime.py`

Fonksiyon:

- ikinci monitor ekraninda musteriye satir satir bilgi gosterme
- anlik satir ekleme / guncelleme / silme
- toplam teklif ve aktif kur goruntuleme
- kiosk / full-screen akisi

### 6.7 Customer Portal

Frontend:

- `frontend/src/app/customer/page.tsx`
- `frontend/src/app/customer/products/page.tsx`

Backend:

- `backend/app/api/customer_portal.py`

Fonksiyon:

- musteriye kendi ozetini gosterme
- musteri urun ekranlari

### 6.8 AI

Frontend:

- `frontend/src/app/admin/ai/page.tsx`

Backend:

- `backend/app/api/settings.py`
- `backend/app/services/ai_service.py`
- `backend/app/models/ai_usage_log.py`

Fonksiyon:

- OpenAI ayarlari
- model secimi
- timeout ayari
- urun foto ve metadata ile SEO paketi olusturma
- AI kullanim loglama

### 6.9 Anti-Fraud

Frontend:

- `frontend/src/app/admin/antifraud/page.tsx`

Backend:

- `backend/app/api/antifraud.py`
- `backend/app/services/antifraud_service.py`
- `backend/app/services/antifraud_helpers.py`

Fonksiyon:

- Woo siparislerinden risk alanlarini cekme
- OPMC meta alanlarini insan diliyle cevirme
- manuel inceleme ekranlari

### 6.10 Reports

Frontend:

- `frontend/src/app/admin/reports/page.tsx`

Backend:

- `backend/app/api/reports.py`

Fonksiyon:

- gunluk / haftalik / aylik raporlar
- CSV / XLSX / PDF export

### 6.11 Webhooks

Backend:

- `backend/app/api/webhooks.py`

Fonksiyon:

- WooCommerce webhook olaylari
- satis oldugunda CRM'de urun durumunu dusurme gibi akislar

## 7. Backend API Yuzeyi

Backend router'lari `backend/app/main.py` icinde su sekilde mount edilir:

- `/api/auth`
- `/api/antifraud`
- `/api/customer`
- `/api/customers`
- `/api/products`
- `/api/pos`
- `/api/dashboard`
- `/api/reports`
- `/api/settings`
- `/api/webhooks`

Ek endpoint:

- `/health`
- `/media/*`

Bu yapi, frontend tarafinda `frontend/src/lib/api.ts` uzerinden tek wrapper ile kullanilir.

## 8. Frontend Route Haritasi

Admin:

- `/`
  - login
- `/admin`
  - dashboard
- `/admin/pos`
  - canli alim / satis POS
- `/admin/products`
  - envanter
- `/admin/customers`
  - musteriler
- `/admin/reports`
  - raporlar
- `/admin/antifraud`
  - dolandiricilik kontrolu
- `/admin/ai`
  - AI ayarlari

Customer:

- `/customer`
- `/customer/products`

Display:

- `/display/idle`
- `/display/[token]`

## 9. Cekirdek Veri Modeli

Asagidaki modeller projenin cekirdegini olusturur:

- `User`
- `CustomerIdentity`
- `CustomerActivity`
- `Product`
- `ProductHistory`
- `WooCommerceSyncLog`
- `ReferenceSequence`
- `PosSession`
- `PosSessionLine`
- `PosSessionProductLink`
- `PosDocument`
- `Transaction`
- `TransactionLine`
- `AIUsageLog`

### 9.1 User

Roller:

- `admin`
- `customer`

Alanlar:

- email
- password hash
- role
- iletisim bilgileri
- hassas musteri verisi ile iliskiler

### 9.2 Product

Urun yasam dongusu:

- alindi
- beklemede / GDPR lock
- stokta
- satisa hazir
- satildi
- eritildi
- kararsiz

Alan gruplari:

- urun temel alanlari
- gram / ayar / saflik
- alis fiyati
- saf altin hesabi
- foto dizisi
- AI aciklama
- WooCommerce id / publish durumu

### 9.3 PosSession ve PosSessionLine

Bu iki model, canli POS akisinin merkezidir.

`PosSession`:

- oturum seviyesi bilgiler
- musteri
- islem tipi
- rate source
- final teklif
- display token

`PosSessionLine`:

- satir no
- product type
- metal type
- gram
- saflik
- rate
- satir toplam
- not

### 9.4 Transaction ve PosDocument

Confirm sonrasi:

- POS oturumu kalici belgeye donusur
- product kayitlari olusur veya linklenir
- makbuz / fatura render edilir

## 10. Excel Referans Uyumu

Bu proje sadece modern bir UI degildir; mevcut Excel yapisinin is kurali uyarlamasidir.

Referans kaynaklar:

- `referans/`
- `docs/referans/`
- `REFERANS_UYARLAMA_MASTER_PLAN_TR.md`
- `docs/referans/REFERENCE_DATA_DICTIONARY_TR.md`
- `docs/referans/EXCEL_TO_CRM_FIELD_MAP.csv`

Uyum saglanan ana alanlar:

- Afregningsbilag musteri alanlari
- kalem tablosu
- variable vaerdier numaralandirma mantigi
- Lager / depolama kolon mantigi
- log sistemi blok mantigi

Bu, ozellikle POS tasarimi ve coklu alis akisi icin kritik onemdedir.

## 11. Canli POS ve Musteri Ekrani Akisi

### 11.1 Satıcı ekranı

Akis ozet:

1. islem tipi secilir
2. musteri secilir veya olusturulur
3. POS oturumu acilir
4. satirlar eklenir
5. rate ve toplamlar hesaplanir
6. onay verilir
7. belge / makbuz uretilir

### 11.2 Musteri ekranı

Akis:

- `/display/idle`
  - bekleme durumu
- `/display/[token]`
  - aktif musteri oturumu

Veri akisi:

1. backend snapshot dondurur
2. frontend websocket'e baglanir
3. satir ekleme / guncelleme / silme olaylari anlik gorunur
4. musteri sadece customer-safe veriyi gorur

Asla gosterilmemesi gerekenler:

- CPR
- belge numarasi gibi hassas kimlik detaylari
- marj
- ic notlar
- storage location
- audit alanlari

## 12. AI ve WooCommerce Entegrasyonu

### 12.1 AI

AI tarafinda su ayarlar vardir:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `OPENAI_TIMEOUT_SECONDS`

AI'nin rolü:

- urun foto ve metadata okuyup Danca SEO paketi uretmek
- title, short description, long HTML, meta description ve slug hazirlamak

### 12.2 WooCommerce

Woo tarafinda ayarlar:

- `WOOCOMMERCE_BASE_URL`
- `WOOCOMMERCE_CONSUMER_KEY`
- `WOOCOMMERCE_CONSUMER_SECRET`
- `WOOCOMMERCE_WEBHOOK_SECRET`

WordPress media baglantisi icin:

- `WORDPRESS_BASE_URL`
- `WP_APP_USERNAME`
- `WP_APP_PASSWORD`

Desteklenen akışlar:

- son 100 canli urunu import etme
- musterileri import etme
- CRM urununu siteye publish etme
- Woo raw data inceleme
- satis senkron kontrolu
- webhook ile sold durumuna cekme

## 13. Anti-Fraud Modulu

Bu modul Woo siparislerini CRM icinde denetlenebilir hale getirir.

Hedef:

- OPMC / fraud meta alanlarini teknik olmayan insan diline cevirmek
- risk puani, nedenleri ve review ihtiyacini tek ekranda sunmak
- son siparislerde riskli davranislari hizlica incelemek

Mevcut altyapi:

- Woo order meta fetch
- risk level cikarimi
- insan diline cevirme helper'lari

## 14. Medya ve Foto Akisi

Medya sistemi:

- backend tarafinda `/media` altinda servis edilir
- dosyalar `data/uploads` altinda tutulur
- yukleme sonrasi AVIF optimizasyonu vardir

Foto akisinda:

1. urune foto yuklenir
2. primary image mantigi korunur
3. medya URL'leri backend tarafinda urun objesine yazilir
4. AI ve Woo publish sureci ayni foto havuzunu kullanir

## 15. Guvenlik Katmani

### 15.1 Auth

- access + refresh token mantigi vardir
- frontend `401` durumunda refresh dener
- refresh de fail olursa logout olur

### 15.2 Hassas veri

Config icinde:

- `field_encryption_key`

Bu anahtar, field-level encryption icin kullanilir.

Ozellikle:

- CPR
- adres
- hassas musteri alanlari

### 15.3 CORS

`backend/app/config.py` uzerinden ayarlanir.

### 15.4 Customer-safe veri ayrimi

Display tarafina dogrudan admin modeli basmak yerine ozet / snapshot modeli kullanilir.

Bu mimari karar dogrudur ve korunmalidir.

## 16. Konfigurasyon ve Ortam Degiskenleri

Ana ayar dosyasi:

- `.env`

Config sinifi:

- `backend/app/config.py`

Onemli degiskenler:

- `DATABASE_URL`
- `CORS_ORIGINS`
- `APP_URL`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `OPENAI_TIMEOUT_SECONDS`
- `WOOCOMMERCE_BASE_URL`
- `WOOCOMMERCE_CONSUMER_KEY`
- `WOOCOMMERCE_CONSUMER_SECRET`
- `WOOCOMMERCE_WEBHOOK_SECRET`
- `WORDPRESS_BASE_URL`
- `WP_APP_USERNAME`
- `WP_APP_PASSWORD`
- `MEDIA_ROOT_DIR`
- `INITIAL_ADMIN_EMAIL`
- `INITIAL_ADMIN_PASSWORD`

Desktop odakli degiskenler:

- `DESKTOP_DATABASE_URL`
- `DESKTOP_FRONTEND_PORT`
- `DESKTOP_BACKEND_PORT`
- `DESKTOP_SKIP_ELECTRON`

## 17. Gelistirme Komutlari

Ana komutlar `Makefile` uzerinden erisilebilir:

- `make setup`
- `make test`
- `make check`
- `make desktop-dev`
- `make seed-mock`
- `make demo-start`
- `make demo-stop`
- `make demo-seed`
- `make demo-check`
- `make demo-ready`
- `make integration-smoke`
- `make backup`
- `make backup-verify`
- `make backup-offsite`
- `make backup-restore-drill`

Direkt script seviyesinde:

- `scripts/setup-dev.sh`
- `scripts/test.sh`
- `scripts/desktop-dev.sh`
- `scripts/demo-start.sh`
- `scripts/demo-seed.sh`
- `scripts/demo-stop.sh`
- `scripts/integration-smoke.sh`

## 18. Test ve Dogrulama

Backend:

- `pytest`

Frontend:

- `tsc --noEmit`
- production build

Demo smoke-check:

- login
- dashboard
- POS
- display

Bu proje icin test stratejisi 3 seviyelidir:

1. unit / helper testi
2. API davranis testi
3. demo / smoke test

## 19. Backup ve Veri Guvenligi

Veri dizinleri:

- `data/backups`
- `data/offsite-mirror`
- `data/restore-drill`
- `data/uploads`

Desteklenen operasyonlar:

- GFS backup
- backup verify
- restore drill
- offsite sync
- cron kurulumu

Bu kisim, lokal desktop kurulumunda kritik onemdedir. Cunku verinin tek makinede olmasi durumunda backup yoksa sistem guvenli degildir.

## 20. Uretim ve Operasyon Acisindan Gercek Durum

Su an sistem hibrit bir yapidadir:

- teknik olarak web stack olarak calisabilir
- pratikte lokal Electron masaustu kullanimi oncelikli hale gelmistir

Bu iyi bir karardir cunku:

- kuyumcunun operasyonu tek lokasyonda
- iki ekranli kullanim senaryosu var
- server karmaşıkligi ilk fazda gereksiz

Ama sunlar unutulmamalidir:

- backup zorunludur
- config / secret yonetimi duzenlenmelidir
- ileride coklu cihaz gereksinimi cikarsa merkezi deployment dusunulmelidir

## 21. Su Anki Guclu Taraflar

- frontend ve backend net ayrilmis
- Electron ile lokal kullanim destekleniyor
- AI + Woo + display + anti-fraud ayni cati altinda
- POS ve envanter ayni veri modeli uzerinde birlesiyor
- referans Excel yapisina sadik kalma niyeti mevcut

## 22. Su Anki Teknik Borc / Iyilestirme Alanlari

- bazi ekranlarda UI/UX hala yeterince rafine degil
- POS akisi daha da sade ve hizli hale getirilmeli
- display UX tarafinda premium seviye polish surekli devam etmeli
- modulerlik yuksek olsa da domain bazli dokumantasyon yeni yeni toparlaniyor
- AI ve Woo akislarinda daha net operator guardrail'leri yazilmali
- anti-fraud ekranlarinda performans ve detay deneyimi optimize edilmeli

## 23. Oncelikli Sonraki Adimlar

1. POS alim ekranini Excel mantigina daha da yakinlastirmak
2. musteri display ekranini gercek ikinci monitor kullanimina tam uygun hale getirmek
3. confirm / belge / receipt tarafini operasyonel olarak netlestirmek
4. Woo publish ve satis senkronunu daha guvenilir hale getirmek
5. backup + restore drill akislarini teslim standardi yapmak
6. kritik ekranlarda demo kalitesinden operasyon kalitesine gecmek

## 24. Takim Icin Kullanim Notu

Bu projede calisirken en saglikli zihinsel model su olmalidir:

- bu bir web sitesi degil
- bu bir kuyumcu operasyon sistemi
- her ekran ya satici hizini artirmali ya da musteriye guven vermelidir

Dolayisiyla her yeni gelistirme su uc soruya cevap vermelidir:

1. Bu degisiklik Recai Bey'in isini daha hizli hale getiriyor mu?
2. Bu degisiklik musteri ekraninda daha guven veren bir deneyim sagliyor mu?
3. Bu degisiklik mevcut Excel operasyon mantigini kaybetmeden sistemi daha iyi hale getiriyor mu?

## 25. Bu Belgenin Kapsami ve Bagli Belgeler

Bu belge ana merkez dokumandir.

Destekleyici belgeler:

- `README.md`
- `AZ_STATUS_ROADMAP_TR.md`
- `MVP_DEMO_PLAN_TR.md`
- `REFERANS_UYARLAMA_MASTER_PLAN_TR.md`
- `docs/referans/README.md`
- `docs/referans/REFERENCE_DATA_DICTIONARY_TR.md`
- `docs/referans/EXCEL_TO_CRM_FIELD_MAP.csv`
- `docs/referans/SPRINT1_EXECUTION_BACKLOG_TR.md`

## 26. Sonuc

Sero Guld CRM artik sadece "frontend" ve "backend" diye ayri dusunulmemelidir.

Bu proje:

- admin operasyon paneli
- musteri gorunum paneli
- lokal masaustu uygulamasi
- WooCommerce entegrasyon kati
- AI icerik motoru
- anti-fraud izleme paneli
- belge / rapor / backup altyapisi

olarak birlikte ele alinmalidir.

Bu dokumanin amaci da tam olarak budur: sistemi tek bir urun olarak anlatmak.
