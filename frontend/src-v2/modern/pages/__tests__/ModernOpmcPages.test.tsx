import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AntiFraudOrder, AntiFraudSummary } from '@/types';

import { ModernOpmcListPage } from '../ModernOpmcPages';

const summary: AntiFraudSummary = {
  total_orders: 3,
  high_risk_count: 1,
  medium_risk_count: 0,
  low_risk_count: 1,
  unknown_risk_count: 1,
  manual_review_count: 2,
  active_review_count: 1,
  historical_review_count: 1,
  skipped_whitelist_count: 0,
  not_scored_count: 0,
  ai_alert_count: 0,
};

function makeItem(overrides: Partial<AntiFraudOrder> & Pick<AntiFraudOrder, 'order_id'>): AntiFraudOrder {
  return {
    order_number: String(overrides.order_id),
    status: 'processing',
    total: '1250.00',
    currency: 'DKK',
    customer_name: `Müşteri ${overrides.order_id}`,
    risk_score: 10,
    requires_manual_review: false,
    review_queue_status: 'none',
    risk_meta: [],
    risk_reasons: [],
    notes: [],
    notes_human: [],
    ai_explanations_human: [],
    risk_meta_human: [],
    ...overrides,
  };
}

// Kuyruk: 1 aktif, 1 geçmiş sinyal, 1 inceleme gerektirmeyen ('none') sipariş.
const items: AntiFraudOrder[] = [
  makeItem({ order_id: 1001, requires_manual_review: true, review_queue_status: 'active', risk_score: 90 }),
  makeItem({ order_id: 2002, status: 'completed', requires_manual_review: true, review_queue_status: 'historical', risk_score: 55 }),
  makeItem({ order_id: 3003, requires_manual_review: false, review_queue_status: 'none', risk_score: 5 }),
];

function renderList(overrides: Partial<ComponentProps<typeof ModernOpmcListPage>> = {}) {
  const props: ComponentProps<typeof ModernOpmcListPage> = {
    summary,
    items,
    isLoading: false,
    onRefresh: vi.fn(),
    days: 30,
    onDaysChange: vi.fn(),
    riskFilter: 'all',
    onRiskFilterChange: vi.fn(),
    statusFilter: 'all',
    onStatusFilterChange: vi.fn(),
    manualOnly: 'all',
    onManualOnlyChange: vi.fn(),
    ...overrides,
  };
  render(<ModernOpmcListPage {...props} />);
  return props;
}

describe('ModernOpmcListPage', () => {
  it("shows 'none' (inceleme gerektirmeyen) orders in the Tüm siparişler tab", () => {
    renderList();

    // Varsayılan kuyruk sekmesi yalnız aktif vakayı gösterir; 'none' sipariş görünmez.
    expect(screen.queryByText('#3003 · Müşteri 3003')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Tüm siparişler/ }));

    expect(screen.getByText('#3003 · Müşteri 3003')).toBeInTheDocument();
    // 'none' kayıt yanlışlıkla 'Geçmiş sinyal' olarak etiketlenmez.
    expect(screen.getByText('İnceleme dışı')).toBeInTheDocument();
    // Rozet görünen kümeyle eşleşir: sekmede 3 / filtrelenen 3.
    expect(screen.getByText('Filtrelenen: 3/3')).toBeInTheDocument();
  });

  it('keeps queue and history tabs scoped to their own sets', () => {
    renderList();

    expect(screen.getByText('#1001 · Vaka')).toBeInTheDocument();
    expect(screen.queryByText('#2002 · Müşteri 2002')).not.toBeInTheDocument();
    expect(screen.queryByText('#3003 · Müşteri 3003')).not.toBeInTheDocument();
    expect(screen.getByText('Filtrelenen: 1/3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Geçmiş sinyaller/ }));
    expect(screen.getByText('#2002 · Müşteri 2002')).toBeInTheDocument();
    expect(screen.queryByText('#1001 · Vaka')).not.toBeInTheDocument();
    expect(screen.queryByText('#3003 · Müşteri 3003')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /İnceleme kuyruğu/ }));
    expect(screen.getByText('#1001 · Vaka')).toBeInTheDocument();
    expect(screen.queryByText('#3003 · Müşteri 3003')).not.toBeInTheDocument();
  });

  it('opens the case pane for a selected order from the Tüm siparişler tab', () => {
    renderList();

    fireEvent.click(screen.getByRole('button', { name: /Tüm siparişler/ }));
    fireEvent.click(screen.getByText('#3003 · Müşteri 3003'));

    expect(screen.getByText('#3003 · Vaka')).toBeInTheDocument();
    expect(screen.getByText('Sinyal yok')).toBeInTheDocument();
  });
});
