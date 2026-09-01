# WORDPRESS INTEGRATION — Sero Guld CRM

> **Son doğrulama:** 2026-08-09 · **Repo:** `seroguld-crm` · **Branch:** `build/seroguld-feedback-20260610-140000` · **Doğrulama seviyesi:** VERIFIED (kod) — canlı siteye istek gönderilmedi

Hedef site: `https://seroguld.dk` (harici WordPress + WooCommerce). Ayrı bir WordPress repo'su YOKTUR.

## 1. Gerçekte uygulanmış (IMPLEMENTED)

### 1.1 WooCommerce ürün senkronu (CRM → Woo)

- Woo REST API v3, consumer key/secret ile HTTP Basic (`services/woocommerce.py:194,230`).
- Ürün publish/unpublish/sync, foto upload, SEO/RankMath meta (`woocommerce.py:372 publish_product`).
- v2 endpoint'leri `/api/v2/woocommerce/*` (`v2_woocommerce.py:45-163`) + OPMC siparişleri `:172-192`.
- Medya upload için WP **Application Password** (`WP_APP_USERNAME`/`WP_APP_PASSWORD`, `woocommerce.py:325`).

### 1.2 Sipariş → satış (Woo → CRM)

- Webhook HMAC-SHA256 imza doğrulama (`api/webhooks.py:32-39,220-221`).
- Sipariş kalemleri satışa işlenir: `_apply_sale_items` (`webhooks.py:110`); `sync-recent` (`:268`).
- Ürün import: `woocommerce_import_helpers.py` — wc_id varsa günceller, çoğaltmaz (`api/products.py:152,212,268`).
- Müşteri eşleme: `users.woocommerce_customer_id` (migration 0015).

### 1.3 GDPR köprüsü (CRM → WP, public)

- Public endpoint'ler: `GET /api/v2/public/gdpr/site-config`, `/cookie-config`, `/bridge-config` (`api/gdpr.py:226-238`) — auth'suz by design.
- Asset pack: `ops/wordpress/footer-links.html` + `ops/wordpress/bridge-snippet.js` (`window.SEROGULD_GDPR_BRIDGE_CONFIG_URL`'den config çekip link basar).
- CRM public sayfaları: `/gdpr/privacy`, `/gdpr/cookies`, `/gdpr/request`, `/gdpr/request/:token`.

### 1.4 OPMC anti-fraud

- WC Anti-Fraud (OPMC) meta'sı (`wc_af_score`, `_wc_af_*`) parse: `antifraud_helpers.py:30`; whitelist/known_customer/blacklist + manuel override + müşteri geçmişi.
- Sero Guld'de aktif OPMC 7.2.2, `wc_af_score` değerini kalan güven puanı olarak saklıyor. CRM `OPMC_WC_AF_SCORE_MODE=trust` semantiğiyle `risk = 100 - wc_af_score` hesaplar; kaynak, güven ve risk değerlerini ayrı gösterir.
- OPMC eşikleri normalize edilmiş risk üzerinde uygulanır: `<25 düşük`, `25-75 orta`, `>=76 yüksek`. Whitelist siparişlerinde kontrol atlandığı için sahte bir düşük skor üretilmez.
- Completed/cancelled/refunded/failed siparişlerin risk kaydı korunur ancak aktif inceleme kuyruğuna girmez.

## 2. Planlanan ama eksik / çelişkili (CONTRADICTED)

- `scripts/package-wordpress-bridge.sh`, `ops/wordpress/seroguld-crm-bridge/seroguld-crm-bridge.php` PHP plugin dosyasını bekliyor — **dosya repo'da YOK**; script fail olur. `docs/WORDPRESS_GDPR_BRIDGE_TR.md:49` zaten "plugin otomasyonu içermez" diyor → script ile doc çelişkisi. (VERIFIED)
- Kullanıcının bahsettiği "site ile CRM iletişimi" hedefinin kapsamı (ürün kataloğu? fiyat panosu? randevu?) mevcut implementasyonun ötesinde net değil → açık soru.

## 3. Kimlik doğrulama / secret yönetimi

| Kanal | Mekanizma | Env adları (değer yok) |
|---|---|---|
| Woo REST | Consumer key/secret (Basic) | `WOOCOMMERCE_BASE_URL/CONSUMER_KEY/CONSUMER_SECRET/TIMEOUT_SECONDS` |
| Webhook | HMAC-SHA256 imza | `WOOCOMMERCE_WEBHOOK_SECRET` |
| WP medya | Application Password | `WORDPRESS_BASE_URL`, `WP_APP_USERNAME/PASSWORD` |
| GDPR köprü | Yok (public) | — |

Secret'lar `.env`'de; `.env` git'e commit edilmiyor (bu kopyada VERIFIED — `git log --all -- .env` boş). Rotation planı: PROJECT_HEALTH_AUDIT.

## 4. Retry / idempotency / hata yönetimi

- **Idempotency:** ürün eşleşme `woocommerce_product_id`; her işlem `woocommerce_sync_log`'a yazılır (request/response payload + status + error).
- **Retry:** Woo çağrılarında otomatik retry mekanizması belirgin değil (UNKNOWN — tek tek çağrı seviyesinde); Uniconta tarafında retry/backoff + failed list + bulk retry var (`useUnicontaMakeState`).
- **CORS/origin:** `CORS_ORIGINS` env ile; webhook origin bağımsız (imza ile korunur).
- **Hata:** webhook imza hatası reddedilir; sync hataları log tablosuna düşer, UI'da görünür.

## 5. nginx / ağ

- `nginx/nginx.conf`: port 80 plain HTTP reverse proxy (`/api/`→backend:8000, `/`→frontend:3000). **TLS yok** (P1 risk — PROJECT_HEALTH_AUDIT).
- docker-compose servisleri: postgres, backend, frontend, collabora, onlyoffice (JWT), nginx. Web stack "secondary".

## 6. İlişkili ayrı projeler

- `seroguld-webshops/` — headless WooCommerce vitrin taslağı (Aurum/Nord, `?site=` anahtarı, mock ürün + opsiyonel Woo REST, canlı sepet kapalı). Gelecek storefront; henüz CRM'e bağlı değil.
- `seroguld-priser/` — mağaza fiyat panosu prototipi (Cloudflare).

## 7. Açık sorular

1. Kullanıcının "site ile iletişim" hedefi mevcut Woo/GDPR kapsamıyla mı sınırlı, yoksa ek akış (randevu, fiyat panosu canlı veri, müşteri hesabı) mı isteniyor?
2. Eksik PHP plugin dosyası: bilinçli mi kaldırıldı, yoksa script mi erken eklendi? Bridge'in geleceği snippet mi plugin mi?
3. Webhook'ların prod URL kaydı ve secret rotation takvimi var mı?
