# CURRENT STATE AND ROADMAP — Sero Guld CRM

> **Son doğrulama:** 2026-08-09 · **Repo:** `seroguld-crm` · **Branch:** `build/seroguld-feedback-20260610-140000` · **Doğrulama seviyesi:** VERIFIED

## 1. Tamamlananlar (IMPLEMENTED)

- **2026-08-09 güvenilirlik paketi:** Alış workspace yazıları SQLite-safe revision CAS ile korunuyor; autosave kuyruğu seri ve yeniden denenebilir; açıkça temizlenen AFG/müşteri/posta kodu alanları `null` olarak uygulanıyor; 4 haneli Danimarka posta kodu mevcut müşteri düzenleme yolunda da doğrulanıyor; sabit katalog satırları yalnızca aktif/"satır ekle" görünümünde tutuluyor.
- **Office/OnlyOffice lineage:** Aynı açık belgeden gelen ikinci stale callback artık 409 `stale_lineage` ile reddediliyor ve arayüzde yeniden açma/çatışma bilgisi gösteriliyor; başarılı core workspace kaydı başarısız artifact projection yüzünden geri alınmıyor.
- **Desktop recovery:** Tauri bekleyen alış taslağı OS credential store anahtarıyla AES-GCM şifreli, atomik yazımlı ve boyut/TTL/path sınırlarıyla geri alınabilir.
- AFG alış akışı uçtan uca (workspace → satırlar → müşteri → finalize → belge → Uniconta sync).
- Müşteri yönetimi (şifreli kimlik alanları, arama, risk).
- Depolama envanteri (filtre/sort/foto/etiket/source-afg/workbook).
- Log (AFG defteri) + route kararları + melt lot yaşam döngüsü + history.
- WooCommerce publish + webhook satış + import; OPMC anti-fraud; GDPR modülü (retention + public formlar + runner).
- Müşteri ekranı (2. monitör, WS canlı, maskeli veri) — Linux.
- Excel import/export + OnlyOffice canlı dock.
- GFS yedekleme + offsite + restore drill altyapısı.
- Windows beyaz ekran fix'i + CI feedback smoke.

## 2. Kısmi işler (PARTIAL)

- **Satış:** legacy POS + Woo webhook çalışıyor; modern satış modülü yok; trade_side teknik borcu.
- **WordPress köprüsü:** snippet + public endpoint var; PHP plugin paketleme scripti kırık (dosya eksik).
- **Raporlar:** backend + export var; UI sayfası route'suz (erişilemez).
- **AI sayfası:** backend var; UI route'suz.
- **Windows doğrulama:** CI smoke yalnız feedback kanalında ve tek route'ta.

## 3. Kritik eksikler (MISSING / BROKEN)

- Release workflow'da Windows smoke.
- Release exe'de startup loglaması / hata yüzeyleme.
- Koyu/açık tema: toggle no-op (BROKEN); kullanıcı arayüzü fazla koyu buluyor.
- Yedek şifreleme; rate-limit/CSRF; prod CSP `unsafe-eval`; 2FA; TLS (nginx plain HTTP).
- Modern satış modülü (DISCOVERY önce).
- Platin müşteri ekranı bloğu (TODO).

## 4. Öncelikli backlog

**P0 — veri/güvenlik/finansal risk**
| ID | Başlık | Durum | Efor | Kanıt |
|---|---|---|---|---|
| SEC-01 | Yedekler şifresiz (CPR içeren plaintext) | MISSING | M | `scripts/backup-gfs.sh`, AUDIT §5.5 |
| SEC-02 | Rate-limit/CSRF yok; auth yüzeyi korumasız | MISSING | M | AUDIT §2.1 |
| SEC-03 | Prod CSP `unsafe-eval` + nginx TLS yok | MISSING | S-M | `tauri.conf.json`, `nginx/nginx.conf` |

**P1 — ana akış / Windows güvenilirliği**
| ID | Başlık | Durum | Efor | Kanıt |
|---|---|---|---|---|
| WIN-01 | Release workflow'a Windows display smoke + ana pencere smoke ekle | MISSING | S | `windows-desktop-release.yml` |
| WIN-02 | Release exe startup loglaması + hata ekranı (sessiz beyaz ekran önleme) | MISSING | M | `main.rs:1,146` |
| WIN-03 | Backend adresi runtime yapılandırılabilir olsun (build-time gömülü 105 IP) | MISSING | M | `lib/api.ts:44-50` |
| WIN-04 | Gerçek Windows + çift monitör kabul testi (checklist PLATFORM_COMPATIBILITY §4) | MISSING | S | `main.rs:248-295` |
| OPS-01 | `.env` secret rotation + `INITIAL_ADMIN_AUTO_SEED` prod kapatma | PARTIAL | S | `config.py:136-185` |

**P2 — önemli, workaround var**
| ID | Başlık | Durum | Efor |
|---|---|---|---|
| THEME-01 | Açık tema dönüşümü (token'lar + 120 koyu blok) | PLANNED | L |
| UI-01 | Raporlar + AI sayfalarını route'a bağla veya ölü kodu kaldır | PARTIAL | S |
| DOC-01 | `package-wordpress-bridge.sh` ↔ eksik PHP plugin çelişkisini çöz | BROKEN | S |
| WIN-05 | Müşteri ekranı monitör seçimi ayarı + çıkar/tak dayanıklılığı | MISSING | M |
| WIN-06 | Code signing | MISSING | M |

**P3 — iyileştirme**
| ID | Başlık | Efor |
|---|---|---|
| UI-02 | Platin müşteri ekranı bloğu | S |
| OPS-02 | `seroguld_crm.db` artık dosya temizliği + `docs/README.md` `referans/` düzeltmesi | S |
| TECH-01 | Satış trade_side enum teknik borcu (SALES sonrası) | M |
| WIN-07 | DPI/scaling testleri, WebView2 bootstrapper | S |

**DISCOVERY — karar gerekli**
| ID | Konu |
|---|---|
| SALES-00 | Satış iş kuralları (iade, kredi notu, fiyat politikası, tezgâh satışı vs web satışı) |
| EXCEL-00 | Cutover durumu: Excel hâlâ paralel yazılıyor mu? |
| WP-00 | Site-CRM iletişim hedefinin kapsamı |
| OPMC-00 | "OPMC" kısaltmasının resmî açılımı (belgelenmemiş) |

## 5. İlk 10 iş (önerilen sıra)

1. **SALES-00** — Satış iş kurallarını kullanıcıyla netleştir (kod yok, toplantı/not).
2. **WIN-01** — Release workflow smoke (mevcut feedback smoke'u kopyala + ana pencere).
3. **WIN-02** — Startup loglaması + hata ekranı.
4. **SEC-01** — Yedek şifreleme.
5. **WIN-04** — Gerçek Windows çift monitör kabul testi.
6. **SEC-02** — Rate-limit + CSRF.
7. **WIN-03** — Runtime backend adresi.
8. **SEC-03** — CSP sıkılaştırma + TLS.
9. **OPS-01** — Secret rotation.
10. **THEME-01** — Açık tema dönüşümü (iş paketi hazır: rapor `ui-theme-audit.md`).

## 6. Bağımlılıklar

- THEME-01 → UI-01 (ölü sayfalar tema dönüşümünden önce temizlenirse efor düşer).
- TECH-01 → SALES-00 kararı.
- WIN-04 → WIN-01/WIN-02 (teşhis altyapısı önce).
- DOC-01 → WP-00 kararı.

## 7. Küçük bağlamlı Codex iş paketleri

Her paket tek oturumda tamamlanabilir. Canlı veri kısıtı: tüm paketlerde gerçek müşteri/işlem verisi oluşturulmaz; canlı Woo/WP/Uniconta'ya yazılmaz.

### Paket WP-WIN-01: Release workflow smoke
- **Amaç:** `windows-desktop-release.yml`'e display + ana pencere smoke step.
- **Okunacak:** `.github/workflows/windows-desktop-release.yml`, `desktop-feedback-windows.yml` (smoke step), `desktop/tests/windows-display-smoke.mjs`.
- **Değiştirilebilecek:** release workflow + `desktop/tests/` altına yeni smoke script.
- **Kabul:** CI'da release exe açılır, `/display/idle` ve ana pencere DOM render doğrulanır; artifact log saklanır.
- **Risk:** CI süresi uzar. **Rollback:** workflow step'i revert.

### Paket WP-WIN-02: Startup loglaması
- **Amaç:** main/preload/renderer hatalarını dosyaya yazan minimal logger + kullanıcıya hata yüzeyi.
- **Okunacak:** `desktop/src-tauri/src/main.rs`, `frontend/src-v2/app.tsx` (ErrorBoundary deseni), `docs/PRODUCTION_DESKTOP_RUNBOOK_TR.md` §9.
- **Değiştirilebilecek:** `main.rs`, capabilities, gerekiyorsa frontend error boundary.
- **Kabul:** release exe'de kasıtlı asset hatası → log dosyası + ekranda hata mesajı; `cargo check` temiz.
- **Risk:** düşük. **Rollback:** tek commit revert.

### Paket WP-SEC-01: Yedek şifreleme
- **Amaç:** `backup-gfs.sh` çıktısını GPG/openssl ile şifrele (anahtar repo dışı), restore drill'i güncelle.
- **Okunacak:** `scripts/backup-gfs.sh`, `backup-verify.sh`, `backup-restore-drill.sh`, `config.py` backup bölümü.
- **Kabul:** yeni yedek şifreli; drill şifreli yedekten restore ediyor; eski şifresiz yedekler dokunulmadan kalır.
- **Risk:** yanlış anahtar yönetimi → yedek okunamaz. **Rollback:** bayrakla eski davranışa dönüş.

### Paket WP-THEME-01: Açık tema dönüşümü
- **Amaç:** `ui-theme-audit.md` planını uygula: brand token rolleri, 120 koyu bloğun açık karşılığı, işlevsel açık/koyu geçiş.
- **Okunacak:** `tailwind.config.js`, `src-v2/styles.css`, `Root.tsx`, en yoğun 7 dosya (AlisPage, marketRates, Depolama, WooCommerce, Customers, OpmcDetail, Log).
- **Kapsam dışı:** müşteri ekranı `--display-*` token'ları (zaten açık); davranışsal değişiklik.
- **Kabul:** `npm run typecheck` + vitest temiz; görsel kontrol listesi; kontrast AA.

### Paket WP-SALES-00: Satış discovery
- **Amaç:** kod yazmadan satış gereksinim dokümanı: mevcut legacy akış envanteri + kullanıcı sorularının yanıtları + TO-BE tasarım.
- **Okunacak:** `pos_service.py` (sale bölümleri), `webhooks.py`, `docs/HANDOVER.md:698`, DECISIONS_AND_OPEN_QUESTIONS §Satış.
- **Çıktı:** `docs/BUSINESS_FLOWS.md` §5 güncellemesi + kabul edilmiş kararlar.
