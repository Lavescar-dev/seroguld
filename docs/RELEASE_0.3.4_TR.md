# Sero Guld CRM 0.3.4 Windows Teslim Raporu

> Üretim tarihi: 2026-08-13
>
> Kaynak branch: `build/seroguld-feedback-20260610-140000`
>
> Migration head: `0034_market_rate_confirmation`

## Teslim dosyası

```text
C:\Users\Lavescar\Downloads\SERO-GULD-CRM-FULL-SETUP.exe
Boyut: 264,822,060 byte
SHA-256: a6e7f79edc7a07ee9d9f1c50f2a3f942a08e99145caa86e69a012b9829221acc
```

Yan dosyalar:

```text
SERO-GULD-CRM-FULL-SETUP.exe.sha256
SERO-GULD-CRM-FULL-SETUP.manifest.json
```

Installer binary'si Git'e commit edilmez. Kaynak, build scriptleri ve bu rapor
Git'tedir; teslim binary'si Downloads ve kontrollü müşteri teslim kanalında
tutulur.

## Bu sürümdeki ana teslimler

- Docker/WSL/OnlyOffice bağımlılığı kaldırılmış yerel Windows desktop mimarisi
- PyInstaller `onedir` görünmez backend sidecar ve Job Object kapanış yönetimi
- Migration, ACL, encryption-key recovery ve tanı logu düzeltmeleri
- Her açılışta login; Windows Credential Manager ile parola hatırlama
- İlk girişte zorunlu parola değiştirme ve Ayarlar içinden parola değiştirme
- Modern açık renk startup/login/dashboard/settings yüzeyleri
- Modern ve klasik topbar'da güvenli çıkış
- SG installer/uygulama ikonu
- Embedded çalışma sayfası, hücre autosave/revision ve Excel bridge altyapısı
- WooCommerce canlı katalog preview/apply akışı
- Uniconta bağlantı, gizli ayar koruma, tarih ve işaretli tutar görünümü
- Satın alma KDV kodu ayarları
- Yerel dashboard, piyasa oranı günlük onayı ve backup health yüzeyi
- Tek kanonik piyasa canlı/mod ayarı; Ayarlar ve Au/Ag çekmecesi senkronizasyonu
- Yerel backup yaşam döngüsü ve restore doğrulama yüzeyleri

## Doğrulama sonucu

| Kapı | Sonuç |
|---|---|
| Backend pytest | 192 geçti |
| Frontend Vitest | 35 dosya / 109 test geçti |
| TypeScript typecheck | Geçti |
| Installer migration/ACL tr-TR smoke | Geçti |
| Packaged runtime migrate/serve/login | Geçti |
| Packaged piyasa ayarı sözleşmesi | Ayarlar=false, çekmece=false, source=manual, değerler eşit |
| Frontend backend hedefi | Yalnız `http://127.0.0.1:8100` |
| Runtime payload hash eşleşmesi | Geçti |
| SG ikon frame doğrulaması | Installer 7/7, desktop 7/7 |
| NanaZip bütünlük | `Everything is Ok`, NSIS Deflate |
| UPX kontrolü | Yok |
| Defender özel tarama | Geçti, 0 tehdit |
| `gcapi.dll` | Installer dışında ve build öncesi/sonrası değişmedi |

Packaged runtime SHA-256:

```text
2100df9c02d744f1c76e67ac80ef3fe2d8687962af8d8d4dfc1c52b89397749a
```

## Yeniden üretim

Kanonik komut:

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
  -File scripts\release-windows-native.ps1 `
  -Finalize `
  -RunDefenderScan
```

Detaylı ve cache destekli prosedür:
[`WINDOWS_RELEASE_RUNBOOK_TR.md`](WINDOWS_RELEASE_RUNBOOK_TR.md)

## Bilinen operasyon notları

- Kod imzalama sertifikası kullanılmıyor; Windows yayıncı uyarısı gösterebilir.
- Excel zorunlu değildir; yalnız `Excel'de aç` özelliği için Microsoft Excel gerekir.
- Temel CRM yerel çalışır; WooCommerce, WordPress, Uniconta ve canlı fiyatlar için internet gerekir.
- Güncellemede `%PROGRAMDATA%\SeroGuldCRM` altındaki müşteri verisi korunur.
- Yeni bilgisayar temiz kurulum parolası `admin`dir ve ilk girişte değiştirilir.
