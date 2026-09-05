// M3 medium fixleri — Reports klasik yüzeyi.
//
// Kapsam:
// - Bekleme: '—' + 'Rapor yükleniyor…' (EMPTY_REPORT sıfırları gerçek veri gibi görünmez)
// - Hata: uyarı bandı + 'Tekrar dene' refetch'i; kart sağlam görünmez
// - Export: dönem (Tüm kayıtlar dahil) + format (XLSX/PDF/CSV) seçimi
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequestMock = vi.fn();
const downloadMock = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    apiRequest: (...args: Parameters<typeof import('@/lib/api').apiRequest>) => apiRequestMock(...args),
    downloadAuthedDocument: (...args: Parameters<typeof import('@/lib/api').downloadAuthedDocument>) => downloadMock(...args),
  };
});

import { ReportsPage } from '../ReportsPage';
import { UiVariantProvider } from '@/ui-variants';

beforeEach(() => {
  apiRequestMock.mockClear();
  downloadMock.mockClear();
});

function renderReports() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UiVariantProvider initialVariant="classic">
        <ReportsPage />
      </UiVariantProvider>
    </QueryClientProvider>,
  );
}

describe('Reports klasik yüzey — yükleme ve hata durumları', () => {
  it('bekleme sırasında sıfır özet değil açık bekleme durumu gösterir', async () => {
    let resolveDaily: (value: unknown) => void = () => {};
    apiRequestMock.mockImplementation((path: unknown) => {
      if (String(path) === '/api/reports/daily') {
        return new Promise((resolve) => {
          resolveDaily = resolve;
        });
      }
      return Promise.resolve({
        period_start: '2026-09-01T00:00:00Z',
        period_end: '2026-09-05T00:00:00Z',
        purchased_count: 7,
        sold_count: 3,
        melted_count: 1,
        total_purchase_value_dkk: '1000',
        total_sale_value_dkk: '1500',
        total_profit_dkk: '500',
      });
    });

    renderReports();

    // Günlük hâlâ uçuyorken: '—' ve açık bekleme metni (her blokta bir tane)
    expect(screen.getAllByText('Rapor yükleniyor…')).toHaveLength(3);
    expect(screen.getAllByRole('status')).toHaveLength(3);

    resolveDaily({
      period_start: '2026-09-05T00:00:00Z',
      period_end: '2026-09-06T00:00:00Z',
      purchased_count: 4,
      sold_count: 2,
      melted_count: 0,
      total_purchase_value_dkk: '800',
      total_sale_value_dkk: '900',
      total_profit_dkk: '100',
    });
    await waitFor(() => expect(screen.queryByText('Rapor yükleniyor…')).not.toBeInTheDocument());
  });

  it('hata durumunda uyarı bandı + Tekrar dene refetch eder', async () => {
    let calls = 0;
    apiRequestMock.mockImplementation((path: unknown) => {
      if (String(path) === '/api/reports/weekly') {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('veritabanı kapalı'));
        return Promise.resolve({
          period_start: '2026-08-31T00:00:00Z',
          period_end: '2026-09-05T00:00:00Z',
          purchased_count: 9,
          sold_count: 4,
          melted_count: 2,
          total_purchase_value_dkk: '2000',
          total_sale_value_dkk: '2500',
          total_profit_dkk: '500',
        });
      }
      return Promise.resolve({
        period_start: '2026-09-01T00:00:00Z',
        period_end: '2026-09-05T00:00:00Z',
        purchased_count: 1,
        sold_count: 1,
        melted_count: 0,
        total_purchase_value_dkk: '10',
        total_sale_value_dkk: '20',
        total_profit_dkk: '10',
      });
    });

    renderReports();

    expect(await screen.findByText(/Rapor alınamadı: veritabanı kapalı/)).toBeInTheDocument();
    // Hata varken bekleme metni yok; değerler '—'
    expect(screen.queryByText('Rapor yükleniyor…')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    await waitFor(() => expect(screen.queryByText(/Rapor alınamadı/)).not.toBeInTheDocument());
    expect(calls).toBe(2);
  });
});

describe('Reports export yüzeyi', () => {
  it('format ve dönem seçimi isteğe yansır; Tüm kayıtlar + CSV indirilebilir', async () => {
    apiRequestMock.mockResolvedValue({
      period_start: '2026-09-01T00:00:00Z',
      period_end: '2026-09-05T00:00:00Z',
      purchased_count: 1,
      sold_count: 1,
      melted_count: 0,
      total_purchase_value_dkk: '10',
      total_sale_value_dkk: '20',
      total_profit_dkk: '10',
    });
    downloadMock.mockResolvedValue(undefined);

    renderReports();
    expect(await screen.findByRole('heading', { name: 'Haftalık' })).toBeInTheDocument();

    const formatSelect = screen.getByLabelText('Günlük format seçimi');
    const periodSelect = screen.getByLabelText('Günlük dönem seçimi');
    fireEvent.change(formatSelect, { target: { value: 'csv' } });
    fireEvent.change(periodSelect, { target: { value: 'all' } });

    const blocks = screen.getAllByRole('button', { name: 'İndir' });
    fireEvent.click(blocks[0]);
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    const [path, filename] = downloadMock.mock.calls[0];
    expect(String(path)).toBe('/api/reports/export?period=all&format=csv');
    // Zaman damgalı ad: aynı dönemi tekrar indirirken üst üste binmesin
    expect(String(filename)).toMatch(/^seroguld-all-report-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/);
  });

  it('Tüm kayıtları indir kısayolu period=all xlsx çağırır', async () => {
    apiRequestMock.mockResolvedValue({
      period_start: '2026-09-01T00:00:00Z',
      period_end: '2026-09-05T00:00:00Z',
      purchased_count: 1,
      sold_count: 1,
      melted_count: 0,
      total_purchase_value_dkk: '10',
      total_sale_value_dkk: '20',
      total_profit_dkk: '10',
    });
    downloadMock.mockResolvedValue(undefined);

    renderReports();
    expect(await screen.findByRole('heading', { name: 'Haftalık' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tüm kayıtları indir (XLSX)' }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    expect(String(downloadMock.mock.calls[0][0])).toBe('/api/reports/export?period=all&format=xlsx');
  });
});
