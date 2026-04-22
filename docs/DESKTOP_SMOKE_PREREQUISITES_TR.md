# Desktop Smoke Prerequisites

`make desktop-smoke` için yerelde üç katman hazır olmalı:

1. `cargo`
2. `tauri-driver`
3. `WebKitWebDriver`

Önce kontrol:

```bash
make desktop-smoke-doctor
```

## Local kurulum ipuçları

Ubuntu / Debian:

```bash
cargo install tauri-driver --locked
sudo apt-get install -y webkit2gtk-driver
```

Fedora:

```bash
cargo install tauri-driver --locked
sudo dnf install -y webkit2gtk4.1-devel
```

Arch:

```bash
cargo install tauri-driver --locked
sudo pacman -S webkit2gtk
```

Binary sistem PATH'inde değilse:

```bash
WEBKIT_WEBDRIVER_BIN=/abs/path/WebKitWebDriver make desktop-smoke
```

`WEBKIT_WEBDRIVER_BIN` verdiğiniz dosya çalıştırılabilir olmalı:

```bash
chmod +x /abs/path/WebKitWebDriver
```

## Notlar

- CI job'u `webkit2gtk-driver` kurup `xvfb-run` altında çalışır.
- Yerelde smoke, canlı kanonik oturuma değil geçici DB/port/session dosyasına bağlanır.
- `make desktop-smoke` hata verirse önce `make desktop-smoke-doctor` çalıştırın.
- Önerilen sıra: `make desktop-smoke-doctor` -> eksikleri kur -> `make desktop-smoke`.
