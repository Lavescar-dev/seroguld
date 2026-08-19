# SERO GULD CRM 0.3.6 — Teslimat Raporu (2026-08-19)

## Installer

- Dosya: `C:\Users\Lavescar\Downloads\SERO-GULD-CRM-FULL-SETUP.exe` (255,9 MB)
- SHA256: `7246faccf0b3013a4c67c4e4065035185d264f3f5edbf59b0cd678c8e77fefa9`
- Manifest: `SERO-GULD-CRM-FULL-SETUP.manifest.json` (payload check: passed,
  Defender taraması: passed / 0 tehdit); önceki sürüm `SeroGuldCRM-archive\` altında.
- Sürüm pinleri (7 konum, hepsi 0.3.6): release ps1, build-runtime ps1,
  tauri.conf.json, Cargo.toml+lock, iki package.json, backend `app/version.py`.
- Alembic tek head: `0034_market_rate_confirmation`.

## Kapsam (aşama → commit)

| Aşama | İçerik | Commit |
|---|---|---|
| A | Piyasa oranları DKK/g-only sözleşme; profil kalıcılık düzeltmesi (2850→615.50 kökü); Metals.Dev (birincil, DKK/g tek çağrı) + ECB EUR/DKK + Stooq fallback zinciri, kaynak/zaman/bayat rozetleri; canlı mod yalnız oto değerleri (fx/Pt/Pd) besler | b15e4d9 |
| B | AFG v2 workbook sözleşmesi: müşteri değerleri D/G hücrelerinde, CPR workbook/PDF'de yalnız ilk 6 hane; 916/91.60 ve Plet düzeltmeleri; Guldbarre/Sølvbarre satırları (taslak 29/34, tip 6/7, BAR ürünü depoya); kompakt nihai belge (yalnız dolu satırlar, satır 22'den itibaren); C53/C54 footer CellRichText ("Sero Guld" bold); şablon dosyalarına sıfır dokunuş (VBA güvenli) | ef3be6e |
| C | Tarihsel AFG import yeniden yazımı: gerçek 20 dosyayla 20/20 parse (0.3.5'te 0/20 idi); imza-tabanlı satır okuma, CVR→şirket politikası, %25 KDV birebir; preview==apply doğrulama paritesi; orijinal dosya arşivi | d78aa2e |
| D | Excel COM probe: runtime `excel-probe` modu (JSON verdict), Rust katmanlı tespit (registry→COM, 15s, cache), frontend `ipc-error ≠ not-installed` + "Yeniden dene" | 511bc4d |
| E | Uniconta fatura satırları (yerel hidrasyon + Tarih + renkli tutarlar); sürüm tanısı (/health `version`, Tauri `app_version`, dashboard uyuşmazlık mesajı); orphan ModernSettingsPage silindi; Woo katalog (keepPreviousData, 300ms debounce, önizleme token'ı yalnız başarılı apply'da, TTL 15 dk) | a987715 |
| F | OCR fixture sözleşmesi: 20 SPECIMEN görsel + gerçek Windows OCR kaydı (`raw_ocr.json`, harness `scripts/ocr-fixture-harness.ps1`); parser'a Danca etiketli belge dalı (MRZ güvenilmez — basılı etiket kanonik, sundhedskort kimlik belgesi sayılmaz, CPR yalnız ilk 6, adres uydurulmaz); 47 sözleşme testi; **iki üretim hatası düzeltildi:** `-Command` arg'ı `$args`'a bağlanmıyor (tarama yolu boş kalıyordu → `SEROGULD_SCAN_PATH` env) ve `AsTask` overload çözümü (reflection) — kimlik taraması/OCR üretimde bu ikisi yüzünden hiç çalışamazdı | 0942722 |
| G | Sürüm pinleri + gate'ler + release | f278280 |

## Gate sonuçları (release öncesi son koşu)

- Backend: `pytest` → **225 passed, 1 skipped** (skip: 20-dosya manuel kabul,
  `HISTORICAL_AFG_SAMPLE_DIR` ile hedefte koşulur)
- Frontend: `typecheck` → 0 hata; `vitest` → **172 passed (40 dosya)**
- Rust: `cargo check` temiz

## Hedef makinede smoke listesi (kurulum sonrası)

1. **Sürüm eşleşmesi:** Dashboard açılışında hata yoksa tamam; hata olursa mesaj
   artık uç nokta + HTTP kodu + "uygulama vX / çalışma zamanı vY" gösterir.
   `http://127.0.0.1:8100/health` → `{"status":"ok","version":"0.3.6"}`.
2. **Excel probe:** Alış ekranında gömülü workbook başlığındaki Excel durumu;
   Excel kuruluysa COM teyidi "kullanılabilir" demeli, IPC hatasında
   "Yeniden dene" bağlantısı görünmeli.
3. **Uçtan uca AFG:** Barlı alış (Guldbarre/Sølvbarre satırı) → taslak workbook
   satır 29/34 → finalize → kompakt nihai belge: yalnız dolu satırlar, Plet,
   916/91.60, CPR alanında yalnız ilk 6 hane, footer'da bold "Sero Guld";
   BAR ürünleri depoda külçe kategorisinde.
4. **Kimlik taraması:** F'deki üretim onarımları sonrası tarayıcı/dosya OCR'ı
   ilk kez gerçekten çalışacak — sundhedskort ile deneyin (ad + adres + CPR
   ilk 6 otomatik dolmalı, alanlar "inceleyin" rozetiyle gelmeli).
5. **Oto oranlar:** Ayarlar → piyasa oranları çekmecesinde fx/Pt/Pd rozetlerinde
   kaynak (metals.dev/ECB) ve tazelik görünmeli; manuel altın/gümüş alanları
   canlı moddan etkilenmemeli. Sorun olursa
   `backend/app/tools/probe_market_feeds.py` hedefte koşulabilir.
6. **Tarihsel import:** Desktop\import'taki 20 gerçek dosyayla önizleme —
   20/20 "ready", şirket dosyalarında KDV, toplamlar birebir; ikinci kez
   aynı dosya "already_imported".

## Notlar

- OCR fixture kayıtları bu geliştirme makinesinde **tr** dil paketiyle alındı
  (Danca kurulu değil). Hedef makinede Danca paketi varsa doğruluk artar;
  isterseniz `scripts/ocr-fixture-harness.ps1` hedefte yeniden koşulup
  `raw_ocr.json` tazelenebilir — test sözleşmesi değişmez.
- Metals.Dev API anahtarı yalnız `.env` + runtime.env allowlist'inde; repo,
  manifest ve frontend'te yoktur (release payload taraması da doğruladı).
