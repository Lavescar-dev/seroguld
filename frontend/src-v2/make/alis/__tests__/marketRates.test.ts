import { describe, expect, it } from 'vitest';

import { formatKaratLabel, normalizeTextInput, parseDecimalValue, syncMarketRateState } from '../marketRates';
import type { PosWorkspaceMarketRates } from '@/types';

const current: PosWorkspaceMarketRates = {
  eur_dkk_fx: '7.45',
  gold_rates_dkk: {
    '8': '205.17',
    '14': '359.04',
    '18': '461.63',
    '21': '538.56',
    '21.6': '553.95',
    '22': '564.21',
    '24': '615.50',
  },
  silver_rates_dkk: { '999': '7.80', '925': '7.22', '830': '6.48', '800': '6.24' },
  gold_24k_dkk: '615.50',
  silver_dkk: '7.80',
  gold_matrix: [],
  silver_matrix: [],
};

describe('syncMarketRateState (DKK-only sözleşme)', () => {
  it('entering 382 as a karat rate keeps it exactly 382 DKK/g — no fx multiplication', () => {
    const next = syncMarketRateState(current, {
      gold_rates_dkk: { ...current.gold_rates_dkk, '14': '382' },
    });
    expect(next.gold_rates_dkk['14']).toBe('382.00');
    expect(next.gold_matrix.find((row) => row.row_key === 'gold:14')?.dkk_per_gram).toBe('382.00');
    // Diğer karatlar dokunulmaz.
    expect(next.gold_rates_dkk['24']).toBe('615.50');
  });

  it('a 24K override updates ONLY 24K — other karats are never derived/overwritten', () => {
    const next = syncMarketRateState(current, { gold_24k_dkk: '620' });
    expect(next.gold_24k_dkk).toBe('620.00');
    expect(next.gold_rates_dkk['24']).toBe('620.00');
    // Per-karat oranlar BAĞIMSIZ: 24K değişimi 8K/14K'yı ASLA ezmez (fan-out yok).
    expect(next.gold_rates_dkk['8']).toBe('205.17');
    expect(next.gold_rates_dkk['14']).toBe('359.04');
  });

  it('fx is context only — changing it never changes DKK rates', () => {
    const next = syncMarketRateState(current, { eur_dkk_fx: '9.99' });
    expect(next.eur_dkk_fx).toBe('9.99');
    expect(next.gold_rates_dkk['24']).toBe('615.50');
    expect(next.silver_rates_dkk['999']).toBe('7.80');
    expect(next.gold_matrix.find((row) => row.row_key === 'gold:24')?.dkk_per_gram).toBe('615.50');
  });

  it('derives the scalar summaries from the matrices', () => {
    const next = syncMarketRateState(current, {
      silver_rates_dkk: { ...current.silver_rates_dkk, '999': '8.25' },
    });
    expect(next.silver_dkk).toBe('8.25');
    expect(next.silver_matrix.find((row) => row.row_key === 'silver:2')?.dkk_per_gram).toBe('8.25');
  });

  it('missing bar prices are NEVER masked with 24K/999 — they stay 0 (backend falls back to profile)', () => {
    // Bar ≠ 24K hurda: bar alanı yokken 24K'dan uydurmak gerçek bar
    // fiyatını maskelerdi (WP priser'den bar çekildiğinde görünen hataydı).
    const next = syncMarketRateState(current);
    expect(next.gold_bar_dkk).toBe('0.00');
    expect(next.silver_bar_dkk).toBe('0.00');
  });

  it('real bar prices pass through untouched', () => {
    const next = syncMarketRateState({
      ...current,
      gold_bar_dkk: '873.00',
      silver_bar_dkk: '13.10',
      plet_dkk: '0.0200',
    });
    expect(next.gold_bar_dkk).toBe('873.00');
    expect(next.silver_bar_dkk).toBe('13.10');
    expect(next.plet_dkk).toBe('0.0200');
  });

  it('plet override lands in plet_dkk AND feeds the silver_matrix preview (silver:5)', () => {
    // '800' backend gümüş profilinde yok; Plet girişinin tek gerçek hedefi
    // plet_dkk skaleridir — kayıt + AFG satır önizlemesi aynı kaynaktan beslenir.
    const next = syncMarketRateState(current, { plet_dkk: '0.021' });
    expect(next.plet_dkk).toBe('0.0210');
    expect(next.silver_matrix.find((row) => row.row_key === 'silver:5')?.dkk_per_gram).toBe('0.0210');
  });
});

describe('normalizeTextInput / parseDecimalValue (Avrupa sayı biçimleri)', () => {
  it('Danca binlik ayraçlı giriş çözümlenir: 6.392,10 -> 6392.10', () => {
    expect(normalizeTextInput('6.392,10')).toBe('6392.10');
    expect(parseDecimalValue('6.392,10')).toBe(6392.1);
  });

  it('son ayraç ondalıktır; öncekiler binliktir', () => {
    expect(normalizeTextInput('1,5')).toBe('1.5');
    expect(normalizeTextInput('1 234,5')).toBe('1234.5');
    expect(normalizeTextInput('12.5')).toBe('12.5');
  });

  it('düz sayı ve negatif temizliği korunur', () => {
    expect(normalizeTextInput('1234')).toBe('1234');
    expect(normalizeTextInput('-5,5')).toBe('5.5');
  });
});

describe('formatKaratLabel (roadmap madde 2 — B1 etiket onayı)', () => {
  it("'22b' ikinci 22K seviyesi olarak '22K-2' etiketlenir", () => {
    expect(formatKaratLabel('22b')).toBe('22K-2');
  });

  it('diğer karat anahtarları NK biçiminde kalır', () => {
    expect(formatKaratLabel('22')).toBe('22K');
    expect(formatKaratLabel('21.6')).toBe('21.6K');
    expect(formatKaratLabel('24')).toBe('24K');
  });
});
