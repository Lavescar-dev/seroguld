# Sero Guld Repo AGENTS.md

Bu dosya `seroguld-crm` için proje-özel çalışma kurallarını kilitler.

## Runtime ve Görünürlük
- UI veya desktop değişikliğinden sonra ilk kontrol runtime fingerprint üstünden yapılır.
- Kullanıcının gördüğü ekran ile kodun aynı oturumda olduğunu varsayma; önce shell içindeki `Runtime` kartını kontrol et.
- Kanonik desktop geliştirme akışı `make desktop-dev` zinciridir.
- `make desktop-status`, `make desktop-stop`, `make desktop-restart` dışındaki ad-hoc desktop süreçleri normal workflow sayılmaz.
- `vite`, `cargo build`, `./target/debug/seroguld_crm_desktop` gibi komutlar ancak açıkça release-benzeri doğrulama istenirse kullanılır.

## Repo Bağlamı
- Bu repo için `ahmetdemir-crm` skill veya o CRM’e ait varsayımlar kullanılmaz.
- Proje bağlamı `seroguld-crm` içindeki kod, `referans/` Excel dosyaları ve bu repo içi dokümantasyondur.
- Üst klasördeki genel AGENTS kuralları geçerlidir; bu dosya yalnız Sero Guld farklarını ekler.

## Doğrulama
- Frontend değişikliğinde en dar doğrulama: `npm run typecheck`
- Backend değişikliğinde en dar doğrulama: ilgili `python3 -m py_compile ...`
- Desktop/Tauri değişikliğinde en dar doğrulama: `cargo check --manifest-path desktop/src-tauri/Cargo.toml`
- Kullanıcı “göremiyorum” dediğinde ilk cevap yeni kod yazmak değil; runtime/source mismatch teşhisi yapmaktır.
