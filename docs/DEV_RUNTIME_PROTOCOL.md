# Sero Guld Desktop Runtime Protocol

Bu runbook’un amacı tek bir sorunu çözmek: kod değişikliği yapıldıktan sonra kullanıcı ile geliştiricinin aynı runtime’a baktığından emin olmak.

Production desktop kurulum ve release akışı için: `docs/PRODUCTION_DESKTOP_RUNBOOK_TR.md`

## Kanonik Akış
- Başlat: `make desktop-dev`
- Durum bak: `make desktop-status`
- Temiz yeniden başlat: `make desktop-restart`
- Durdur: `make desktop-stop`

## Doğru Yorumlama
- `Runtime` kartı `Frontend`, `Desktop`, `Backend` ve `Session` satırlarını birlikte gösterir.
- Beklenen geliştirme modu:
  - `Frontend = Vite Dev`
  - `Desktop = Tauri Dev URL`
  - `Session = Desktop Dev`
- Bu üçlüden biri farklıysa kullanıcı eski veya ad-hoc bir oturuma bakıyor olabilir.

## Ne Zaman Restart Şart
- Tauri/Rust tarafı değiştiyse: `make desktop-restart`
- Yalnız frontend source değiştiyse ve runtime kartı `Vite Dev` gösteriyorsa restart gerekmez.
- Kullanıcı “hala aynı” diyorsa önce `make desktop-status` ve UI `Runtime` kartı kontrol edilir; sonra restart kararı verilir.

## Ne Yapılmayacak
- Normal geliştirme sırasında elle `./target/debug/seroguld_crm_desktop` açmak
- `frontend/dist` build alıp onu debug oturumu sanmak
- Aynı anda birden fazla Vite/Tauri oturumu açık bırakmak

## Office / AFG Notu
- `AFG` office dock boş kalırsa ilk bakılacak yer runtime kartı ve office runtime durumudur.
- “Blank dock” sessiz hata değildir; runtime hazır değil, office session eski ya da editor yüklenmedi durumlarından biri aranır.
