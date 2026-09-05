import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  // M2: panel mount'ta kalıcı izleme durumunu sorgular (WATCH_ALREADY_ACTIVE
  // kilitlenmesine karşı Durdur yolu).
  getIdentityWatchStatus: vi.fn(async () => null),
  onIdentityWatchScan: vi.fn(async () => () => undefined),
}));

import {
  acquireIdentityScan,
  getIdentityScannerCapabilities,
  getIdentityWatchStatus,
  startIdentityWatch,
  stopIdentityWatch,
  type IdentityScannerCapabilities,
} from '@/lib/desktop';

import { CustomerOcrPanel } from '../CustomerOcrPanel';

const WINDOWS_CAPABILITIES: IdentityScannerCapabilities = {
  supported: true,
  platform: 'windows',
  wiaAcquisition: true,
  localOcr: true,
  imageFileFallback: true,
  watchFolder: true,
  maxFileBytes: 10 * 1024 * 1024,
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/tiff', 'image/bmp'],
  ocrDanishAvailable: true,
  ocrProfileLanguage: 'da-DK',
  ocrAvailableLanguages: ['da-DK', 'en-US'],
};

const mockedCapabilities = vi.mocked(getIdentityScannerCapabilities);
const mockedAcquire = vi.mocked(acquireIdentityScan);
const mockedStartWatch = vi.mocked(startIdentityWatch);
const mockedStopWatch = vi.mocked(stopIdentityWatch);
const mockedGetWatchStatus = vi.mocked(getIdentityWatchStatus);

beforeEach(() => {
  vi.clearAllMocks();
  mockedCapabilities.mockResolvedValue(WINDOWS_CAPABILITIES);
  // clearAllMocks implementation'ları silmediğinden kalıcı-durum mock'u
  // testler arası sızmamasın diye her seferinde sıfıra çekilir.
  mockedGetWatchStatus.mockResolvedValue(null);
});

// İş 4 — panel yüzeyi: "Klasörden" akışı, izleme rozeti ve ekranda hata kodu.
describe('CustomerOcrPanel (İş 4 klasör izleme + hata kodu)', () => {
  it('watch yetenegi yoksa Klasörden butonu görünmez', async () => {
    mockedCapabilities.mockResolvedValue({ ...WINDOWS_CAPABILITIES, watchFolder: false });
    render(<CustomerOcrPanel onApply={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Tarayıcıdan')).toBeEnabled());
    expect(screen.queryByRole('button', { name: /klasörden/i })).toBeNull();
    // Aynı yerleşimde dosya/secim butonları durur.
    expect(screen.getByText('Dosyadan')).toBeEnabled();
  });

  it('Klasörden izlemeyi başlatır; rozet klasörü gösterir ve Durdur kapatır', async () => {
    mockedStartWatch.mockResolvedValue({
      active: true,
      folder: 'C:\\Users\\Recai\\Pictures\\SeroGuld-Scan',
      side: 'front',
    });
    mockedStopWatch.mockResolvedValue({ active: false, folder: null, side: 'front' });
    render(<CustomerOcrPanel onApply={vi.fn()} />);

    const watchButton = await screen.findByRole('button', { name: /klasörden/i });
    fireEvent.click(watchButton);
    await waitFor(() => expect(mockedStartWatch).toHaveBeenCalledWith('front', undefined));
    // Rozet: izleme açık + klasör yolu + Durdur kontrolü.
    expect(await screen.findByText(/Klasör izleme açık/i)).toBeInTheDocument();
    expect(screen.getByText(/SeroGuld-Scan/)).toBeInTheDocument();
    // İzleme açıkken Klasörden butonu yerini rozete bırakır.
    expect(screen.queryByRole('button', { name: /klasörden/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /durdur/i }));
    await waitFor(() => expect(mockedStopWatch).toHaveBeenCalledTimes(1));
    // Durdurunca rozet kalkar, buton geri gelir.
    await waitFor(() => expect(screen.getByRole('button', { name: /klasörden/i })).toBeInTheDocument());
    expect(screen.queryByText(/Klasör izleme açık/i)).toBeNull();
  });

  it('tarayıcı hatası ekranda teşhis koduyla ayrışır (SCANNER_UNAVAILABLE ≠ iptal)', async () => {
    mockedAcquire.mockRejectedValue({
      code: 'SCANNER_UNAVAILABLE',
      message: 'WIA tarayıcı hizmeti veya cihazı kullanılamıyor.',
      retryable: true,
    });
    render(<CustomerOcrPanel onApply={vi.fn()} />);
    fireEvent.click(await screen.findByText('Tarayıcıdan'));
    // İş 4: exit 3 (cihaz yok) artık iptal sanılmaz — kod ekranda.
    expect(await screen.findByText('Hata kodu: SCANNER_UNAVAILABLE')).toBeInTheDocument();
    // Saha metni cihaz-açık/ağda + WIA sürücüsü yönlendirmesini taşır.
    expect(screen.getByText(/WIA/)).toBeInTheDocument();
    expect(screen.getByText(/ağda/)).toBeInTheDocument();
  });

  // M2: panel kapalıyken başlayan izleme mount'ta geri yüklenir — kullanıcı
  // WATCH_ALREADY_ACTIVE'e rağmen Durdur yoluna sahiptir.
  it('mount\'ta kalıcı izleme durumunu geri yükler ve Durdur izlemeyi kapatır', async () => {
    vi.mocked(getIdentityWatchStatus).mockResolvedValue({
      active: true,
      folder: 'C:\\Users\\Recai\\Pictures\\SeroGuld-Scan',
      side: 'front',
    });
    mockedStopWatch.mockResolvedValue({ active: false, folder: null, side: 'front' });

    render(<CustomerOcrPanel onApply={vi.fn()} />);

    // Klasörden tıklanmadan rozet geri gelir (hook watchStatus'u null iken bile).
    expect(await screen.findByText(/Klasör izleme açık/i)).toBeInTheDocument();
    expect(screen.getByText(/SeroGuld-Scan/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /durdur/i }));
    await waitFor(() => expect(mockedStopWatch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(/Klasör izleme açık/i)).toBeNull());
    // İzleme kapandıktan sonra Klasörden butonu geri gelir.
    await waitFor(() => expect(screen.getByRole('button', { name: /klasörden/i })).toBeInTheDocument());
  });

  it('WATCH_ALREADY_ACTIVE hatasında İzlemeyi durdur aksiyonu sunar', async () => {
    mockedStartWatch.mockRejectedValue({
      code: 'WATCH_ALREADY_ACTIVE',
      message: 'Klasör izleme zaten aktif.',
      retryable: false,
    });
    mockedStopWatch.mockResolvedValue({ active: false, folder: null, side: 'front' });

    render(<CustomerOcrPanel onApply={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /klasörden/i }));

    expect(await screen.findByText('Hata kodu: WATCH_ALREADY_ACTIVE')).toBeInTheDocument();
    // Türkçe 'İ' Unicode küçültmede birleşik karakter ürettiğinden exact eşleşme kullanılır.
    fireEvent.click(screen.getByRole('button', { name: 'İzlemeyi durdur' }));
    await waitFor(() => expect(mockedStopWatch).toHaveBeenCalledTimes(1));
  });
});
