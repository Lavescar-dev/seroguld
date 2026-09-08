import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/desktop', () => ({
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
  type IdentityScanResult,
  type IdentityScannerCapabilities,
} from '@/lib/desktop';
import {
  fetchIdentityExtractCapabilities,
  requestIdentityExtract,
  type IdentityExtractResponse,
} from '@/lib/identityExtract';
import { useIdentityScan } from '../identityScan';
import type { EditableCustomer } from '../types';

const mockedCapabilities = vi.mocked(fetchIdentityExtractCapabilities);
const mockedExtract = vi.mocked(requestIdentityExtract);
const mockedAcquire = vi.mocked(acquireIdentityScan);
const mockedScannerCaps = vi.mocked(getIdentityScannerCapabilities);

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
  mockedCapabilities.mockResolvedValue({ extract_enabled: false, model: null, barcode_available: true });
  mockedExtract.mockResolvedValue(extractPayload());
});

function renderScanHook() {
  return renderHook(() => useIdentityScan({
    customer: emptyCustomer,
    setCustomer: vi.fn(),
    uiVariant: 'modern',
  }));
}

async function scanFront() {
  mockedAcquire.mockResolvedValue(scanResult());
  const { result } = renderScanHook();
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () => {
    await result.current.acquire('front');
  });
  return result;
}

describe('useIdentityScan VLM motor seçimi (R1-B)', () => {
  it('flag kapalıyken VLM isteği ATILMAZ, yalnız yerel regex çalışır', async () => {
    mockedCapabilities.mockResolvedValue({ extract_enabled: false, model: null, barcode_available: true });
    const result = await scanFront();
    await waitFor(() => expect(result.current.status).toBe('review'));
    expect(mockedExtract).not.toHaveBeenCalled();
    // Yerel zincir 6 haneli CPR verir (plausibleCprSix kırpması regex dalına özgü).
    expect(result.current.result?.fields.cpr_number?.value).toBe('010101');
    expect(result.current.vlmNotice).toBeNull();
  });

  it('flag açıkken VLM birincil gelir: tam 10 haneli CPR yerel 6 hanenin üstüne yazar', async () => {
    mockedCapabilities.mockResolvedValue({ extract_enabled: true, model: 'gpt-5-mini', barcode_available: true });
    const result = await scanFront();
    await waitFor(() => expect(mockedExtract).toHaveBeenCalledTimes(1));
    expect(mockedExtract).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA', 'front');
    await waitFor(() => expect(result.current.result?.fields.cpr_number?.value).toBe('0101011119'));
    expect(result.current.result?.fields.cpr_number?.review).toBe('validated');
    // VLM'in bulduğu, regexin bulamadığı alan da gelir.
    expect(result.current.result?.fields.city?.value).toBe('Testby');
    expect(result.current.vlmNotice).toBeNull();
  });

  it('önizleme yoksa VLM isteği atılır (görüntüsüz çıkarım istenmez)', async () => {
    mockedCapabilities.mockResolvedValue({ extract_enabled: true, model: 'gpt-5-mini', barcode_available: true });
    mockedAcquire.mockResolvedValue(scanResult({ previewDataUrl: '' }));
    const { result } = renderScanHook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.acquire('front');
    });
    await waitFor(() => expect(result.current.status).toBe('review'));
    expect(mockedExtract).not.toHaveBeenCalled();
  });

  it('VLM hatası yerel sonucu EZMEZ — görünür uyarı üretilir', async () => {
    mockedCapabilities.mockResolvedValue({ extract_enabled: true, model: 'gpt-5-mini', barcode_available: true });
    mockedExtract.mockRejectedValue(new Error('502 upstream'));
    const result = await scanFront();
    await waitFor(() => expect(result.current.vlmNotice).toContain('kontrol edin'));
    // Yerel regex sonucu hâlâ sahada.
    expect(result.current.status).toBe('review');
    expect(result.current.result?.fields.cpr_number?.value).toBe('010101');
  });

  it('yetenek sorgusu başarısız olsa da tarama çalışır (VLM sessizce atlanır)', async () => {
    mockedCapabilities.mockRejectedValue(new Error('network'));
    mockedAcquire.mockResolvedValue(scanResult());
    const { result } = renderScanHook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.acquire('front');
    });
    await waitFor(() => expect(result.current.status).toBe('review'));
    expect(mockedExtract).not.toHaveBeenCalled();
    expect(result.current.result?.fields.cpr_number?.value).toBe('010101');
  });

  it('clear sonrası gelen geç VLM yanıtı yazılmaz', async () => {
    mockedCapabilities.mockResolvedValue({ extract_enabled: true, model: 'gpt-5-mini', barcode_available: true });
    let resolveExtract: (value: ReturnType<typeof extractPayload>) => void = () => undefined;
    mockedExtract.mockReturnValue(new Promise((resolve) => { resolveExtract = resolve; }));
    mockedAcquire.mockResolvedValue(scanResult());
    const { result } = renderScanHook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.acquire('front');
    });
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
