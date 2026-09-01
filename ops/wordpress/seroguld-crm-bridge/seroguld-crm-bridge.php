<?php
/**
 * Plugin Name: Sero Guld CRM Bridge
 * Description: Sero Guld CRM (masaüstü) için AFG (afregningsbilag) e-posta köprüsü — PDF eki wp_mail() + WP Mail SMTP ile gönderilir; SMTP kimlik bilgileri WordPress'te kalır, CRM'e asla girmez.
 * Version: 0.1.0
 * Author: Lavescar
 * Text Domain: seroguld-crm-bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

define('SEROGULD_CRM_BRIDGE_VERSION', '0.1.0');

class Seroguld_Crm_Bridge
{
    const OPTION_SECRET = 'seroguld_crm_bridge_secret';
    const OPTION_SECRET_PREVIOUS = 'seroguld_crm_bridge_secret_previous';
    const OPTION_RATE_WINDOW = 'seroguld_crm_bridge_rate_window';
    const TOKEN_HEADER = 'X-SeroGuld-Bridge-Token';

    /** Tek istekte kabul edilen en büyük gövde (bayt). base64 öncesi PDF ~7.5MB eder. */
    const MAX_BODY_BYTES = 10485760;
    /** Saat başına token+IP başına istek limiti. */
    const RATE_LIMIT_PER_HOUR = 10;

    public static function init(): void
    {
        add_action('rest_api_init', [__CLASS__, 'register_rest_route']);
    }

    public static function register_rest_route(): void
    {
        register_rest_route('seroguld/v1', '/send-afg-email', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'handle_send'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);
    }

    /**
     * REST kurulumundan ÖNCE çalışır; token/limit/HTTPS kontrollerini burada
     * yaparız ki WP core permission akışından bağımsız erken reddedebilelim.
     */
    public static function check_permission($request)
    {
        // Yalnız HTTPS — token düz metin üzerinde gezmesin.
        if (!is_ssl()) {
            return new WP_Error('seroguld_bridge_insecure', 'HTTPS gerekli', ['status' => 403]);
        }

        // Boyut limiti — Content-Length zaten aşılırsa hemen 413.
        $content_length = isset($_SERVER['CONTENT_LENGTH']) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
        if ($content_length > self::MAX_BODY_BYTES) {
            return new WP_Error('seroguld_bridge_too_large', 'Payload çok büyük', ['status' => 413]);
        }

        $secret = (string) get_option(self::OPTION_SECRET, '');
        if ($secret === '') {
            return new WP_Error('seroguld_bridge_unconfigured', 'Bridge secret tanımlı değil', ['status' => 500]);
        }
        $provided = (string) $request->get_header(self::TOKEN_HEADER);
        // Aktif + önceki secret kabul edilir (downtime'sız rotasyon).
        $previous = (string) get_option(self::OPTION_SECRET_PREVIOUS, '');
        if (!hash_equals($secret, $provided) && ($previous === '' || !hash_equals($previous, $provided))) {
            return new WP_Error('seroguld_bridge_forbidden', 'Geçersiz token', ['status' => 401]);
        }

        if (self::rate_limited()) {
            return new WP_Error('seroguld_bridge_rate_limited', 'Çok fazla istek', ['status' => 429]);
        }

        return true;
    }

    private static function rate_limited(): bool
    {
        $window = (int) get_option(self::OPTION_RATE_WINDOW, 0);
        $now = time();
        $bucket_key = 'seroguld_bridge_hits_' . md5((string) self::client_ip());
        $hits = (array) get_transient($bucket_key);
        if (!is_array($hits) || !isset($hits['start']) || ($now - (int) $hits['start']) > 3600) {
            $hits = ['start' => $now, 'count' => 0];
        }
        $hits['count']++;
        set_transient($bucket_key, $hits, 3600);
        update_option(self::OPTION_RATE_WINDOW, $now, false);
        return $hits['count'] > self::RATE_LIMIT_PER_HOUR;
    }

    private static function client_ip(): string
    {
        $remote = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '0.0.0.0';
        return preg_replace('/[^0-9a-fA-F:.]/', '', $remote) ?: '0.0.0.0';
    }

    public static function handle_send(WP_REST_Request $request)
    {
        $params = $request->get_json_params();
        if (!is_array($params)) {
            return new WP_Error('seroguld_bridge_bad_json', 'JSON gövdesi çözümlenemedi', ['status' => 400]);
        }

        $to = sanitize_email((string) ($params['to'] ?? ''));
        $customer_name = sanitize_text_field((string) ($params['customer_name'] ?? ''));
        $document_number = sanitize_text_field((string) ($params['document_number'] ?? ''));
        $pdf_base64 = preg_replace('/\s+/', '', (string) ($params['pdf_base64'] ?? ''));

        if ($to === '' || !is_email($to)) {
            return new WP_Error('seroguld_bridge_invalid_to', 'Geçersiz alıcı', ['status' => 422]);
        }
        if ($document_number === '' || strlen($document_number) > 64) {
            return new WP_Error('seroguld_bridge_invalid_doc', 'Geçersiz belge numarası', ['status' => 422]);
        }

        $pdf_path = '';
        $tmp_name = '';
        if ($pdf_base64 !== '') {
            $decoded = base64_decode($pdf_base64, true);
            if ($decoded === false || strncmp($decoded, '%PDF-', 5) !== 0) {
                return new WP_Error('seroguld_bridge_invalid_pdf', 'PDF çözümlenemedi', ['status' => 422]);
            }
            if (strlen($decoded) > self::MAX_BODY_BYTES) {
                return new WP_Error('seroguld_bridge_too_large', 'PDF çok büyük', ['status' => 413]);
            }
            $tmp_name = uniqid('afg-', true) . '.pdf';
            $upload_dir = wp_upload_dir();
            $tmp_dir = trailingslashit($upload_dir['basedir']) . 'seroguld-bridge-tmp';
            wp_mkdir_p($tmp_dir);
            $pdf_path = trailingslashit($tmp_dir) . $tmp_name;
            file_put_contents($pdf_path, $decoded);
        }

        $subject = sprintf('Sero Guld — afregningsbilag %s', $document_number);
        $body = sprintf(
            "Kære %s,\n\nTak for din handel hos Sero Guld. Vedhæftet finder du dit afregningsbilag (%s).\n\nMed venlig hilsen\nSero Guld og Sølv ApS\nValby Langgade 84, 2500 Valby\nTlf.: 22255504 — info@seroguld.dk — www.seroguld.dk",
            $customer_name !== '' ? $customer_name : 'kunde',
            $document_number
        );
        $headers = ['Content-Type: text/plain; charset=UTF-8'];
        $attachments = $pdf_path !== '' ? [$pdf_path] : [];

        try {
            $sent = wp_mail($to, $subject, $body, $headers, $attachments);
            if (!$sent) {
                return new WP_Error('seroguld_bridge_mail_failed', 'wp_mail gönderemedi', ['status' => 500]);
            }
            return rest_ensure_response(['sent' => true]);
        } finally {
            if ($pdf_path !== '' && file_exists($pdf_path)) {
                wp_delete_file($pdf_path);
            }
        }
    }
}

Seroguld_Crm_Bridge::init();

/**
 * WP-CLI kurulum: wp option add seroguld_crm_bridge_secret <openssl rand -hex 32>
 * Secret rotasyonu: eski değeri seroguld_crm_bridge_secret_previous'e taşıyıp
 * yeni değeri seroguld_crm_bridge_secret'e yazmak yeterli — CRM'in .env'i
 * güncellenene kadar iki token da kabul edilir.
 */
