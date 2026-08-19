import { describe, expect, it } from 'vitest';

import { syncMarketRateState } from '../marketRates';
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

  it('fans a 24K override across karats directly in DKK', () => {
    const next = syncMarketRateState(current, { gold_24k_dkk: '620' });
    expect(next.gold_24k_dkk).toBe('620.00');
    expect(next.gold_rates_dkk['8']).toBe('206.67');
    expect(next.gold_rates_dkk['14']).toBe('361.67');
    expect(next.gold_rates_dkk['24']).toBe('620.00');
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
});
