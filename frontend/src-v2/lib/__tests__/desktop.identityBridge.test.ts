import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => Boolean((globalThis as { isTauri?: boolean }).isTauri),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

import {
  IdentityScannerBridgeError,
  acquireIdentityScan,
  getIdentityScannerCapabilities,
  identityScanFromBytes,
  onIdentityWatchScan,
  startIdentityWatch,
  stopIdentityWatch,
} from '../desktop';

const TAURI_CAPABILITIES = {
  supported: true,
  platform: 'windows',
  wiaAcquisition: true,
  localOcr: true,
  imageFileFallback: true,
  watchFolder: true,
  maxFileBytes: 10 * 1024 * 1024,
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/tiff', 'image/bmp'],
};

function setTauriGlobal(value: boolean) {
  (globalThis as { isTauri?: boolean }).isTauri = value ? true : undefined;
}

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
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

  it('klasor izleme non-Tauri ortamda graceful UNSUPPORTED_PLATFORM alir', async () => {
    setTauriGlobal(false);
    await expect(startIdentityWatch('front')).rejects.toMatchObject({
      code: 'UNSUPPORTED_PLATFORM',
    });
    expect(invokeMock).not.toHaveBeenCalled();
    // Durdurma hata degil pasif durumdur (Windows dista hic baslamamistir).
    const stopped = await stopIdentityWatch();
    expect(stopped).toEqual({ active: false, folder: null, side: 'front' });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('startIdentityWatch side ve (trim edilmis) folder i komuta gecer', async () => {
    setTauriGlobal(true);
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_identity_scanner_capabilities') return Promise.resolve(TAURI_CAPABILITIES);
      if (command === 'start_identity_watch') {
        return Promise.resolve({ active: true, folder: 'C:\\Scan', side: 'front' });
      }
      return Promise.reject(new Error(`beklenmedik komut: ${command}`));
    });
    const status = await startIdentityWatch('front');
    expect(status).toEqual({ active: true, folder: 'C:\\Scan', side: 'front' });
    expect(invokeMock).toHaveBeenCalledWith('start_identity_watch', { side: 'front', folder: null });
    await startIdentityWatch('back', '  D:\\Tarayici  ');
    expect(invokeMock).toHaveBeenLastCalledWith('start_identity_watch', {
      side: 'back',
      folder: 'D:\\Tarayici',
    });
  });

  it('WATCH_* hata kodlari normalizasyondan ayri kod olarak gecer', async () => {
    setTauriGlobal(true);
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_identity_scanner_capabilities') return Promise.resolve(TAURI_CAPABILITIES);
      return Promise.reject({
        code: 'WATCH_ALREADY_ACTIVE',
        message: 'Klasör izleme zaten etkin — önce durdurun.',
        retryable: false,
      });
    });
    await expect(startIdentityWatch('front')).rejects.toBeInstanceOf(IdentityScannerBridgeError);
    await expect(startIdentityWatch('front')).rejects.toMatchObject({
      code: 'WATCH_ALREADY_ACTIVE',
      retryable: false,
    });
  });

  it('onIdentityWatchScan identity-watch-scan ve identity-watch-error olaylarina abone olur', async () => {
    setTauriGlobal(true);
    const unlisten = vi.fn();
    listenMock.mockImplementation((event: string) => {
      expect(['identity-watch-scan', 'identity-watch-error']).toContain(event);
      return Promise.resolve(unlisten);
    });
    const onScan = vi.fn();
    const onError = vi.fn();
    const unsubscribe = await onIdentityWatchScan(onScan, onError);
    expect(listenMock).toHaveBeenCalledWith('identity-watch-scan', expect.any(Function));
    expect(listenMock).toHaveBeenCalledWith('identity-watch-error', expect.any(Function));
    const scanCall = listenMock.mock.calls.find(([event]) => event === 'identity-watch-scan') as [string, (event: unknown) => void];
    scanCall[1]({ payload: { side: 'front', source: 'watch' } });
    expect(onScan).toHaveBeenCalledWith({ side: 'front', source: 'watch' });
    const errorCall = listenMock.mock.calls.find(([event]) => event === 'identity-watch-error') as [string, (event: unknown) => void];
    errorCall[1]({ payload: { code: 'INVALID_IMAGE', message: 'görüntü geçersiz', retryable: false } });
    expect(onError).toHaveBeenCalledWith({ code: 'INVALID_IMAGE', message: 'görüntü geçersiz', retryable: false });
    unsubscribe();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it('onIdentityWatchScan non-Tauri ortamda sessiz no-op abonelik doner', async () => {
    setTauriGlobal(false);
    const unsubscribe = await onIdentityWatchScan(vi.fn(), vi.fn());
    expect(listenMock).not.toHaveBeenCalled();
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });
});
