# Sero Guld CRM Feedback EXE Pilot

Bu paket müşteri geri bildirimi için tasarlanmış ara sürümdür. EXE içindeki frontend Tauri ile gömülü çalışır; veri, auth ve entegrasyonlar canlı demo VPS backend üzerinden gelir.

## Varsayılan Pilot Hedefi

- API: `https://seroguld.193.234.88.63.sslip.io`
- WebSocket: `wss://seroguld.193.234.88.63.sslip.io`
- Feedback kanalı: `vps-feedback-pilot`
- Feedback e-postası: `info@seroguld.dk` varsayılandır; dağıtım öncesi gerekiyorsa override edilmelidir.

## Windows EXE Üretimi

GitHub Actions ile:

1. `desktop-feedback-windows` workflow'unu manuel çalıştır.
2. `api_base_url`, `ws_base_url`, `feedback_email`, `feedback_channel` inputlarını kontrol et.
3. Artifact olarak `SERO_GULD_CRM_feedback_windows` indir.
4. Beklenen çıktı: `desktop/src-tauri/target/release/bundle/nsis/*.exe`.

Linux geliştirici makinesi frontend/typecheck doğrulaması için uygundur; final Windows `.exe` çıktısı GitHub `windows-latest` runner üzerinde alınır.

## Pilot Öncesi Güvenlik

- EXE içine kullanıcı adı veya parola gömülmez.
- Müşteri login ekranından giriş yapar.
- Toplantıda paylaşılan zayıf/geçici parola pilot öncesi değiştirilmeli ve yeni parola ayrı kanaldan paylaşılmalıdır.
- Trusted code signing için gerçek sertifika veya Microsoft Trusted Signing hesabı gerekir. Self-signed imza SmartScreen/Unknown Publisher sorununu düzgün çözmez; ilk pilot unsigned NSIS installer olarak dağıtılır.

## Smoke Checklist

- Installer kuruluyor ve uygulama açılıyor.
- Login başarılı.
- Dashboard, Alış/POS, Depolama, OPMC, WooCommerce, Uniconta ve Ayarlar ekranları açılıyor.
- Woo ürün görselleri yükleniyor.
- Yeni ürün fotoğrafı AVIF upload/media sync akışına düşüyor.
- Feedback butonu mail taslağı açıyor ve ekran/API/runtime bilgisini ekliyor.
- Beklenmeyen 401/403/500 yok.
