# PLATFORM COMPATIBILITY — Sero Guld CRM

> **Son doğrulama:** 2026-08-09 · **Repo:** `seroguld-crm` · **Branch:** `build/seroguld-feedback-20260610-140000` · **Doğrulama seviyesi:** statik VERIFIED; **WINDOWS_RUNTIME_TESTED=0** (bu ortamda Windows yok)

Runtime türü: **Tauri v2 masaüstü** (Linux'ta WebKitGTK, Windows'ta WebView2) + FastAPI backend. Electron/Qt/.NET değil.

## 1. Doğrulama seviyesi matrisi

| Platform | Statik denetim | CI runtime | Gerçek donanım | Çift monitör |
|---|---|---|---|---|
| Linux / Hyprland | ✅ | ✅ (ubuntu+xvfb desktop shell smoke) | ✅ günlük geliştirme (USER-REPORTED, tutarlı) | ✅ USER-REPORTED iyi çalışıyor |
| Genel Linux | ✅ | ✅ | kısmen | UNKNOWN |
| Windows | ✅ | ✅ yalnız feedback workflow (`/display/idle` DOM render) | ❌ hiç | ❌ hiç |

`docs/DESKTOP_SMOKE_PREREQUISITES_TR.md:68`: "Windows ve macOS'ta henüz test edilmedi" (yerel smoke için). `docs/HANDOVER.md:107,1238`: "WebView2 henüz test edilmedi".

## 2. Beyaz ekran incelemesi (Windows)

Repo'da "white screen" ifadesi yok; kullanıcı raporu + commit serisi analizi (INFERRED birleştirme):

| Commit | Rol |
|---|---|
| `9cfd249` | Frontend clean build fix — kırık build boş/beyaz ekran üretebilirdi (dolaylı) |
| `24f86ee` | **ANA FIX:** Windows'ta `tauri://localhost` navigate desteklenmiyor → `http://tauri.localhost` ayrımı; capabilities'e `customer-display` eklendi; navigasyon best-effort (panic yok); unit test `main.rs:203-212` |
| `e0dfb59` | CI smoke: release exe + gerçek WebView2 ile `[data-testid="customer-display-idle"]` DOM render doğrulaması |
| `664eb7e` | EdgeDriver↔WebView2 versiyon eşleştirme (smoke stabilizasyonu) |
| `af656db` | Modern Alış çalışma alanı ve entegrasyon doğrulama tabanı |

**Neden tam güvence yok:** (1) smoke yalnız feedback workflow'unda — **release workflow'unda smoke yok**; (2) smoke yalnız müşteri ekranı idle route'unu test ediyor, **ana operatör penceresi hiçbir Windows testinde yok**; (3) gerçek donanım + çift monitör hiç koşmadı; (4) release exe'de log yok (§4).

## 3. Statik denetim bulguları

| # | Problem | Kanıt | Platform | Öncelik |
|---|---|---|---|---|
| C1 | Release exe'de teşhis verisi yok: `windows_subsystem="windows"` + sadece `eprintln!` + log plugin yok | `main.rs:1,146` | Windows | P1 |
| C2 | Release workflow'da smoke step yok | `.github/workflows/windows-desktop-release.yml` | Windows | P1 |
| C3 | Backend adresi build-time gömülü (`VITE_API_BASE_URL`, default `http://192.168.1.105:8100`); ağ değişirse installer çalışmaz | release workflow, `lib/api.ts:44-50` | Windows | P1 |
| C4 | Çift monitör Windows'ta hiç test edilmedi; `secondary_monitor_info` davranışı UNKNOWN | `main.rs:248-295` | Windows | P1 |
| C5 | Monitör çıkar/tak ve geçersiz koordinat senaryosu yok; pencere pozisyonu persist edilmiyor (her açılışta canlı okunuyor — bu kısmen iyi) | `main.rs:160-185` | Tümü | P2 |
| C6 | `desktop/scripts/dev.js` POSIX-only (`.venv/bin/python`); Windows'ta handoff `.ps1` zinciri gerekli | `dev.js:31-32` | Windows dev | P2 (workaround var) |
| C7 | Code signing yok → SmartScreen uyarısı | PRODUCTION_DESKTOP_RUNBOOK §6.4 | Windows | P2 |
| C8 | CSP prod'da `unsafe-eval` içeriyor | `tauri.conf.json`; RUNBOOK §8 | Tümü | P1 (güvenlik) |
| C9 | Hyprland Wayland'de DMABUF siyah ekran → dev.js X11 fallback enjekte ediyor (`GDK_BACKEND=x11`, `WINIT_UNIX_BACKEND=x11`, `WEBKIT_DISABLE_DMABUF_RENDERER=1`) | `dev.js:194-217` | Linux/Hyprland | Çözülmüş (VERIFIED) |
| C10 | hyprctl/swaymsg/wmctrl kullanımı YOK — compositor bağımlılığı temiz | grep 0 sonuç | Linux | ✅ |
| C11 | Hard-coded `/tmp`,`/home` kod içinde yok; Linux-only kod `cfg(target_os="linux")` ile izole (zenity/xdg-open; Windows'ta `rfd` fallback) | `main.rs:475-541` | Tümü | ✅ |
| C12 | WebView2 versiyon pin/bootstrapper yok; runtime'ın kurulu olduğu varsayılıyor | workflow `desktop-feedback-windows.yml:73-100` | Windows | P2 |
| C13 | GPU flag / remote debugging / user-data-folder ayarı yok | — | Windows | P3 |
| C14 | DPI/ölçeklendirme testi yok | — | Tümü | P3 |

**Temiz alanlar (VERIFIED):** file:// kullanılmıyor (Tauri custom protocol); hash router → SPA fallback sorunu yok; ESM/CJS ayrımı doğru (`.js`=CJS, `.mjs`=ESM); symlink/chmod bağımlılığı yok; shell process spawn yalnız Linux-gated.

## 4. Önerilen mimari (PROPOSED — bu tur uygulanmadı)

1. **Platformdan bağımsız çekirdek:** iş kuralları backend'de kalır (zaten öyle); UI durumu OS'ten bağımsız. Mevcut yapı buna büyük ölçüde uygun.
2. **Platform adaptörleri:** Rust shell'de pencere/monitör/diyalog/log yolları tek modülde toplansın; Hyprland X11 fallback `dev.js`'te izole kalsın (ana çekirdeğe gömülmesin — şu an doğru).
3. **İki-pencere mimarisi:**
   - Uygulama ekranları kendisi keşfeder (mevcut `available_monitors()` yaklaşımı korunur).
   - **Yeni:** ayarlardan hangi ekranın müşteri ekranı olduğu seçilebilsin (şu an "ilk ikincil monitör" varsayımı var — `main.rs:248-295`).
   - Monitör yoksa tek monitör fallback + operatör önizlemesi (`/musteri-ekran` mevcut) → kullanıcıya açık bildirim.
   - Monitör çıkar/tak olayında kilitlenme olmamalı; pencere yeniden konumlandırma (test gerekli).
   - Müşteri ekranında operatör verisi görünmez (mevcut invariant — korunur).
4. **Windows first-class test target:**
   - `windows-desktop-release.yml`'e feedback workflow'undaki smoke'un aynısı + **ana pencere render smoke'u** eklensin.
   - Her release için paketlenmiş exe açılış + login ekranı render artifact'ı saklansın.
   - Düzenli **gerçek Windows + gerçek çift monitör** kabul testi tanımlansın (checklist aşağıda).
5. **Beyaz ekran yerine tanılanabilir hata:**
   - Startup aşamaları loglansın (Tauri log plugin veya basit dosya logger; main/preload/renderer ayrı).
   - Kritik asset/servis bulunamazsa kullanıcıya hata ekranı (`DisplayRouteErrorBoundary` deseni genişletilsin).
   - Safe mode (GPU-disabled) teşhis bayrağı; log yolu UI'dan açılabilsin.

### Windows kabul testi checklist'i (yapılacak)

- [ ] Paketlenmiş NSIS exe temiz Windows'ta açılıyor; ana pencere render oluyor.
- [ ] Login → Alış akışı uçtan uca (test müşterisiyle, canlı veri YOK).
- [ ] İkinci monitörde müşteri ekranı fullscreen açılıyor; tek monitörde düzgün fallback.
- [ ] Monitör çıkar/tak sonrası uygulama kilitlenmiyor.
- [ ] Backend'e 105 dışı bir ağdan bağlanıldığında davranış (C3).
- [ ] Log dosyası konumu ve içeriği doğrulanıyor.

## 5. Gereken testler (kesin doğrulama için)

| İddia | Gereken test |
|---|---|
| Beyaz ekran fix'i kalıcı | Release workflow smoke + gerçek donanım açılış testi |
| Çift monitör Windows'ta çalışıyor | Gerçek Windows + 2 monitör kabul testi |
| DPI scaling sorunsuz | %125/%150 ölçekli Windows'ta görsel kontrol |
