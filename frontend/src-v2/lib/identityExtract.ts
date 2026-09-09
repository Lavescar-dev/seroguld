import { apiRequest } from './api';

// R1-B Tier 2 istemcisi — backend /alis/identity uçları (şema: app/schemas/identity.py).
// 0.3.39: uç aynı kalır; yanıt yerel RapidOCR katmanı (local_engine) ve
// VLM katmanı (vlm_enabled, default kapalı) için ortaktır. Hiçbir katman
// açık değilse frontend isteği hiç atmaz; akış Windows OCR + regex kalır.

export type IdentityExtractReview = 'validated' | 'needs_review';

export type IdentityExtractField = {
  value: string;
  review: IdentityExtractReview;
  confidence: number | null;
};

export type IdentityExtractBarcode = {
  cpr: string;
  verified: boolean;
};

export type IdentityExtractUsage = {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_cost_usd: string;
};

// WP5 (0.3.39): yerel katman koştuysa dönen motor izi — ROI bulamazsa
// roi_fields boş kalır ve tam-kart metni ocr_text ile gelir.
export type IdentityExtractEngine = {
  name: string;
  latency_ms: number;
  warped: boolean;
  quad_detected: boolean;
  roi_fields: string[];
};

export type IdentityExtractResponse = {
  document_type: string | null;
  fields: Record<string, IdentityExtractField>;
  barcode: IdentityExtractBarcode | null;
  // Makine token'ları: 'glare_detected' | 'card_not_detected' |
  // 'roi_low_confidence' | 'cpr_mod11_failed_soft' — insan metni frontend işi.
  warnings: string[];
  source: string;
  model: string;
  usage: IdentityExtractUsage | null;
  // 0.3.39 eklentileri (eski backend'de yoktur — opsiyonel okunur).
  engine?: IdentityExtractEngine | null;
  ocr_text?: string | null;
};

export type IdentityExtractCapabilities = {
  extract_enabled: boolean;
  model: string | null;
  barcode_available: boolean;
  /** UYGUNLUK: yerel RapidOCR motoru kurulabildi mi (bayraktan bağımsız). */
  local_engine: boolean;
  /** BAYRAĞIN kendisi: yerel katman gerçekte koşuyor mu. */
  local_enabled: boolean;
  /** İnsan-okur motor etiketi (ör. RapidOCR PP-OCRv6). */
  local_model: string | null;
  /** VLM katmanı bayrağı (extract_enabled ile aynı değer). */
  vlm_enabled: boolean;
};

// Yetenek sorgusu modül-önbellekli tek GET: her tarama paneli ayrı istek
// atmasın; flag değişimi (config + restart) zaten nadirdir. Testler reset
// yardımcısıyla önbelleği temizler.
let capabilitiesCache: Promise<IdentityExtractCapabilities> | null = null;

export function fetchIdentityExtractCapabilities(): Promise<IdentityExtractCapabilities> {
  if (!capabilitiesCache) {
    capabilitiesCache = apiRequest<IdentityExtractCapabilities>('/api/v2/alis/identity/capabilities').catch((error) => {
      // Başarısız sorgu önbelleklenmez: ağ/oturum düzeldiğinde yeniden denenir.
      capabilitiesCache = null;
      throw error;
    });
  }
  return capabilitiesCache;
}

export function resetIdentityExtractCapabilitiesCacheForTests(): void {
  capabilitiesCache = null;
}

export function requestIdentityExtract(
  imageDataUrl: string,
  side: 'front' | 'back' = 'front',
): Promise<IdentityExtractResponse> {
  return apiRequest<IdentityExtractResponse>('/api/v2/alis/identity/extract', {
    method: 'POST',
    body: JSON.stringify({ image_data_url: imageDataUrl, side }),
  });
}
