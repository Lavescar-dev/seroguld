# Desktop Smoke Prerequisites

> **Son güncellenme:** 2026-05-18

`make desktop-smoke` için yerelde üç katman hazır olmalı:

1. `cargo` (Rust toolchain)
2. `tauri-driver`
3. `WebKitWebDriver` (Linux) / `msedgedriver` (Windows)

## Önce kontrol

```bash
make desktop-smoke-doctor
```

Bu komut eksik bağımlılıkları listeler ve nasıl kuracağını söyler.

## Local kurulum ipuçları

### Ubuntu / Debian
```bash
cargo install tauri-driver --locked
sudo apt-get install -y webkit2gtk-driver libwebkit2gtk-4.1-dev
```

### Fedora
```bash
cargo install tauri-driver --locked
sudo dnf install -y webkit2gtk4.1-devel
```

### Arch / CachyOS / Manjaro
```bash
cargo install tauri-driver --locked
sudo pacman -S webkit2gtk-4.1
```

### macOS
```bash
cargo install tauri-driver --locked
# WKWebView native; tauri-driver Safari'yi kullanır
```

### Windows
```bash
cargo install tauri-driver --locked
# msedgedriver Edge WebView2 ile gelir; PATH'e ekleyin
```

## Binary sistem PATH'inde değilse

```bash
WEBKIT_WEBDRIVER_BIN=/abs/path/WebKitWebDriver make desktop-smoke
```

`WEBKIT_WEBDRIVER_BIN` verdiğiniz dosya çalıştırılabilir olmalı:
```bash
chmod +x /abs/path/WebKitWebDriver
```

## Notlar

- CI job'u `webkit2gtk-driver` kurup `xvfb-run` altında çalışır (Linux headless).
- Yerelde smoke, canlı kanonik oturuma değil **geçici DB/port/session dosyasına** bağlanır — mevcut `make desktop-dev` oturumunu bozmaz.
- `make desktop-smoke` hata verirse önce `make desktop-smoke-doctor` çalıştırın.
- Önerilen sıra: `make desktop-smoke-doctor` → eksikleri kur → `make desktop-smoke`.
- Windows ve macOS'ta henüz **test edilmedi** — Linux'a göre adaptasyon gerekebilir.

## İlgili dökümanlar

- `docs/DEV_RUNTIME_PROTOCOL.md` — Dev runtime ayar protokolü
- `docs/PRODUCTION_DESKTOP_RUNBOOK_TR.md` — Production deploy
- `Makefile` — `desktop-smoke` ve `desktop-smoke-doctor` target tanımları
