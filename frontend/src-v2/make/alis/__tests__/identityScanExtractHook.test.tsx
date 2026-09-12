import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/desktop', () => ({
  // identityScan -> identityExtract -> api/auth zinciri isTauriRuntime'e ihtiyac duyar.
  isTauriRuntime: vi.fn(() => false),
  getIdentityScannerCapabilities: vi.fn(),
  acquireIdentityScan: vi.fn(),
  pickIdentityScanFile: vi.fn(),
  identityScanFromBytes: vi.fn(),
  discardIdentityScan: vi.fn(),
  writeUiDiagnostic: vi.fn(),
  startIdentityWatch: vi.fn(),
  stopIdentityWatch: vi.fn(),
  onIdentityWatchScan: vi.fn(async () => () => undefined),
}));

vi.mock('@/lib/identityExtract', () => ({
  fetchIdentityExtractCapabilities: vi.fn(),
  requestIdentityExtract: vi.fn(),
}));

import {
  acquireIdentityScan,
  getIdentityScannerCapabilities,
  writeUiDiagnostic,
  type IdentityScanResult,
  type IdentityScannerCapabilities,
} from '@/lib/desktop';
import {
  fetchIdentityExtractCapabilities,
  requestIdentityExtract,
  type IdentityExtractCapabilities,
  type IdentityExtractResponse,
} from '@/lib/identityExtract';
import { buildIdentityScanDiagnosticCode, useIdentityScan } from '../identityScan';
import type { EditableCustomer } from '../types';

const mockedCapabilities = vi.mocked(fetchIdentityExtractCapabilities);
const mockedExtract = vi.mocked(requestIdentityExtract);
const mockedAcquire = vi.mocked(acquireIdentityScan);
const mockedScannerCaps = vi.mocked(getIdentityScannerCapabilities);
const mockedWriteDiagnostic = vi.mocked(writeUiDiagnostic);

const emptyCustomer: EditableCustomer = {
  name: '', email: '', phone: '', address: '', postal_code: '', city: '', cpr_number: '', identity_doc_type: '', identity_doc_number: '', identity_doc_country: '',
};

// Sundhedskort benzeri yerel regex çıktısı üreten ham OCR metni: başlık +
// etiketsiz isim/CPR/adres bloğu (c/o çapası kartı tanır; 6 haneli CPR yerel
// zincirin plausibleCprSix kırpmasıdır).
const LOCAL_OCR_TEXT = [
  'SUNDHEDSKORT',
  'Test Person',
  '010101-1119',
  'c/o Jens Jensen',
  'Testgade 1',
  '1620 Testby',
].join('\n');

// İsmi okunamayan kørekort: yerel regex yalnız belge no + CPR verir —
// ocr_text/barkod dolumlarının boşluğu göstermesi için.
const SPARSE_LICENSE_TEXT = 'KØREKORT\n4d. 010101-1234\n5. 20984713';

const scanResult = (overrides: Partial<IdentityScanResult> = {}): IdentityScanResult => ({
  side: 'front',
  source: 'wia',
  mimeType: 'image/jpeg',
  previewDataUrl: 'data:image/jpeg;base64,AAAA',
  ocrText: LOCAL_OCR_TEXT,
  ocrLines: LOCAL_OCR_TEXT.split('\n'),
  ocrLanguage: 'da-DK',
  ocrRequestedLanguage: 'da-DK',
  ocrMaxImageDimension: 2600,
  imageScaled: false,
  imageSourceWidth: 1011,
  imageSourceHeight: 1099,
  ...overrides,
});

// Varsayılan: TÜM katmanlar kapalı (istek atılmaz). Katman testleri ilgili
// alanı açıkça açar — barkod artık başlı başına istek sebebidir (K).
const extractCapabilities = (overrides: Partial<IdentityExtractCapabilities> = {}): IdentityExtractCapabilities => ({
  extract_enabled: false,
  model: null,
  barcode_available: false,
  local_engine: false,
  local_enabled: false,
  local_model: null,
  vlm_enabled: false,
  ...overrides,
});

const extractPayload = (overrides: Partial<IdentityExtractResponse> = {}): IdentityExtractResponse => ({
  document_type: 'sundhedskort',
  fields: {
    full_name: { value: 'Test Person', review: 'validated', confidence: 0.95 },
    cpr_number: { value: '0101011119', review: 'validated', confidence: 1.0 },
    address: { value: 'Testgade 1', review: 'validated', confidence: 0.9 },
    postal_code: { value: '1620', review: 'validated', confidence: 0.9 },
    city: { value: 'Testby', review: 'validated', confidence: 0.9 },
  },
  barcode: { cpr: '0101011119', verified: true },
  warnings: [],
  source: 'merged',
  model: 'gpt-5-mini',
  usage: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedScannerCaps.mockResolvedValue({
    supported: true,
    platform: 'windows',
    wiaAcquisition: true,
    localOcr: true,
    imageFileFallback: true,
    watchFolder: false,
    maxFileBytes: 10 * 1024 * 1024,
    acceptedMimeTypes: ['image/jpeg', 'image/png'],
    ocrDanishAvailable: true,
    ocrProbeOk: true,
    ocrProfileLanguage: 'da-DK',
    ocrAvailableLanguages: ['da-DK'],
  } satisfies IdentityScannerCapabilities);
  mockedCapabilities.mockResolvedValue(extractCapabilities());
  mockedExtract.mockResolvedValue(extractPayload());
});

function renderScanHook() {
  return renderHook(() => useIdentityScan({
    customer: emptyCustomer,
    setCustomer: vi.fn(),
    uiVariant: 'modern',
  }));
}

async function scanFront(overrides: Partial<IdentityScanResult> = {}) {
  mockedAcquire.mockResolvedValue(scanResult(overrides));
  const { result } = renderScanHook();
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () => {
    await result.current.acquire('front');
  });
  return result;
}

describe('useIdentityScan çıkarma katmanları (WP5 — yerel motor / VLM)', () => {
  it('hiçbir katman açık değilken istek ATILMAZ, yalnız yerel regex çalışır', async () => {
    mockedCapabilities.mockResolvedValue(extractCapabilities());
    const result = await scanFront();
    await waitFor(() => expect(result.current.status).toBe('review'));
    expect(mockedExtract).not.toHaveBeenCalled();
    // Yerel zincir 6 haneli CPR verir (plausibleCprSix kırpması regex dalına özgü).
    expect(result.current.result?.fields.cpr_number?.value).toBe('010101');
    expect(result.current.engineNotice).toBeNull();
    expect(result.current.glareNotice).toBeNull();
    // Katman yoksa motor Windows-OCR regex zinciridir.
    expect(result.current.scanMeta?.engine).toBe('windows-ocr');
  });

  it('yalnız yerel motor açıksa istek atılır: motor backend-local, tanı kodu .LOC', async () => {
    mockedCapabilities.mockResolvedValue(extractCapabilities({ extract_enabled: false, local_engine: true, vlm_enabled: false }));
    const result = await scanFront();
    await waitFor(() => expect(mockedExtract).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.scanMeta?.engine).toBe('backend-local'));
    expect(mockedExtract).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA', 'front');
    // Backend alanları regexin 6 haneli CPR'sinin üstüne tam 10 haneyi yazar.
    expect(result.current.result?.fields.cpr_number?.value).toBe('0101011119');
    // Receive anındaki tanı kodu hâlâ .WIN'dir (kod yazım anını gösterir);
    // güncel meta ile üretilen kod .LOC'a döner — saha teshisinde katman ayrışır.
    expect(mockedWriteDiagnostic.mock.calls[0][0].errorCode.endsWith('.WIN')).toBe(true);
    expect(buildIdentityScanDiagnosticCode(result.current.scanMeta!).endsWith('.LOC')).toBe(true);
  });

  it('yalnız VLM katmanı açıksa motor vlm etiketi taşır', async () => {
    mockedCapabilities.mockResolvedValue(extractCapabilities({ extract_enabled: true, model: 'gpt-5-mini', vlm_enabled: true }));
    mockedExtract.mockResolvedValue(extractPayload({ source: 'vlm', model: 'gpt-5-mini' }));
    const result = await scanFront();
    await waitFor(() => expect(result.current.scanMeta?.engine).toBe('vlm'));
    expect(result.current.engineNotice).toBeNull();
  });

  it('eski backend (yalnız extract_enabled) VLM katmanı sayılır (geriye dönük uyum)', async () => {
    // Eski backend yanıtında local_engine/vlm_enabled yoktur — vlm_enabled,
    // extract_enabled'dan türer, yerel motor + barkod kapalı varsayılır
    // (eski uçta kapalı bayrakla extract 503 atardı; istek atılmaz).
    mockedCapabilities.mockResolvedValue({ extract_enabled: true, model: 'gpt-5-mini', barcode_available: true } as IdentityExtractCapabilities);
    mockedExtract.mockResolvedValue(extractPayload({ source: 'vlm' }));
    const result = await scanFront();
    await waitFor(() => expect(mockedExtract).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.scanMeta?.engine).toBe('vlm'));
  });

  it('K (0.3.39): yalnız barkod katmanı kuruluysa da istek atılır — bayrak motoru kapatamaz', async () => {
    // 0.3.38 saha tuzağı: local/vlm kapalıydı, barkod kuruluydu — kapı
    // isteği kesiyordu ve CPR otoritesi hiç koşmuyordu.
    mockedCapabilities.mockResolvedValue(extractCapabilities({ barcode_available: true }));
    const result = await scanFront();
    await waitFor(() => expect(mockedExtract).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.result?.fields.cpr_number?.value).toBe('0101011119'));
  });

  it('J (0.3.39): regex hiç alan tutamadıysa extract kurtarır — hata ekranı kalkar', async () => {
    mockedCapabilities.mockResolvedValue(extractCapabilities({ barcode_available: true }));
    mockedAcquire.mockResolvedValue(scanResult({
      ocrText: 'x? ##\n??\n###',
      ocrLines: ['x? ##', '??', '###'],
    }));
    mockedExtract.mockResolvedValue(extractPayload({
      document_type: null,
      fields: {},
      barcode: { cpr: '0101011234', verified: true },
      source: 'barcode',
    }));
    const { result } = renderScanHook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.acquire('front');
    });
    // İlk karede "tanınamadı" hata durumu kurulur; extract yanıtı alan
    // getirirse review'a yükselir ve hata temizlenir.
    await waitFor(() => expect(result.current.status).toBe('review'));
    expect(result.current.result?.fields.cpr_number?.value).toBe('0101011234');
    expect(result.current.result?.fields.cpr_number?.review).toBe('validated');
    // Tür bilinmiyor ama alan kurtarıldı: mergeSideScanResults unknown'u
    // dışarı vermezdi — son çare düzen tahmini sundhedskort ailesi.
    expect(result.current.result?.documentType).toBe('health_card');
    expect(result.current.error).toBeNull();
    expect(result.current.engineNotice).toBeNull();
    // Barkod-only kurtarma: motor izi yoktur (engine.name none) — ama alanı
    // backend getirdi; rozet backend-local kalır, windows-ocr sanılmaz.
    expect(result.current.scanMeta?.engine).toBe('backend-local');
  });

  it('önizleme yoksa istek atılır (görüntüsüz çıkarım istenmez)', async () => {
    mockedCapabilities.mockResolvedValue(extractCapabilities({ local_engine: true }));
    const result = await scanFront({ previewDataUrl: '' });
    await waitFor(() => expect(result.current.status).toBe('review'));
    expect(mockedExtract).not.toHaveBeenCalled();
  });

  it('yerel motor hatası yerel sonucu EZMEZ — Windows-OCR uyarısı gösterilir', async () => {
    mockedCapabilities.mockResolvedValue(extractCapabilities({ local_engine: true }));
    mockedExtract.mockRejectedValue(new Error('502 upstream'));
    const result = await scanFront();
    await waitFor(() => expect(result.current.engineNotice).toContain('Yerel motor yanıt vermedi'));
    expect(result.current.engineNotice).toContain('alanları kontrol edin');
    // Yerel regex sonucu hâlâ sahada.
    expect(result.current.status).toBe('review');
    expect(result.current.result?.fields.cpr_number?.value).toBe('010101');
    expect(result.current.scanMeta?.engine).toBe('windows-ocr');
  });

  it('yalnız VLM açıkken hata, VLM uyarı metni üretir', async () => {
    mockedCapabilities.mockResolvedValue(extractCapabilities({ extract_enabled: true, vlm_enabled: true }));
    mockedExtract.mockRejectedValue(new Error('502 upstream'));
    const result = await scanFront();
    await waitFor(() => expect(result.current.engineNotice).toContain('VLM doğrulaması yanıt vermedi'));
    expect(result.current.result?.fields.cpr_number?.value).toBe('010101');
  });

  it('yetenek sorgusu başarısız olsa da tarama çalışır (katmanlar sessizce atlanır)', async () => {
    mockedCapabilities.mockRejectedValue(new Error('network'));
    const result = await scanFront();
    await waitFor(() => expect(result.current.status).toBe('review'));
    expect(mockedExtract).not.toHaveBeenCalled();
    expect(result.current.result?.fields.cpr_number?.value).toBe('010101');
  });

  it('clear sonrası gelen geç yanıt yazılmaz', async () => {
    mockedCapabilities.mockResolvedValue(extractCapabilities({ local_engine: true }));
    let resolveExtract: (value: ReturnType<typeof extractPayload>) => void = () => undefined;
    mockedExtract.mockReturnValue(new Promise((resolve) => { resolveExtract = resolve; }));
    const result = await scanFront();
    await waitFor(() => expect(result.current.status).toBe('review'));
    await act(async () => {
      result.current.clear();
    });
    await act(async () => {
      resolveExtract(extractPayload());
    });
    expect(result.current.result).toBeNull();
  });
});

describe('useIdentityScan — birleşim zinciri (backend alanları > ocr_text regex > Windows regex)', () => {
  it('fields.cpr yoksa barkod CPR doldurur (tam 10 hane, otorite)', async () => {
    mockedCapabilities.mockResolvedValue(extractCapabilities({ local_engine: true }));
    mockedAcquire.mockResolvedValue(scanResult({ ocrText: SPARSE_LICENSE_TEXT, ocrLines: SPARSE_LICENSE_TEXT.split('\n') }));
    mockedExtract.mockResolvedValue(extractPayload({
      document_type: 'driver_license',
      fields: {},
      barcode: { cpr: '0101011234', verified: false },
      source: 'local+barcode',
      engine: { name: 'rapidocr', latency_ms: 420, warped: true, quad_detected: true, roi_fields: [] },
    }));
    const { result } = renderScanHook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.acquire('front');
    });
    await waitFor(() => expect(result.current.result?.fields.cpr_number?.value).toBe('0101011234'));
    // Doğrulanmamış barkod needs_review ile taşınır; 6 haneye kırpılmaz.
    expect(result.current.result?.fields.cpr_number?.review).toBe('needs_review');
    // engine bloğu + source'taki yerel izi → backend-local.
    expect(result.current.scanMeta?.engine).toBe('backend-local');
  });

  it('ocr_text regexi yerel regexin kaçırdığı alanı doldurur; backend alanı ikisini ezer', async () => {
    mockedCapabilities.mockResolvedValue(extractCapabilities({ local_engine: true }));
    mockedAcquire.mockResolvedValue(scanResult({ ocrText: SPARSE_LICENSE_TEXT, ocrLines: SPARSE_LICENSE_TEXT.split('\n') }));
    mockedExtract.mockResolvedValue(extractPayload({
      document_type: 'driver_license',
      // Backend yalnız adı doğruladı; ocr_text regex zincirine bırakılır.
      fields: { full_name: { value: 'Lars Vest Hansen', review: 'validated', confidence: 0.99 } },
      barcode: null,
      source: 'local',
      ocr_text: 'KØREKORT\n1. Hansen\n2. Lars\n5. 20984713\n4d. 010101-1234',
      engine: { name: 'rapidocr', latency_ms: 380, warped: false, quad_detected: false, roi_fields: [] },
    }));
    const { result } = renderScanHook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.acquire('front');
    });
    // Windows regexinde isim yoktu; ocr_text metnindeki etiketli isim dolar…
    await waitFor(() => expect(result.current.result?.fields.cpr_number?.value).toBe('010101'));
    // …ama backend alanı (primary) ocr_text regexinin adını ezer.
    expect(result.current.result?.fields.name?.value).toBe('Lars Vest Hansen');
    expect(result.current.scanMeta?.engine).toBe('backend-local');
  });

  it('glare_detected makine uyarısı görünür parlama ikazına çevrilir', async () => {
    mockedCapabilities.mockResolvedValue(extractCapabilities({ local_engine: true }));
    mockedExtract.mockResolvedValue(extractPayload({ warnings: ['glare_detected'] }));
    const result = await scanFront();
    await waitFor(() => expect(result.current.glareNotice).toContain('parlama'));
    expect(result.current.engineNotice).toBeNull();
  });

  it('0.3.42: local_slow gecikme uyarısı ekran ikazına çevrilir', async () => {
    // Backend yalnız VLM bayrağı açıkken local_slow üretir; notice bulut
    // doğrulamasının deneneceğini önceden söyler.
    mockedCapabilities.mockResolvedValue(extractCapabilities({ local_engine: true }));
    mockedExtract.mockResolvedValue(extractPayload({ warnings: ['local_slow'] }));
    const result = await scanFront();
    await waitFor(() => expect(result.current.glareNotice).toContain('çok uzun sürdü'));
    expect(result.current.engineNotice).toBeNull();
  });

  it('0.3.42: glare önceliklidir — aynı yanıtta local_slow parlama ikazını ezmez', async () => {
    // 0.3.43 düzeltmesi: backend ikisini BİRLİKTE gönderebilir (local_slow
    // tetikten bağımsız üretilir); else-if sıralaması parlama ikazını
    // öne çıkarır — savaşan notice yok, tek state güvenli.
    mockedCapabilities.mockResolvedValue(extractCapabilities({ local_engine: true }));
    mockedExtract.mockResolvedValue(extractPayload({ warnings: ['glare_detected', 'local_slow'] }));
    const result = await scanFront();
    await waitFor(() => expect(result.current.glareNotice).toContain('parlama'));
  });

  it('yeni tarama eski parlama/katman uyarılarını taşımaz', async () => {
    mockedCapabilities.mockResolvedValue(extractCapabilities({ local_engine: true }));
    mockedAcquire.mockResolvedValue(scanResult());
    const { result } = renderScanHook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    mockedExtract.mockResolvedValue(extractPayload({ warnings: ['glare_detected'] }));
    await act(async () => {
      await result.current.acquire('front');
    });
    await waitFor(() => expect(result.current.glareNotice).not.toBeNull());
    mockedExtract.mockResolvedValue(extractPayload());
    await act(async () => {
      await result.current.acquire('front');
    });
    await waitFor(() => expect(result.current.glareNotice).toBeNull());
    expect(result.current.engineNotice).toBeNull();
  });
});

describe('useIdentityScan — da-DK kurulum yönlendirmesi (WP7)', () => {
  it('yerel motor kapalı + Windows + Danca paketi yoksa komut yönlendirmesi gösterilir', async () => {
    mockedScannerCaps.mockResolvedValue({
      supported: true,
      platform: 'windows',
      wiaAcquisition: true,
      localOcr: true,
      imageFileFallback: true,
      watchFolder: false,
      maxFileBytes: 10 * 1024 * 1024,
      acceptedMimeTypes: ['image/jpeg'],
      ocrDanishAvailable: false,
      ocrProbeOk: true,
      ocrProfileLanguage: 'tr-TR',
      ocrAvailableLanguages: ['tr-TR'],
    } satisfies IdentityScannerCapabilities);
    mockedCapabilities.mockResolvedValue(extractCapabilities());
    const result = await scanFront();
    expect(result.current.danishOcrInstall).not.toBeNull();
    expect(result.current.danishOcrInstall?.command).toBe('Add-WindowsCapability -Online -Name "Language.OCR~~~da-DK~0.0.1.0"');
    expect(result.current.danishOcrInstall?.message).toContain('Yerel motor');
  });

  it('yerel katman bayrağı açıksa Danca paketi eksikliği kurulum yönlendirmesi üretmez', async () => {
    mockedScannerCaps.mockResolvedValue({
      supported: true,
      platform: 'windows',
      wiaAcquisition: true,
      localOcr: true,
      imageFileFallback: true,
      watchFolder: false,
      maxFileBytes: 10 * 1024 * 1024,
      acceptedMimeTypes: ['image/jpeg'],
      ocrDanishAvailable: false,
      ocrProbeOk: true,
      ocrProfileLanguage: 'tr-TR',
      ocrAvailableLanguages: ['tr-TR'],
    } satisfies IdentityScannerCapabilities);
    // N (0.3.39): kapı BAYRAĞA (local_enabled) bakar — motor kurulmuş ama
    // bayrak kapalıysa Windows OCR yine birincil okuyucudur, yönlendirme
    // gösterilir. Bayrak açıksa yerel katman okur, Danca paketi ikincildir.
    mockedCapabilities.mockResolvedValue(extractCapabilities({ local_engine: true, local_enabled: true }));
    const result = await scanFront();
    expect(result.current.danishOcrInstall).toBeNull();
  });

  it('N (0.3.39): motor kurulu ama bayrak kapalıysa yönlendirme YİNE gösterilir', async () => {
    mockedScannerCaps.mockResolvedValue({
      supported: true,
      platform: 'windows',
      wiaAcquisition: true,
      localOcr: true,
      imageFileFallback: true,
      watchFolder: false,
      maxFileBytes: 10 * 1024 * 1024,
      acceptedMimeTypes: ['image/jpeg'],
      ocrDanishAvailable: false,
      ocrProbeOk: true,
      ocrProfileLanguage: 'tr-TR',
      ocrAvailableLanguages: ['tr-TR'],
    } satisfies IdentityScannerCapabilities);
    mockedCapabilities.mockResolvedValue(extractCapabilities({ local_engine: true, local_enabled: false }));
    const result = await scanFront();
    expect(result.current.danishOcrInstall).not.toBeNull();
  });

  it('Windows dışında kurulum yönlendirmesi üretilmez', async () => {
    mockedScannerCaps.mockResolvedValue({
      supported: false,
      platform: 'linux',
      wiaAcquisition: false,
      localOcr: false,
      imageFileFallback: false,
      watchFolder: false,
      maxFileBytes: 10 * 1024 * 1024,
      acceptedMimeTypes: ['image/jpeg'],
      ocrDanishAvailable: false,
      ocrProbeOk: true,
      ocrProfileLanguage: '',
      ocrAvailableLanguages: [],
    } satisfies IdentityScannerCapabilities);
    mockedCapabilities.mockResolvedValue(extractCapabilities());
    const { result } = renderScanHook();
    await waitFor(() => expect(result.current.status).not.toBe('checking'));
    expect(result.current.danishOcrInstall).toBeNull();
  });
});
