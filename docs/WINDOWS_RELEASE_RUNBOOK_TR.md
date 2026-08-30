# Docker'sız Windows Installer Üretim Kılavuzu

> Son güncelleme: 2026-08-30
>
> Güncel örnek sürüm: `0.3.25`
>
> Kanonik script: `scripts/release-windows-native.ps1`

Bu belge Sero Guld CRM'nin Docker, WSL, sistem Python'u veya scheduled task
gerektirmeyen Windows NSIS installer'ını yeniden üretmek için kanonik
kılavuzdur. Eski uzak-backend/Tauri akışı bu sürüm için kullanılmaz.

## 1. Çıktının mimarisi

Installer şu bileşenleri birlikte taşır:

- Tauri masaüstü uygulaması ve embedded Vite frontend
- PyInstaller `onedir` biçimindeki `seroguld-runtime.exe`
- SQLite migration'ları ve uygulama bağımlılıkları
- Offline WebView2 installer
- SG uygulama/installer ikonları
- NSIS güncelleme ve eski Sero Guld kalıntılarını temizleme hook'ları

Kurulan uygulama yalnızca `127.0.0.1:8100` üzerindeki kendi sidecar backend'ine
bağlanır. Docker Desktop, WSL, Python, Node.js, Rust, OnlyOffice veya Windows
servisi müşteri bilgisayarına kurulmaz.

## 2. Kaynak ve gizli ayarlar

Release yalnızca adı `seroguld-crm-latest-windows` olan repo kökünden alınır.
Müşteri entegrasyon ayarları repo kökündeki, Git tarafından ignore edilen
`.env` dosyasından allowlist ile alınır. Release script'i gerekli WooCommerce,
WordPress ve Uniconta alanları yoksa build'i durdurur.

Önemli kurallar:

- `.env`, `runtime.env`, `production.env` ve `runtime-seed.env` commit edilmez.
- `FIELD_ENCRYPTION_KEY`, JWT secret'ları, ilk admin parolası, DB/path ayarları
  installer seed'ine alınmaz.
- Allowlist seed installer içinde geçici olarak bulunur; elevated kurulumda
  `%PROGRAMDATA%\SeroGuldCRM\config\runtime.env` içine atomik taşınır ve kurulu
  Program Files altındaki seed silinir.
- NSIS arşivi çıkarılabilir olduğu için müşteri installer'ı gizli/özel teslimat
  dosyası olarak saklanmalıdır.
- GitHub Actions build'i `.env` girdisini
  `SEROGULD_CUSTOMER_RUNTIME_ENV_B64` repository secret'ından oluşturur ve her
  durumda siler.

## 3. Build makinesi gereksinimleri

Yerel release makinesinde şunlar gerekir:

- Windows 11 x64
- Windows PowerShell 5.1
- Git
- Node.js/npm
- Rust stable ve MSVC Windows toolchain
- Python 3.12 (yalnız build makinesinde)
- Microsoft Defender etkin
- NanaZip/7-Zip komut satırı aracı
- En az yaklaşık 2 GiB güvenli boş disk alanı

Bunların hiçbiri müşteri bilgisayarında gerekli değildir.

## 4. Release öncesi kontrol

Repo kökünde:

```powershell
git status --short
git diff --check
cd frontend
npm ci
npm run typecheck
npm test
cd ..\backend
.\.venv\Scripts\python.exe -m pytest -q
cd ..
```

Migration tek head olmalıdır:

```powershell
cd backend
.\.venv\Scripts\python.exe -m alembic heads
cd ..
```

Windows installer migration/ACL fixture'ı:

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
  -File scripts\windows-installer-smoke.ps1
```

## 5. Tek komutla release

Repo kökünden çalıştır:

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
  -File scripts\release-windows-native.ps1 `
  -Finalize
```

Defender taraması artık **varsayılan olarak koşar**; eski `-RunDefenderScan`
bayrağı kabul edilir ama davranışı değiştirmez (geriye dönük uyumluluk).
Müşteri teslimatı (`-Finalize`) bu taramayı atlayamaz — `-Finalize` ile
`-SkipDefenderScan` birlikte verilemez, script hata verir.
`-SkipDefenderScan` yalnız kontrollü geliştirme/teşhis build'lerindir.

Code signing sertifikası varsa thumbprint'i geç (yoksa boş bırak; manifestte
`code_signed=false` olur ve installer "unknown publisher" uyarısı verir):

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
  -File scripts\release-windows-native.ps1 `
  -Finalize `
  -SignCertificateThumbprint '<SERTIFIKA-THUMBPRINT>'
```

Daha önce doğrulanmış bir Windows runtime build cache'i varsa C: disk alanını ve
süreyi azaltmak için:

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
  -File scripts\release-windows-native.ps1 `
  -Finalize `
  -RuntimeBuildDirectory '\\wsl.localhost\archlinux\home\lavescar\seroguld-build-cache\windows-runtime-build-YYYYMMDD-NNN'
```

Cache yalnız script'in kaynak fingerprint kontrolü geçerse kullanılır. Kaynak
değişmişse `scripts/build-windows-runtime.ps1` ile yeniden üretilir; elle runtime
dosyası kopyalanmaz.

## 6. Script'in uyguladığı zorunlu kapılar

`release-windows-native.ps1` sırasıyla:

1. Doğru repo, sürüm, NSIS/zlib, per-machine ve offline WebView2 ayarlarını doğrular.
   Sürüm otomasyonu: tek kaynak `desktop/package.json` `version` alanıdır; script
   bunu 8 ayrı yerde (tauri.conf.json, frontend/package.json, release manifesti vb.)
   çapraz doğrular ve uyuşmazlıkta build'i durdurur.
2. Kaynak dosya fingerprint'ini ve runtime build manifestini karşılaştırır.
3. PyInstaller `onedir` runtime'ını üretir veya doğrulanmış cache'i kullanır.
4. Packaged runtime üzerinde migrate, health, bootstrap ve temiz admin login smoke'u çalıştırır.
5. Embedded frontend'i yalnız `http://127.0.0.1:8100` hedefiyle build eder.
6. Tauri/NSIS installer'ı üretir; updater için `.sig` imzası ve `latest.json`
   üretir (`TAURI_SIGNING_PRIVATE_KEY` + `_PASSWORD` gerekir).
7. Payload içinde yasaklı Docker/WSL/OnlyOffice/Python CLI/debug/env kalıntısı arar.
8. SG ikon frame'lerini installer ve desktop EXE içinde doğrular.
9. UPX kullanılmadığını ve NSIS'in yalnız Deflate/zlib içerdiğini doğrular.
10. NanaZip ile installer bütünlük testi ve Microsoft Defender özel taraması yapar
    (tarama varsayılan açıktır; `-SkipDefenderScan` yalnız `-Finalize` dışında
    kabul edilir).
11. Mevcut Downloads installer'ını hash/manifest sidecar'larıyla arşivler.
12. Yeni installer, SHA-256 sidecar ve manifesti Downloads'a atomik yayınlar.

Bir kapı başarısız olursa `-Finalize` eski Downloads teslimatını geri yükler;
yarım installer son dosya olarak bırakılmaz.

## 7. Çıktılar

Başarılı yerel release sonunda:

```text
C:\Users\<kullanıcı>\Downloads\SERO-GULD-CRM-FULL-SETUP.exe
C:\Users\<kullanıcı>\Downloads\SERO-GULD-CRM-FULL-SETUP.exe.sha256
C:\Users\<kullanıcı>\Downloads\SERO-GULD-CRM-FULL-SETUP.manifest.json
C:\Users\<kullanıcı>\Downloads\SeroGuldCRM-archive\...
```

Ara kopyalar:

```text
.run\windows-native-release\SERO-GULD-CRM-FULL-SETUP.exe
.run\windows-native-release\SERO-GULD-CRM-FULL-SETUP.exe.sha256
.run\windows-native-release\SERO-GULD-CRM-FULL-SETUP.exe.sig
.run\windows-native-release\latest.json
.run\windows-native-release\release-manifest.json
desktop\src-tauri\target\release\bundle\nsis\...
```

`.sig` (minisign imzası) ve `latest.json` Tauri updater v2 içindir: updater
`https://github.com/Lavescar-dev/seroguld/releases/latest/download/latest.json`
uçuna bakar; bu yüzden `.sig` + `latest.json` + installer birlikte, aynı
sürüme ait olacak şekilde GitHub Releases'a yüklenir.

`.run`, Cargo target ve `desktop/src-tauri/runtime/seroguld-runtime` generated
çıktıdır; commit edilmez.

## 8. Son teslim doğrulaması

```powershell
$exe = "$env:USERPROFILE\Downloads\SERO-GULD-CRM-FULL-SETUP.exe"
$expected = (Get-Content "$exe.sha256" -Raw).Split()[0].ToLowerInvariant()
$actual = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'Installer hash uyuşmuyor' }

$manifest = Get-Content `
  "$env:USERPROFILE\Downloads\SERO-GULD-CRM-FULL-SETUP.manifest.json" `
  -Raw | ConvertFrom-Json
if (-not $manifest.final_copy_performed -or
    $manifest.final_destination_sha256 -ne $actual -or
    $manifest.defender_scan -ne 'passed' -or
    $manifest.defender_scan_threat_count -ne 0) {
  throw 'Release manifest doğrulaması başarısız'
}
```

## 9. Müşteri bilgisayarında kurulum

1. Eski CRM açıksa kapat.
2. Installer'a çift tıkla ve UAC istemine `Evet` de.
3. Kurulum tamamlanınca masaüstündeki `SERO GULD CRM` kısayolunu aç.
4. Temiz kurulumda `info@seroguld.dk` / `admin` ile giriş yap ve zorunlu yeni parolayı belirle.
5. Login, dashboard, Ayarlar piyasa oranı, Woo ve Uniconta bağlantısını kontrol et.

Kurulum yolları:

```text
C:\Program Files\Sero Guld CRM
C:\ProgramData\SeroGuldCRM
```

Güncelleme mevcut veritabanını, belgeleri, fotoğrafları, entegrasyon ayarlarını,
logları ve yedekleri korur. Installer eski Sero Guld scheduled task/process ve
Sero Guld'a özel OnlyOffice container kalıntılarını temizler; Docker Desktop'ı
bilgisayardan kaldırmaz.

## 10. Updater akışı (0.3.26+)

Kurulu uygulama kendini güncelleyebilir (Tauri updater v2, Rust-side):

1. Müşteri makinesinde uygulama açıldıktan **~20 sn sonra** sessiz kontrol
   yapılır; hiçbir şey yoksa kullanıcı bir şey görmez.
2. Yeni sürüm varsa kurulum **passive mod**'da başlar (ilerleme çubuğu) ve UAC
   istemi çıkar; kullanıcı `Evet` derse installer kendisi kapanıp yeniden kurulur.
3. Uç: GitHub Releases `latest/download/latest.json`; imza doğrulaması
   `tauri.conf.json` içine gömülü `plugins.updater.pubkey` ile yapılır.

Operasyon notları:

- **Excel bridge / canlı Office dock açıkken kurulum önerilmez.** Güncelleme
  diyaloğu çıkmadan önce açık çalışma kitaplarını kaydedip kapatın; yoksa
  kurulum sonrası oturum yeniden açılır.
- Açılışta uygulama, sidecar backend'in `127.0.0.1:8100` üzerinde hazır
  olmasını **30 sn'ye kadar** bekler; süre aşılırsa hata yüzeyi çıkar ve
  başlatma tekrar denenebilir (`retry_desktop_startup`).
- Güncelleme yayınlandıktan sonra müşteri makinesinin görmesi için
  `latest.json` + installer + `.sig` üçlüsünün aynı release'e yüklenmiş olması
  gerekir (bkz. §7).

## 11. Sorun giderme

Başlangıç logları:

```text
C:\ProgramData\SeroGuldCRM\logs\desktop.log
C:\ProgramData\SeroGuldCRM\logs\backend.log
%TEMP%\SeroGuldCRM\logs\runtime-migrate.log
```

Kontrol sırası:

1. Installer manifest/hash eşleşiyor mu?
2. `seroguld-runtime.exe serve` çalışıyor ve yalnız 8100 loopback dinliyor mu?
3. Alembic migration head güncel mi?
4. `runtime.env` ACL'si kullanıcı, SYSTEM ve Administrators için erişilebilir mi?
5. Backend logunda migration, encryption key veya hash compatibility hatası var mı?
6. Aynı eski installer yanlışlıkla yeniden mi kurulmuş?

Release script'inin gate'ini `-SkipRuntime`, `-SkipFrontend` veya `-SkipTauri`
ile müşteri teslimatında atlamayın. Bu bayraklar yalnız kontrollü geliştirme
teşhisi içindir.
