# Sero Guld Desktop Runtime Protocol

> **Son güncellenme:** 2026-05-18

Bu runbook'un amacı tek bir sorunu çözmek: **kod değişikliği yapıldıktan sonra kullanıcı ile geliştiricinin aynı runtime'a baktığından emin olmak.**

Production desktop kurulum ve release akışı için: `docs/PRODUCTION_DESKTOP_RUNBOOK_TR.md`.

## Kanonik Akış

- Başlat: `make desktop-dev`
- Durum bak: `make desktop-status`
- Temiz yeniden başlat: `make desktop-restart`
- Durdur: `make desktop-stop`

Bu komutlar `.run/desktop-dev-session.json` üzerinden session bilgisini paylaşır.

## Doğru Yorumlama

UI içindeki **Runtime** kartı şu satırları birlikte gösterir:
- `Frontend = Vite Dev` (geliştirme modu)
- `Desktop = Tauri Dev URL`
- `Session = Desktop Dev`
- `Backend = http://127.0.0.1:8100` (port `8100`)

Bu dörtlüden biri farklıysa kullanıcı eski veya ad-hoc bir oturuma bakıyor olabilir.

## Ne Zaman Restart Şart?

- **Tauri/Rust tarafı değiştiyse:** `make desktop-restart`
- **Yalnız frontend source değiştiyse ve runtime kartı `Vite Dev` gösteriyorsa:** restart gerekmez (HMR yeterli).
- **Backend değiştiyse:** uvicorn `--reload` enabled olduğu için otomatik (sadece ağır migration gerekiyorsa restart).
- **Kullanıcı "hâlâ aynı" diyorsa:** önce `make desktop-status` ve UI `Runtime` kartı kontrol edilir; sonra restart kararı verilir.

## Ne Yapılmayacak

- Normal geliştirme sırasında elle `./target/debug/seroguld_crm_desktop` açmak
- `frontend/dist` build alıp onu debug oturumu sanmak
- Aynı anda birden fazla Vite/Tauri oturumu açık bırakmak (port çakışması)
- `.run/desktop-dev-session.json` manuel düzenlemek

## Wayland / Hyprland fallback

`dev.js` otomatik olarak X11 fallback enjekte eder:
- `GDK_BACKEND=x11`
- `WINIT_UNIX_BACKEND=x11`
- `WEBKIT_DISABLE_DMABUF_RENDERER=1`

Bu fallback olmadan `make desktop-dev` Hyprland'de **siyah ekran** çıkarabilir.

## Office / AFG Notu

- `AFG` office dock boş kalırsa ilk bakılacak yer **Runtime kartı** ve **office runtime durumudur** (`GET /api/v2/office-runtime/status?kind=alis-workspace`).
- "Blank dock" sessiz hata değildir; runtime hazır değil, office session eski veya editor yüklenmedi durumlarından biri aranır.
- OnlyOffice/Collabora docker container'ları çalışıyor mu kontrol: `docker ps | grep -E 'onlyoffice|collabora'`

## Doğrulama komutları

| Test türü | Komut | Beklenen |
|---|---|---|
| Frontend typecheck | `cd frontend && npm run typecheck` | 0 hata |
| Frontend test | `cd frontend && npm test` | 15/15 ✓ |
| Frontend smoke | `cd frontend && npm run smoke` | 1/1 Playwright ✓ |
| Backend py_compile | `cd backend && .venv/bin/python -m py_compile app/...` | sessizce başarılı |
| Backend test | `make backend-test` | pytest 32 dosya ✓ |
| Desktop smoke | `make desktop-smoke-doctor` + `make desktop-smoke` | webkit2gtk-driver + tauri-driver yeşil |

## İlgili dökümanlar

- `docs/PROJECT_SYSTEM_GUIDE_TR.md` — Ana sistem dokümantasyonu
- `docs/DESKTOP_SMOKE_PREREQUISITES_TR.md` — webdriver kurulumu
- `docs/PRODUCTION_DESKTOP_RUNBOOK_TR.md` — Production deploy
- `AGENTS.md` — Dev ajan kuralları
