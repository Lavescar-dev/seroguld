import { apiRequest } from './api';

// R1-B Tier 2 istemcisi — backend /alis/identity uçları (şema: app/schemas/identity.py).
// VLM katmanı backend'de flag'lidir (identity_extract_enabled, default kapalı);
// capabilities kapalı dönerse frontend yalnız yerel OCR zinciriyle çalışır.

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

export type IdentityExtractResponse = {
  document_type: string | null;
  fields: Record<string, IdentityExtractField>;
  barcode: IdentityExtractBarcode | null;
  warnings: string[];
  source: string;
  model: string;
  usage: IdentityExtractUsage | null;
};

export type IdentityExtractCapabilities = {
  extract_enabled: boolean;
  model: string | null;
  barcode_available: boolean;
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
