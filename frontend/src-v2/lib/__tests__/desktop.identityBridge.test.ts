import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => Boolean((globalThis as { isTauri?: boolean }).isTauri),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  IdentityScannerBridgeError,
  acquireIdentityScan,
  getIdentityScannerCapabilities,
  identityScanFromBytes,
} from '../desktop';

const TAURI_CAPABILITIES = {
  supported: true,
  platform: 'windows',
  wiaAcquisition: true,
  localOcr: true,
  imageFileFallback: true,
  maxFileBytes: 10 * 1024 * 1024,
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/tiff', 'image/bmp'],
};

function setTauriGlobal(value: boolean) {
  (globalThis as { isTauri?: boolean }).isTauri = value ? true : undefined;
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  setTauriGlobal(false);
});

describe('identity scanner bridge (roadmap madde 3)', () => {
  it('Tauri olmayan ortamda acik destek-yok doner ve invoke hic cagrilmaz', async () => {
    setTauriGlobal(false);
    const caps = await getIdentityScannerCapabilities();
    expect(caps.supported).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
    await expect(identityScanFromBytes('front', 'aGk=')).rejects.toMatchObject({
      code: 'UNSUPPORTED_PLATFORM',
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('Tauri modunda yetenekler invoke uzerinden gelir', async () => {
    setTauriGlobal(true);
    invokeMock.mockResolvedValueOnce(TAURI_CAPABILITIES);
    const caps = await getIdentityScannerCapabilities();
    expect(caps.supported).toBe(true);
    expect(caps.wiaAcquisition).toBe(true);
    expect(caps.imageFileFallback).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('get_identity_scanner_capabilities', undefined);
  });

  it('hata payload ini IdentityScannerBridgeError a normalize eder', async () => {
    setTauriGlobal(true);
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_identity_scanner_capabilities') return Promise.resolve(TAURI_CAPABILITIES);
      return Promise.reject({
        code: 'ACQUISITION_FAILED',
        message: 'Tarama tamamlanamadi — cihaz mesgul veya yanit vermiyor olabilir.',
        retryable: true,
      });
    });
    await expect(acquireIdentityScan('front')).rejects.toBeInstanceOf(IdentityScannerBridgeError);
    await expect(acquireIdentityScan('front')).rejects.toMatchObject({
      code: 'ACQUISITION_FAILED',
      message: 'Tarama tamamlanamadi — cihaz mesgul veya yanit vermiyor olabilir.',
      retryable: true,
    });
  });

  it('taninmayan hata sekilleri BRIDGE_UNAVAILABLE olur', async () => {
    setTauriGlobal(true);
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_identity_scanner_capabilities') return Promise.resolve(TAURI_CAPABILITIES);
      return Promise.reject('patladi');
    });
    await expect(acquireIdentityScan('back')).rejects.toMatchObject({
      code: 'BRIDGE_UNAVAILABLE',
    });
  });
});
