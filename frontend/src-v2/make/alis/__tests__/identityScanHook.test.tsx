import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/desktop', () => ({
  getIdentityScannerCapabilities: vi.fn(),
  acquireIdentityScan: vi.fn(),
  pickIdentityScanFile: vi.fn(),
  identityScanFromBytes: vi.fn(),
  discardIdentityScan: vi.fn(),
  writeUiDiagnostic: vi.fn(),
}));

import {
  acquireIdentityScan,
  getIdentityScannerCapabilities,
  identityScanFromBytes,
  writeUiDiagnostic,
  type IdentityScanResult,
  type IdentityScannerCapabilities,
} from '@/lib/desktop';
import { useIdentityScan } from '../identityScan';
import type { EditableCustomer } from '../types';

const emptyCustomer: EditableCustomer = {
  name: '', email: '', phone: '', address: '', postal_code: '', city: '', cpr_number: '', identity_doc_type: '', identity_doc_number: '', identity_doc_country: '',
};

const TD3_PASSPORT = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
].join('\n');

const TAURI_CAPABILITIES: IdentityScannerCapabilities = {
  supported: true,
  platform: 'windows',
  wiaAcquisition: true,
  localOcr: true,
  imageFileFallback: true,
  maxFileBytes: 10 * 1024 * 1024,
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/tiff', 'image/bmp'],
  ocrDanishAvailable: true,
  ocrProfileLanguage: 'da-DK',
  ocrAvailableLanguages: ['da-DK', 'en-US'],
};

const scanResult = (overrides: Partial<IdentityScanResult> = {}): IdentityScanResult => ({
  side: 'front',
  source: 'wia',
  mimeType: 'image/jpeg',
  previewDataUrl: '',
  ocrText: TD3_PASSPORT,
  ocrLines: TD3_PASSPORT.split('\n'),
  ocrLanguage: 'da-DK',
  ocrRequestedLanguage: 'da-DK',
  ocrMaxImageDimension: 2600,
  imageScaled: false,
  imageSourceWidth: 1011,
  imageSourceHeight: 1099,
  ...overrides,
});

const mockedCapabilities = vi.mocked(getIdentityScannerCapabilities);
const mockedAcquire = vi.mocked(acquireIdentityScan);
const mockedFromBytes = vi.mocked(identityScanFromBytes);
const mockedWriteDiagnostic = vi.mocked(writeUiDiagnostic);

beforeEach(() => {
  vi.clearAllMocks();
  mockedCapabilities.mockResolvedValue(TAURI_CAPABILITIES);
});

describe('useIdentityScan hook (roadmap madde 3)', () => {
  it('yetenek hazir oldugunda ready durumuna gecer', async () => {
    const { result } = renderHook(() => useIdentityScan({ customer: emptyCustomer, setCustomer: vi.fn() }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.capabilities).toEqual({
      scanner: true,
      file: true,
      message: undefined,
      ocr: { danishAvailable: true, profileLanguage: 'da-DK', availableLanguages: ['da-DK', 'en-US'] },
    });
  });

  it('acquire sonrasi MRZ review sonucu ve onizleme uretir', async () => {
    mockedAcquire.mockResolvedValueOnce(scanResult({
      previewDataUrl: 'data:image/png;base64,AAA',
    }));
    const { result } = renderHook(() => useIdentityScan({ customer: emptyCustomer, setCustomer: vi.fn() }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.acquire('front');
    });
    expect(result.current.status).toBe('review');
    expect(result.current.result?.documentType).toBe('passport');
    expect(result.current.result?.fields.name?.value).toBe('ANNA MARIA ERIKSSON');
    expect(result.current.previews.front).toBe('data:image/png;base64,AAA');
  });

  it('tarama hatasinda ready durumuna doner ve mesaji gosterir', async () => {
    mockedAcquire.mockRejectedValueOnce(new Error('Tarama tamamlanamadi — cihaz mesgul veya yanit vermiyor olabilir.'));
    const { result } = renderHook(() => useIdentityScan({ customer: emptyCustomer, setCustomer: vi.fn() }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.acquire('front');
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toContain('cihaz mesgul');
  });

  it('dropFile goruntuyu base64 olarak byte akisina gonderir', async () => {
    const licenceText = 'KØREKORT\n1. NIELSEN\n2. LARS\n5. ABC123456\n8. Hovedgade 1, 2100 KOBENHAVN\nDK';
    mockedFromBytes.mockResolvedValueOnce(scanResult({ ocrText: licenceText, ocrLines: licenceText.split('\n') }));
    const { result } = renderHook(() => useIdentityScan({ customer: emptyCustomer, setCustomer: vi.fn() }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const file = new File([new Uint8Array([104, 105])], 'id.jpg', { type: 'image/jpeg' });
    await act(async () => {
      await result.current.dropFile(file, 'front');
    });
    expect(mockedFromBytes).toHaveBeenCalledWith('front', 'aGk=');
    expect(result.current.status).toBe('review');
    expect(result.current.result?.documentType).toBe('driver_license');
  });

  it('ön+arka yüz taraması birleşir: basılı ad MRZ adını ezmez, eksik belge no dolar', async () => {
    const printedPas = 'KONGERIGET DANMARK\nEfternavn\nYILMAZ\nFornavn\nAHMET\nPasnr.';
    const backMrz = TD3_PASSPORT;
    mockedAcquire.mockResolvedValueOnce(scanResult({ ocrText: printedPas, ocrLines: printedPas.split('\n') }));
    mockedAcquire.mockResolvedValueOnce(scanResult({ side: 'back', ocrText: backMrz, ocrLines: backMrz.split('\n') }));
    const { result } = renderHook(() => useIdentityScan({ customer: emptyCustomer, setCustomer: vi.fn() }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.acquire('front');
    });
    await act(async () => {
      await result.current.acquire('back');
    });
    expect(result.current.status).toBe('review');
    // Basılı ad kanonik kalır; MRZ transliterasyonu (ERIKSSON) ezmez.
    expect(result.current.result?.fields.name?.value).toBe('AHMET YILMAZ');
    // Ön yüzde Pasnr. değeri yoktu — MRZ doldurur.
    expect(result.current.result?.fields.identity_doc_number?.value).toBe('L898902C3');

    // Aynı yüz yeniden taranırsa o yüzün sonucu güncellenir (bozuk tarama
    // düzeltilebilir); basılı Pasnr. artık dolu — ön yüz kazanır.
    const corrected = 'KONGERIGET DANMARK\nEfternavn\nYILMAZ\nFornavn\nAHMET CAN\nPasnr.\n1234567';
    mockedAcquire.mockResolvedValueOnce(scanResult({ ocrText: corrected, ocrLines: corrected.split('\n') }));
    await act(async () => {
      await result.current.acquire('front');
    });
    expect(result.current.result?.fields.name?.value).toBe('AHMET CAN YILMAZ');
    expect(result.current.result?.fields.identity_doc_number?.value).toBe('1234567');
  });

  it('basarili taramada saha teshisi uretilir: atomik ozet + maskeli satirlar, isim doluysa uyari yok', async () => {
    mockedAcquire.mockResolvedValueOnce(scanResult({ ocrText: TD3_PASSPORT, ocrLines: TD3_PASSPORT.split('\n') }));
    const { result } = renderHook(() => useIdentityScan({ customer: emptyCustomer, setCustomer: vi.fn() }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.acquire('front');
    });
    expect(result.current.status).toBe('review');
    expect(mockedWriteDiagnostic).toHaveBeenCalledTimes(1);
    const payload = mockedWriteDiagnostic.mock.calls[0][0];
    expect(payload.route).toBe('/alis/identity-scan');
    expect(payload.uiVariant).toBe('modern');
    // Atomik özet: PII yok — yalnız yüz, dil, satır sayısı, ölçek etiketi ve dolu alan harfleri.
    expect(payload.errorCode).toMatch(/^idscan\.front\.da-DK\.2L\.\d+F\.NS\.[A-Z]+$/);
    expect(payload.errorCode).not.toContain('ERIKSSON');
    expect(result.current.scanMeta).toMatchObject({
      side: 'front',
      language: 'da-DK',
      lineCount: 2,
      fieldKeys: expect.arrayContaining(['name', 'identity_doc_number']),
    });
    expect(result.current.diagnostic).toContain('(44)');
    await act(async () => {
      result.current.confirm();
    });
    expect(result.current.scanMeta).toBeNull();
    expect(result.current.diagnostic).toBeNull();
    expect(mockedWriteDiagnostic).toHaveBeenCalledTimes(1);
  });

  it('isim okunmayan tarama tesiste isaretlenir ama alanlar yine onaya gider', async () => {
    const noName = 'KØREKORT\n4d.200485-2985\n5. 30499459';
    mockedAcquire.mockResolvedValueOnce(scanResult({ ocrText: noName, ocrLines: noName.split('\n') }));
    const { result } = renderHook(() => useIdentityScan({ customer: emptyCustomer, setCustomer: vi.fn() }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.acquire('front');
    });
    expect(result.current.status).toBe('review');
    expect(result.current.scanMeta?.fieldKeys).not.toContain('name');
    expect(result.current.scanMeta?.fieldKeys).toContain('identity_doc_number');
    // Özetin alan harflerinde N (name) yok — son segment yalnız dolu alanların baş harfleri.
    expect(mockedWriteDiagnostic.mock.calls[0][0].errorCode.split('.').pop()).not.toContain('N');
  });

  it('confirm uygulanan sonucu setCustomer a aktarir ve durumu temizler', async () => {
    mockedAcquire.mockResolvedValueOnce(scanResult());
    const setCustomer = vi.fn();
    const { result } = renderHook(() => useIdentityScan({ customer: emptyCustomer, setCustomer }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.acquire('front');
    });
    expect(result.current.status).toBe('review');
    await act(async () => {
      result.current.confirm();
    });
    expect(setCustomer).toHaveBeenCalledTimes(1);
    const updater = setCustomer.mock.calls[0][0] as (current: EditableCustomer) => EditableCustomer;
    expect(updater(emptyCustomer)).toMatchObject({
      name: 'ANNA MARIA ERIKSSON',
      identity_doc_type: 'passport',
      identity_doc_number: 'L898902C3',
      identity_doc_country: 'UTO',
    });
    expect(result.current.status).toBe('applied');
    expect(result.current.result).toBeNull();
  });

  it('Danca OCR paketi yoksa ocrNotice uyarisi uretir', async () => {
    mockedCapabilities.mockResolvedValue({
      ...TAURI_CAPABILITIES,
      ocrDanishAvailable: false,
      ocrProfileLanguage: 'tr-TR',
      ocrAvailableLanguages: ['tr-TR'],
    });
    const { result } = renderHook(() => useIdentityScan({ customer: emptyCustomer, setCustomer: vi.fn() }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.ocrNotice).toContain('Danca OCR paketi bulunamadı');
    expect(result.current.ocrNotice).toContain('tr-TR');
  });

  it('taninamayan belgede ham tani maskelemeyle gosterilir; gercek rakamlar sizmaz', async () => {
    const garbage = 'SPECIMEN CARD\nCPR 123456-7890\nOMAR AL-RASHID\nFoo Bar Baz';
    mockedAcquire.mockResolvedValueOnce(scanResult({
      ocrText: garbage,
      ocrLines: garbage.split('\n'),
      imageScaled: true,
      imageSourceWidth: 3024,
      imageSourceHeight: 4032,
    }));
    const { result } = renderHook(() => useIdentityScan({ customer: emptyCustomer, setCustomer: vi.fn() }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.acquire('front');
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('4 satır okundu');
    expect(result.current.error).toContain('OCR dili da-DK');
    expect(result.current.error).toContain('3024×');
    const diagnostic = result.current.diagnostic ?? '';
    expect(diagnostic.length).toBeGreaterThan(0);
    // '-' de harf-sınıfına düşer → 'a' ile maskelenir; rakamlar 9 olur.
    expect(diagnostic).toContain('999999a9999');
    expect(diagnostic).not.toContain('123456');
    expect(diagnostic).not.toContain('OMAR');
  });
});
