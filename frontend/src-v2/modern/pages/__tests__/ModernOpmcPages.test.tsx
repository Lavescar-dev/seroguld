import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AntiFraudOrder, AntiFraudSummary } from '@/types';

import { ModernOpmcDetailPage, ModernOpmcListPage } from '../ModernOpmcPages';

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

  it('honors backend risk_level over fixed score thresholds and never paints a scoreless row green', () => {
    renderList({
      items: [
        makeItem({ order_id: 4004, requires_manual_review: true, review_queue_status: 'active', risk_level: 'high', risk_score: 50 }),
        makeItem({ order_id: 5005, risk_level: 'unknown', risk_score: null }),
      ],
    });

    // Backend 'high' dedi; frontend sabit 75 eşiği bunu warning'e indirmemeli.
    const highBadge = screen.getByText('Risk 50').closest('span');
    expect(highBadge?.className).toContain('text-sg-red');

    // 'Skor yok' ile 'düşük risk' zıt kavramlar: null skor yeşil değil neutral.
    fireEvent.click(screen.getByRole('button', { name: /Tüm siparişler/ }));
    const unscoredBadge = screen.getByText('Risk —').closest('span');
    expect(unscoredBadge?.className).toContain('text-sg-text-soft');
    expect(unscoredBadge?.className).not.toContain('text-sg-green');
  });
});

describe('ModernOpmcDetailPage override guard', () => {
  const detail = makeItem({
    order_id: 1001,
    requires_manual_review: true,
    review_queue_status: 'active',
    risk_score: 90,
  });

  function renderDetail(overrides: Partial<ComponentProps<typeof ModernOpmcDetailPage>> = {}) {
    const props: ComponentProps<typeof ModernOpmcDetailPage> = {
      requestedId: '1001',
      detail,
      onOverride: vi.fn(),
      overrideAvailability: { state: 'available' },
      ...overrides,
    };
    return render(<ModernOpmcDetailPage {...props} />);
  }

  it('locks override buttons without a reason and unlocks once a reason is typed', () => {
    renderDetail();

    const lowButton = screen.getByRole('button', { name: 'Düşük risk' });
    expect(lowButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Kanıt ve karar gerekçesini yazın'), {
      target: { value: 'yanlış alarm' },
    });
    expect(screen.getByRole('button', { name: 'Düşük risk' })).toBeEnabled();
  });

  it('clears a stale override reason when the refreshed detail arrives', () => {
    const onOverride = vi.fn();
    const { rerender } = renderDetail({ onOverride });

    const reasonInput = screen.getByPlaceholderText('Kanıt ve karar gerekçesini yazın');
    fireEvent.change(reasonInput, { target: { value: 'eski gerekçe' } });
    expect(reasonInput).toHaveValue('eski gerekçe');

    // Override sonrası wrapper yeni detail nesnesi geçirir → gerekçe sıfırlanır.
    rerender(
      <ModernOpmcDetailPage
        requestedId="1001"
        detail={{ ...detail }}
        onOverride={onOverride}
        overrideAvailability={{ state: 'available' }}
      />,
    );

    expect(screen.getByPlaceholderText('Kanıt ve karar gerekçesini yazın')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Düşük risk' })).toBeDisabled();
  });
});

describe('ModernOpmcDetailPage make-parity panels', () => {
  function renderDetailPanels(overrides: Partial<AntiFraudOrder> = {}) {
    const detail = makeItem({
      order_id: 1001,
      requires_manual_review: true,
      review_queue_status: 'active',
      risk_score: 90,
      ...overrides,
    });
    render(
      <ModernOpmcDetailPage requestedId="1001" detail={detail} overrideAvailability={{ state: 'available' }} />,
    );
  }

  it('surfaces AI evaluation, raw/effective score, consistency and history distribution like the make detail', () => {
    renderDetailPanels({
      raw_risk_score: 70,
      opmc_risk_score: 90,
      failed_rule_points_total: 60,
      score_consistency: 'mismatch',
      ai_explanations_human: ['İsim ve adres tutarlılığı: uyumlu.'],
      customer_history: {
        total_orders: 5,
        successful_orders: 3,
        cancelled_orders: 1,
        failed_orders: 1,
        known_safe: true,
      },
    });

    // Uyuşmazlık bandı OPMC skoru ile kural puanlarını yan yana verir.
    expect(screen.getByText('Skor uyuşmazlığı')).toBeInTheDocument();
    expect(screen.getByText(/tetiklenen kural puanları toplamı 60/)).toBeInTheDocument();

    // Ham (70) ile etkin (90) skor aynı panelde karşılaştırılabilir.
    expect(screen.getByText('Ham risk skoru')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument();
    expect(screen.getByText('Uyuşmuyor')).toBeInTheDocument();

    // AI değerlendirmesi make detaydaki panelin modern karşılığı.
    expect(screen.getByText('AI değerlendirmesi')).toBeInTheDocument();
    expect(screen.getByText('İsim ve adres tutarlılığı: uyumlu.')).toBeInTheDocument();

    // Müşteri geçmişi yalnız toplam değil, dağılımıyla gösterilir.
    expect(screen.getByText(/5 sipariş · 3 başarılı · 1 iptal\/iade · 1 başarısız · güvenli/)).toBeInTheDocument();
  });

  it('omits the mismatch banner and AI section when they are not applicable', () => {
    renderDetailPanels();

    expect(screen.queryByText('Skor uyuşmazlığı')).not.toBeInTheDocument();
    expect(screen.queryByText('AI değerlendirmesi')).not.toBeInTheDocument();
    // Skor yoksa tutarlılık dürüstçe 'kontrol edilemedi' der, tutarlı saymaz.
    expect(screen.getByText('Kontrol edilemedi')).toBeInTheDocument();
  });
});
