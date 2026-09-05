import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CustomerDisplayLiveView } from '@/components/CustomerDisplayCanvas';
import { AppLocaleProvider } from '@/i18n';
import { formatNumber } from '@/lib/format';
import type { PosDisplaySnapshot, PosWorkspaceExtraRow } from '@/types';

// Node 26 + jsdom kurulumunda window.localStorage tanımsız olabiliyor
// (alisErrorStates.test.tsx ile aynı hafif taklağın gerekçesi).
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
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

for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (typeof window[name] === 'undefined') {
    Object.defineProperty(window, name, { value: new MemoryStorage() });
  }
}

function baseSnapshot(overrides: Partial<PosDisplaySnapshot> = {}): PosDisplaySnapshot {
  return {
    session_code: 'DSPEXTRA1',
    status: 'draft',
    trade_side: 'buy_from_customer',
    customer_name: 'Test Müşteri',
    line_count: 0,
    lines: [],
    updated_at: '2026-09-05T10:00:00Z',
    ...overrides,
  };
}

const goldExtra: PosWorkspaceExtraRow = {
  row_key: 'extra:1',
  kind: 'quarter',
  label: '22K-2',
  metal: 'gold',
  karat: '22b',
  purity_percentage: '91.60',
  gram: '2.00',
  avance_percent: '0',
  rate_dkk: '564.21',
  unit_price_dkk: '564.21',
  line_total_dkk: '1128.42',
};

const silverExtra: PosWorkspaceExtraRow = {
  row_key: 'extra:2',
  kind: 'kniv',
  label: 'Kniv',
  metal: 'silver',
  karat: '925',
  purity_percentage: '92.50',
  gram: '5.00',
  avance_percent: '0',
  rate_dkk: '7.22',
  unit_price_dkk: '7.22',
  line_total_dkk: '36.10',
};

describe('CustomerDisplayLiveView — extra satırlar (kniv/çeyrek/22K-2)', () => {
  it('extra satırlar metal bölümlerinde görünür: altın extra GULD, gümüş extra SØLV altında', () => {
    render(
      <AppLocaleProvider>
        <CustomerDisplayLiveView
          snapshot={baseSnapshot({ extra_rows: [goldExtra, silverExtra] })}
          connection="live"
        />
      </AppLocaleProvider>,
    );

    expect(screen.getByTestId('customer-display-live')).toBeInTheDocument();
    expect(screen.getByText('22K-2')).toBeInTheDocument();
    expect(screen.getByText('Kniv')).toBeInTheDocument();
    // Yalnız extra satırlar varken "ürün satırı bekleniyor" paneli GÖSTERİLMEZ.
    expect(screen.queryByText('Ürün satırı bekleniyor')).not.toBeInTheDocument();
  });

  it('klasik Net/Ödenecek fallback toplamı extra satırları da kapsar (server toplamı yokken)', () => {
    const snapshot = baseSnapshot({
      extra_rows: [goldExtra, silverExtra],
      gold_rows: [
        {
          row_key: 'gold:22',
          karat: '22',
          label: '22K',
          lodighed: '916',
          purity_percentage: '91.60',
          gram: '1.00',
          avance_percent: '0',
          rate_dkk: '564.21',
          unit_price_dkk: '564.21',
          line_total_dkk: '100.00',
        },
      ],
    });
    render(
      <AppLocaleProvider>
        <CustomerDisplayLiveView snapshot={snapshot} connection="live" />
      </AppLocaleProvider>,
    );

    // 100.00 + 1128.42 + 36.10 = 1264.52 — fallback toplam extra'sız hesap
    // (yalnız gold+silver) olsaydı 100.00 görünürdü.
    const expected = formatNumber('1264.52');
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('server lines_total_dkk varken authoritatif toplam aynen gösterilir (extra dahil workspace özeti)', () => {
    const snapshot = baseSnapshot({
      extra_rows: [goldExtra, silverExtra],
      lines_total_dkk: '5000.00',
    });
    render(
      <AppLocaleProvider>
        <CustomerDisplayLiveView snapshot={snapshot} connection="live" />
      </AppLocaleProvider>,
    );

    expect(screen.getByText(formatNumber('5000.00'))).toBeInTheDocument();
  });

  it('hiç satır yokken bekleme paneli döner', () => {
    render(
      <AppLocaleProvider>
        <CustomerDisplayLiveView snapshot={baseSnapshot()} connection="live" />
      </AppLocaleProvider>,
    );

    // Not: görünen metin çeviri katmanından geçer; panel başlığı ve alt
    // başlığı tr locale'inde aynı metne çözülebilir → getAllByText.
    expect(screen.getAllByText('Ürün satırı bekleniyor').length).toBeGreaterThan(0);
  });
});

describe('CustomerDisplayLiveView — kniv, boş toplam ve kapanış sahnesi (M3)', () => {
  it('yalnız kniv satırı olan taslakta KNIV bölümü gösterilir, bekleme paneli gösterilmez', () => {
    render(
      <AppLocaleProvider>
        <CustomerDisplayLiveView
          snapshot={baseSnapshot({
            kniv_rows: [{ row_key: 'kniv:1', unit_weight: '150.00', count: '2', total_weight: '300.00' }],
          })}
          connection="live"
        />
      </AppLocaleProvider>,
    );

    expect(screen.getByText(`Kniv ${formatNumber('150.00', ' g')} × 2 = ${formatNumber('300.00', ' g')}`)).toBeInTheDocument();
    // hasAnyRow knivFilled'i kapsamazsaydı çelişkili bekleme paneli de
    // KNIV bölümüyle birlikte render olurdu.
    expect(screen.queryByText('Ürün satırı bekleniyor')).not.toBeInTheDocument();
  });

  it('toplam üretilemiyorsa footer 0,00 yerine — gösterir', () => {
    render(
      <AppLocaleProvider>
        <CustomerDisplayLiveView snapshot={baseSnapshot()} connection="live" />
      </AppLocaleProvider>,
    );

    const footer = screen.getByText('Genel Toplam').closest('footer');
    expect(footer).not.toBeNull();
    expect(within(footer as HTMLElement).queryByText(formatNumber('0'))).not.toBeInTheDocument();
    expect(within(footer as HTMLElement).getByText('—')).toBeInTheDocument();
  });

  it("status 'confirmed' iken kapanış sahnesi gösterilir: İşlem tamamlandı + toplam", () => {
    render(
      <AppLocaleProvider>
        <CustomerDisplayLiveView
          snapshot={baseSnapshot({ status: 'confirmed', lines_total_dkk: '1234.00' })}
          connection="live"
        />
      </AppLocaleProvider>,
    );

    expect(screen.getByTestId('customer-display-closed')).toBeInTheDocument();
    // Aynı metin panel başlığında ve sr-only aria-live span'inde iki kez var.
    expect(screen.getAllByText('İşlem tamamlandı').length).toBeGreaterThan(0);
    expect(screen.getByText(formatNumber('1234.00'))).toBeInTheDocument();
    // Teklif grid'i artık donuk kalmaz: canlı görünüm kalkar.
    expect(screen.queryByTestId('customer-display-live')).not.toBeInTheDocument();
  });

  it("status 'cancelled' iken nötr sıfırlama sahnesi gösterilir, satırlar gizlenir", () => {
    render(
      <AppLocaleProvider>
        <CustomerDisplayLiveView
          snapshot={baseSnapshot({
            status: 'cancelled',
            gold_rows: [
              {
                row_key: 'gold:22',
                karat: '22',
                label: '22K',
                lodighed: '916',
                purity_percentage: '91.60',
                gram: '1.00',
                avance_percent: '0',
                rate_dkk: '564.21',
                unit_price_dkk: '564.21',
                line_total_dkk: '100.00',
              },
            ],
          })}
          connection="live"
        />
      </AppLocaleProvider>,
    );

    expect(screen.getByTestId('customer-display-closed')).toBeInTheDocument();
    // Aynı metin panel başlığında ve sr-only aria-live span'inde iki kez var.
    expect(screen.getAllByText('İşlem iptal edildi').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('customer-display-live')).not.toBeInTheDocument();
    expect(screen.queryByText('22K')).not.toBeInTheDocument();
  });
});
