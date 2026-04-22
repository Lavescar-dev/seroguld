# GDPR Tauri Smoke

## Hedef
- Desktop/Tauri içinde GDPR cockpit ve public bridge yüzeylerinin operatör gözüyle doğrulanması.

## Ön Koşul
- `make desktop-dev`
- admin login tamam
- backend reachable

## Kontrol Listesi
1. Sidebar’dan `GDPR` modülünü açın.
2. `Overview` kartlarında queued/failed job ve scan/run zamanları görünmeli.
3. `Requests` listesi render olmalı; bir request seçildiğinde detail drawer yerine detail panel açılmalı.
4. `WordPress Bridge` kartında privacy/cookies/request URL’leri ve cookie-config endpointi görünmeli.
5. `Jobs` panelinde yakın tarihli runner/request job kayıtları görünmeli.
6. Customer modülünden `GDPR Dossier` deep-link’i ile `/gdpr?customer=<id>` açılmalı.
7. Yeni bir public request oluşturup admin verify/approve/execute akışını deneyin.
8. Export request tamamlanınca `Export indir` çalışmalı.
9. Pseudonymize request sonrası ilgili customer detail’de `gdpr_status = pseudonymized` görünmeli.

## Scripted Yardımcı Kontrol
- `make gdpr-smoke`
- `make gdpr-smoke-live`

`make gdpr-smoke` temp backend ile çalışır ve canlı veriyi mutate etmez.

`make gdpr-smoke-live` ise mevcut backend üzerinde public request, verify/approve/execute, export download ve pseudonymize akışını doğrular; yalnız bilinçli canlı operasyon doğrulaması için kullanılmalıdır.
