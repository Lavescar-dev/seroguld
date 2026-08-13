import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Area: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
}));

import type { ModernDashboardViewModel } from '@/make/dashboard/types';

import { ModernDashboardPage } from '../ModernDashboardPage';

const view: ModernDashboardViewModel = {
  market: {
    rates: [
      { key: 'gold', label: 'Altın 24K', value: 615.5, unit: 'DKK/g' },
      { key: 'silver', label: 'Gümüş Ag 999', value: 7.8, unit: 'DKK/g' },
      { key: 'eur_dkk', label: 'EUR / DKK', value: 7.45, unit: 'kur' },
      { key: 'platinum', label: 'Platin', value: 280, unit: 'DKK/g' },
      { key: 'palladium', label: 'Palladyum', value: 335, unit: 'DKK/g' },
    ],
    sourceLabel: 'Canlı piyasa servisi',
    lastUpdatedAt: '2026-08-13T08:00:00Z',
    confirmedToday: false,
    confirmedAt: null,
    confirmedByName: null,
  },
  kpis: [
    { id: 'purchase', label: 'Toplam alış', value: '24.000 DKK', detail: '4 AFG kaydı', tone: 'primary' },
    { id: 'stock', label: 'Stok değeri', value: '32.000 DKK', detail: '8 satışa hazır', tone: 'success' },
  ],
  inbox: [
    { id: 'risk', title: 'Risk incelemesi', description: 'Manuel karar bekleyen kayıtlar', count: 2, route: '/opmc', tone: 'danger' },
  ],
  trend: {
    '7d': [{ key: '1', label: '13 Ağu', primary: 2000, secondary: 500 }],
    '30d': [{ key: '1', label: '13 Ağu', primary: 2000, secondary: 500 }],
    '90d': [],
    '12m': [],
  },
  activities: [
    { id: 'purchase-1', title: 'AFG-1 · Recai', description: '2.000 DKK', occurredAt: '2026-08-13T07:00:00Z', route: '/log', kind: 'purchase' },
  ],
  health: [
    { id: 'backup', label: 'Yerel yedek', statusLabel: 'Güncel', description: 'Son yedek 8 dakika önce', tone: 'success', updatedAt: '2026-08-13T07:52:00Z', route: '/settings' },
  ],
};

function renderDashboard(overrides: Partial<ComponentProps<typeof ModernDashboardPage>> = {}) {
  const props: ComponentProps<typeof ModernDashboardPage> = {
    view,
    period: '30d',
    onPeriodChange: vi.fn(),
    onNavigate: vi.fn(),
    onRefresh: vi.fn(),
    onOpenMarketRates: vi.fn(),
    onConfirmMarketUnchanged: vi.fn(),
    ...overrides,
  };
  render(<ModernDashboardPage {...props} />);
  return props;
}

describe('ModernDashboardPage', () => {
  it('keeps market review explicit and never opens an edit surface automatically', () => {
    const props = renderDashboard();

    expect(screen.getByText('Bugünün referans oranları')).toBeInTheDocument();
    expect(screen.getByText('Bugün onay bekliyor')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Oranları kontrol et' }));
    expect(props.onOpenMarketRates).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Değişmedi olarak onayla' }));
    expect(props.onConfirmMarketUnchanged).toHaveBeenCalledTimes(1);
  });

  it('switches the management period and routes inbox work', () => {
    const props = renderDashboard();

    fireEvent.click(screen.getByRole('button', { name: '7 gün' }));
    expect(props.onPeriodChange).toHaveBeenCalledWith('7d');

    fireEvent.click(screen.getByRole('button', { name: /Risk incelemesi/ }));
    expect(props.onNavigate).toHaveBeenCalledWith('/opmc');
  });

  it('locks the unchanged action after the daily confirmation', () => {
    renderDashboard({
      view: {
        ...view,
        market: {
          ...view.market,
          confirmedToday: true,
          confirmedAt: '2026-08-13T08:30:00Z',
          confirmedByName: 'Recai',
        },
      },
    });

    expect(screen.getByRole('button', { name: 'Bugün onaylandı' })).toBeDisabled();
    expect(screen.getByText(/Recai tarafından kontrol edildi/)).toBeInTheDocument();
  });
});
