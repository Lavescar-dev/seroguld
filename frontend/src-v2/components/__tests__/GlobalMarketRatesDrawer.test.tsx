import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GlobalMarketRateProfile } from '../GlobalMarketRatesDrawer';

const apiRequestMock = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    apiRequest: (...args: Parameters<typeof import('@/lib/api').apiRequest>) => apiRequestMock(...args),
  };
});

const toastMocks = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };

vi.mock('@/lib/toast', () => ({
  useToast: () => toastMocks,
}));

import { GlobalMarketRatesDrawer, useGlobalMarketRates } from '../GlobalMarketRatesDrawer';

const PROFILE: GlobalMarketRateProfile = {
  eur_dkk_fx: '7.45',
  gold_rates_dkk: {
    '8': '205.00',
    '14': '359.04',
    '18': '461.63',
    '21': '538.56',
    '21.6': '553.95',
    '22': '564.21',
    '22b': '564.21',
    '24': '615.50',
  },
  silver_rates_dkk: { '999': '7.80', '925': '7.22', '830': '6.48' },
  gold_24k_dkk: '615.50',
  silver_dkk: '7.80',
  plet_dkk: '0.0200',
  gold_bar_dkk: '615.50',
  silver_bar_dkk: '7.80',
  platinum_dkk: '280.00',
  palladium_dkk: '335.00',
  live_enabled: false,
  source: 'manual',
  rate_meta: {
    eur_dkk_fx: { source: 'manual', observed_at: null, stale: false },
    platinum_dkk: { source: 'manual', observed_at: null, stale: false },
    palladium_dkk: { source: 'manual', observed_at: null, stale: false },
  },
};

function makeProfile(overrides: Partial<GlobalMarketRateProfile> = {}): GlobalMarketRateProfile {
  return { ...PROFILE, ...overrides };
}

// Drawer yalnız controller.isOpen iken render olur; test için açma + doğrudan
// save() çağırma düğmeleri ekleyen minik barındırıcı.
function Harness() {
  const controller = useGlobalMarketRates();
  return (
    <div>
      <button type="button" onClick={controller.open}>open-drawer</button>
      <button type="button" onClick={() => controller.save()}>force-save</button>
      <GlobalMarketRatesDrawer controller={controller} />
    </div>
  );
}

function renderDrawer() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function putCalls() {
  return apiRequestMock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === 'PUT');
}

beforeEach(() => {
  apiRequestMock.mockReset();
  toastMocks.success.mockClear();
  toastMocks.warning.mockClear();
  toastMocks.error.mockClear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('GlobalMarketRatesDrawer — Pletsølv bandı', () => {
  it('plet 0,05 girilince bant uyarısı ÇIKMAZ ve Kaydet onay istemeden gönderir', async () => {
    apiRequestMock.mockResolvedValue(makeProfile());
    renderDrawer();
    fireEvent.click(screen.getByText('open-drawer'));

    const pletInput = await screen.findByLabelText(/Pletsølv DKK\/g/);
    await waitFor(() => expect(pletInput).toHaveValue('0.0200'));

    fireEvent.change(pletInput, { target: { value: '0.05' } });
    expect(pletInput).toHaveValue('0.05');
    // Gerçek plet ~0.02-0.05 DKK/g; gümüş bandı [0.5-100] bunu "bant dışı" sanıyordu.
    expect(screen.queryByText(/Beklenen/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Kaydet$/ }));

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(window.confirm).not.toHaveBeenCalled();
    const body = JSON.parse((putCalls()[0][1] as { body: string }).body) as { plet_dkk: string };
    // Plet 4 hane gönderilir.
    expect(body.plet_dkk).toBe('0.0500');
  });

  it('plet bandı dışı değer (5 → kr/kg karışıklığı) uyarı üretir ve Kaydet onay ister', async () => {
    apiRequestMock.mockResolvedValue(makeProfile());
    renderDrawer();
    fireEvent.click(screen.getByText('open-drawer'));

    const pletInput = await screen.findByLabelText(/Pletsølv DKK\/g/);
    fireEvent.change(pletInput, { target: { value: '5' } });

    expect(screen.getByText(/Beklenen Pletsølv aralığı 0\.001–0\.1 DKK\/g/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Kaydet$/ }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(1));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Pletsølv'));
  });
});

describe('GlobalMarketRatesDrawer — yükleme/hata kilidi', () => {
  it('isLoading iken iskelet gösterilir, Kaydet + WP\'den çek disable ve save() engellidir', async () => {
    apiRequestMock.mockReturnValue(new Promise(() => {})); // hiç çözülmeyen GET
    renderDrawer();
    fireEvent.click(screen.getByText('open-drawer'));

    expect(await screen.findByText(/Piyasa oranları yükleniyor/)).toBeInTheDocument();
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    // Fallback değerler (615.50) gerçek veri gibi GÖSTERİLMEZ.
    expect(screen.queryByLabelText(/Pletsølv DKK\/g/)).toBeNull();

    expect(screen.getByRole('button', { name: /^Kaydet$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /WP.*çek/ })).toBeDisabled();

    // Savunma hattı: disable'a rağmen save() tetiklenirse de PUT gitmez.
    fireEvent.click(screen.getByText('force-save'));
    expect(putCalls()).toHaveLength(0);
  });

  it('isError iken kayıt kilitli: hata bandı + Tekrar dene, Kaydet + WP disable, save() PUT göndermez', async () => {
    apiRequestMock.mockRejectedValue(new Error('boom'));
    renderDrawer();
    fireEvent.click(screen.getByText('open-drawer'));

    expect(await screen.findByText('Global oran profiline ulaşılamadı')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Kaydet$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /WP.*çek/ })).toBeDisabled();
    // Fallback/bayat rozeti de görülür.
    expect(screen.getByText('bayat')).toBeInTheDocument();

    const getsBefore = apiRequestMock.mock.calls.length;
    fireEvent.click(screen.getByText('force-save'));
    // save() koruması PUT'u engeller (hata bandı zaten kilidi anlatır).
    expect(putCalls()).toHaveLength(0);

    // Tekrar dene → GET yeniden atılır; başarılıysa bant kalkar ve taslak
    // fallback'ten gerçek profile senkronlanır (plet 4 hane: 0.0200).
    apiRequestMock.mockResolvedValue(makeProfile());
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    await waitFor(() => expect(apiRequestMock.mock.calls.length).toBeGreaterThan(getsBefore));
    const pletInput = await screen.findByLabelText(/Pletsølv DKK\/g/);
    await waitFor(() => expect(pletInput).toHaveValue('0.0200'));
    await waitFor(() => expect(screen.queryByText('Global oran profiline ulaşılamadı')).toBeNull());
    expect(screen.getByRole('button', { name: /^Kaydet$/ })).toBeEnabled();
  });

  it('profil bayat meta taşıdığında başlıkta "bayat" rozeti gösterilir', async () => {
    apiRequestMock.mockResolvedValue(
      makeProfile({
        rate_meta: {
          ...PROFILE.rate_meta,
          platinum_dkk: { source: 'fallback', observed_at: '2026-09-01', stale: true },
        },
      }),
    );
    renderDrawer();
    fireEvent.click(screen.getByText('open-drawer'));

    expect(await screen.findByText('bayat')).toBeInTheDocument();
  });

  it('taze manuel profilde "bayat" rozeti görülmez', async () => {
    apiRequestMock.mockResolvedValue(makeProfile());
    renderDrawer();
    fireEvent.click(screen.getByText('open-drawer'));

    expect(await screen.findByLabelText(/Pletsølv DKK\/g/)).toBeInTheDocument();
    expect(screen.queryByText('bayat')).toBeNull();
  });
});
