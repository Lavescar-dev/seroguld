=== Sero Guld CRM Bridge ===
Contributors: lavescar
Tags: crm, email, bridge, afregningsbilag
Requires at least: 6.0
Tested up to: 6.9
Stable tag: 0.1.0
License: GPLv2 or later

Sero Guld CRM (masaüstü) için AFG e-posta köprüsü. CRM, finalize edilen alış
belgesinin (afregningsbilag) PDF'ini bu eklentinin REST ucuna POST'lar; e-posta
wp_mail() + WP Mail SMTP üzerinden gönderilir. SMTP şifresi WordPress'te kalır,
CRM'e asla girmez.

== Kurulum ==

1. Zip'i WordPress'e yükle: Eklentiler → Ekle → Zip yükle → Etkinleştir.
   (SSH erişimli kurulum: zip'i wp-content/plugins/ altına aç.)

2. Secret üret (32 byte hex):
   openssl rand -hex 32

3. Secret'ı WordPress'e yaz (WP-CLI ile):
   wp option add seroguld_crm_bridge_secret '<32-hex>'
   (veya phpMyAdmin → wp_options tablosuna option_name=seroguld_crm_bridge_secret)

4. CRM tarafının .env dosyasına (aynı secret):
   EMAIL_TRANSPORT=wp-bridge
   WP_BRIDGE_URL=https://seroguld.dk/wp-json/seroguld/v1/send-afg-email
   WP_BRIDGE_SECRET=<aynı 32-hex>

5. WP Mail SMTP'de "Force From" e-postasının info@seroguld.dk olduğunu doğrula.

== Secret rotasyonu (downtime'sız) ==

1. wp option add seroguld_crm_bridge_secret_previous '<eski>'
2. wp option update seroguld_crm_bridge_secret '<yeni>'
3. CRM .env'indeki WP_BRIDGE_SECRET'ı yeni değerle güncelle.
4. Tüm istemciler güncellenince: wp option delete seroguld_crm_bridge_secret_previous

== Sınırlar ==

- Yalnız HTTPS (HTTP isteği 403).
- Gövde tavanı 10 MB (413).
- Token + IP başına saatte 10 istek (429).
- Token başlıkları: X-SeroGuld-Bridge-Token (hash_equals, sabit zamanlı).

== Canlı smoke seti ==

TOKEN=<secret>
URL=https://seroguld.dk/wp-json/seroguld/v1/send-afg-email

# 200: doğru token + küçük test PDF
python3 -c "import base64;print(base64.b64encode(open('/tmp/test.pdf','rb').read()).decode())" > /tmp/pdf.b64
curl -s -X POST "$URL" -H "X-SeroGuld-Bridge-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"to\":\"test@example.dk\",\"customer_name\":\"Test\",\"document_number\":\"TEST-1\",\"pdf_base64\":\"$(cat /tmp/pdf.b64)\"}"
# → {"sent":true}

# 401: yanlış token → {"code":"seroguld_bridge_forbidden",...}
# 413: 12MB payload → {"code":"seroguld_bridge_too_large",...}
# 429: aynı saatte 11. istek → {"code":"seroguld_bridge_rate_limited",...}
# 403: http:// (https'siz) → {"code":"seroguld_bridge_insecure",...}
