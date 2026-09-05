import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/lib/toast';
import { ApiError } from '@/lib/api';
import type { DashboardLegacyScreen } from '../types';

// Node 26 + jsdom kurulumunda window.localStorage tanımsız geliyor
// (opaque origin / --localstorage-file); basit in-memory Storage taklağı.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(String(key), String(value));
  }
  removeItem(key: string) {
    this.store.delete(String(key));
  }
  clear() {
    this.store.clear();
  }
  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }
  get length() {
    return this.store.size;
  }
}

beforeAll(() => {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (typeof window[name] === 'undefined') {
      Object.defineProperty(window, name, {
        value: new MemoryStorage(),
        configurable: true,
        writable: false,
      });
    }
  }
});

const apiRequestMock = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    apiRequest: (...args: Parameters<typeof import('@/lib/api').apiRequest>) => apiRequestMock(...args),
  };
});

// Sürüm tanısı gerçek Tauri köprüsüne gitmesin.
vi.mock('@/lib/desktop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/desktop')>();
  return {
    ...actual,
    getDesktopStartupState: () => Promise.resolve(null),
  };
});

import { MakeDashboardPage } from '../DashboardPage';
import { useDashboardMakeState, type DashboardMakeState } from '../useDashboardMakeState';

const LEGACY_SCREEN: DashboardLegacyScreen = {
  alisSayisi: 3,
  alisToplamKr: 4500,
  sonAlislar: [{ id: '1', afregningsnr: 'AFG-1', dato: '2026-09-01T08:00:00Z', musteri: 'Recai', total: 1500 }],
  aylikAlis: [],
  musteriSayisi: 7,
  sonMusteriler: [{ id: '9', navn: 'Ada Yılmaz', kayitTarihi: '2026-09-01T08:00:00Z' }],
  depoToplamItem: 12,
  depoSpotDeger: 9000,
  depoAlisDeger: 7000,
  depoByCat: [],
  wooHazir: 4,
  wooFoto: 2,
  wooLisitlendi: 6,
  logSayisi: 3,
  ayirmaSayisi: 1,
  eritmeSayisi: 0,
  eritmeToplamHasAltin: 0,
  eritmeToplamPayout: 0,
  goldPrice: 615.5,
  silverPrice: 7.8,
  platinPrice: 280,
  palladyumPrice: 335,
  opmcYuksek: 1,
  opmcOrta: 0,
  opmcDusuk: 0,
  opmcBelirsiz: 0,
  opmcManuel: 2,
  faturaAdedi: 1,
  faturaToplamKr: 1500,
};

const EMPTY_SCREEN: DashboardLegacyScreen = {
  ...LEGACY_SCREEN,
  alisSayisi: 0,
  alisToplamKr: 0,
  sonAlislar: [],
  musteriSayisi: 0,
  sonMusteriler: [],
  depoToplamItem: 0,
  depoSpotDeger: 0,
  depoAlisDeger: 0,
  wooHazir: 0,
  wooFoto: 0,
  wooLisitlendi: 0,
  logSayisi: 0,
  ayirmaSayisi: 0,
  opmcYuksek: 0,
  opmcManuel: 0,
  faturaAdedi: 0,
  faturaToplamKr: 0,
};

const LEGACY_ENDPOINT = '/api/v2/dashboard';

function dashboardCalls() {
  return apiRequestMock.mock.calls.filter(([url]) => String(url) === LEGACY_ENDPOINT).length;
}

function legacyRejectsForever() {
  apiRequestMock.mockImplementation((url: unknown) => {
    if (String(url) === LEGACY_ENDPOINT) {
      return Promise.reject(new ApiError(500, 'pano şu an kapalı', undefined, LEGACY_ENDPOINT));
    }
    return Promise.reject(new Error(`Beklenmeyen istek: ${String(url)}`));
  });
}

function renderClassicDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let latest: DashboardMakeState | null = null;
  function Harness() {
    const state = useDashboardMakeState('classic');
    latest = state;
    return <MakeDashboardPage {...state} />;
  }
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Harness />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return {
    get state(): DashboardMakeState {
      return latest!;
    },
  };
}

beforeEach(() => {
  apiRequestMock.mockReset();
  legacyRejectsForever();
});

describe('Classic pano — hata yüzeyi (sıfır dolu sahte pano yok)', () => {
  it('ilk yükleme hatasında sıfır dolu pano yerine ayrı hata paneli + Tekrar dene gösterir', async () => {
    const harness = renderClassicDashboard();

    // Hata mesajı (ApiError uç nokta + status detayıyla) yüzeye çıkar
    expect(await screen.findByText(/pano şu an kapalı/)).toBeInTheDocument();
    expect(screen.getByText(/Uç nokta: \/api\/v2\/dashboard → HTTP 500\./)).toBeInTheDocument();

    // Sıfır dolu pano YOK: KPI kartları ve boş-durum metinleri çizilmez
    expect(screen.queryByText('Alış Sayısı')).not.toBeInTheDocument();
    expect(screen.queryByText('Henüz alış kaydı yok')).not.toBeInTheDocument();
    expect(screen.queryByText('Depo Özeti')).not.toBeInTheDocument();

    // Ayrı hata durumu: panel başlığı + retry
    expect(screen.getByText('Yönetim özeti yüklenemedi')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /Tekrar dene/ });
    expect(retry).toBeInTheDocument();

    // Retry gerçekten refetch tetikler
    const before = dashboardCalls();
    fireEvent.click(retry);
    await waitFor(() => expect(dashboardCalls()).toBeGreaterThan(before));
    // Hâlâ hata: sahte pano yine görünmez
    expect(screen.getByText('Yönetim özeti yüklenemedi')).toBeInTheDocument();
    expect(screen.queryByText('Alış Sayısı')).not.toBeInTheDocument();

    expect(harness.state.errorMessage).toContain('pano şu an kapalı');
    expect(harness.state.hasServerData).toBe(false);
  });

  it('veri hiç alınmadıysa lastRefresh "—" olur; sahte saat gösterilmez', async () => {
    renderClassicDashboard();

    await screen.findByText(/pano şu an kapalı/);

    // Header saati: veri yokken "—" (panel modunda gövde çizilmediği için başka "—" yok)
    expect(screen.getByText('Son guncelleme: —')).toBeInTheDocument();
    expect(screen.queryByText(/Son guncelleme: \d/)).not.toBeInTheDocument();
  });

  it('bayat veri + yenileme hatasında şerit gösterilir, bayat pano sıfırlanmadan kalır', async () => {
    let calls = 0;
    apiRequestMock.mockImplementation((url: unknown) => {
      if (String(url) === LEGACY_ENDPOINT) {
        calls += 1;
        if (calls === 2) {
          return Promise.reject(new ApiError(500, 'pano şu an kapalı', undefined, LEGACY_ENDPOINT));
        }
        return Promise.resolve(LEGACY_SCREEN);
      }
      return Promise.reject(new Error(`Beklenmeyen istek: ${String(url)}`));
    });

    const harness = renderClassicDashboard();

    // İlk yükleme başarılı: pano + gerçek son güncelleme saati
    expect(await screen.findByText('Alış Sayısı')).toBeInTheDocument();
    expect(harness.state.lastRefresh).toBeInstanceOf(Date);
    expect(harness.state.errorMessage).toBeNull();
    expect(screen.getByText(/Son guncelleme: \d/)).toBeInTheDocument();

    // Yenileme başarısız: hata şeridi + Tekrar dene, ama bayat veri durur
    fireEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    expect(await screen.findByText('Pano güncellenemedi')).toBeInTheDocument();
    expect(screen.getByText(/pano şu an kapalı/)).toBeInTheDocument();
    expect(harness.state.errorMessage).toContain('pano şu an kapalı');
    expect(screen.getByText('Alış Sayısı')).toBeInTheDocument();
    expect(harness.state.lastRefresh).toBeInstanceOf(Date);

    // Şeritteki Tekrar dene refetch eder; başarılıysa şerit kalkar
    fireEvent.click(screen.getByRole('button', { name: /Tekrar dene/ }));
    await waitFor(() => expect(screen.queryByText('Pano güncellenemedi')).not.toBeInTheDocument());
    expect(harness.state.errorMessage).toBeNull();
    expect(screen.getByText('Alış Sayısı')).toBeInTheDocument();
  });

  it('gerçekten boş veri (başarılı yanıt) hata değildir: boş-durum metinleriyle normal pano', async () => {
    apiRequestMock.mockImplementation((url: unknown) => {
      if (String(url) === LEGACY_ENDPOINT) return Promise.resolve(EMPTY_SCREEN);
      return Promise.reject(new Error(`Beklenmeyen istek: ${String(url)}`));
    });

    const harness = renderClassicDashboard();

    expect(await screen.findByText('Alış Sayısı')).toBeInTheDocument();
    // Boşluk boşluğadır, hata değil: hata yüzeyi yok
    expect(screen.queryByText('Yönetim özeti yüklenemedi')).not.toBeInTheDocument();
    expect(screen.queryByText('Pano güncellenemedi')).not.toBeInTheDocument();
    expect(harness.state.errorMessage).toBeNull();
    expect(harness.state.hasServerData).toBe(true);
    // Bölüm boş-durumları aynen korunur
    expect(screen.getByText('Henüz alış kaydı yok')).toBeInTheDocument();
    expect(screen.getByText('Müşteri kaydı yok')).toBeInTheDocument();
    // Son güncelleme artık gerçek: sahte "—" yok
    expect(harness.state.lastRefresh).toBeInstanceOf(Date);
    expect(screen.queryByText('Son guncelleme: —')).not.toBeInTheDocument();
    expect(screen.getByText(/Son guncelleme: \d/)).toBeInTheDocument();
  });
});
