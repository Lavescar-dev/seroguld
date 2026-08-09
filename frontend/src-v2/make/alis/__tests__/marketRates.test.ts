import { describe, expect, it } from 'vitest';

import { syncMarketRateState } from '../marketRates';
import type { PosWorkspaceMarketRates } from '@/types';

const current: PosWorkspaceMarketRates = {
  eur_dkk_fx: '7.45',
  gold_24k_dkk: '615.50',
  silver_dkk: '7.80',
  gold_rates_eur: {
    '8': '27.5391',
    '14': '48.1935',
    '18': '61.9631',
    '21': '72.2903',
    '21.6': '74.3557',
    '22': '75.7327',
    '24': '82.6174',
  },
  silver_rates_eur: { '999': '1.0469', '925': '0.9693', '830': '0.8698', '800': '0.8384' },
  gold_matrix: [],
  silver_matrix: [],
};

describe('syncMarketRateState', () => {
  it('applies a top-level Au 24K DKK edit to every karat row', () => {
    const next = syncMarketRateState(current, { gold_24k_dkk: '620' });

    expect(next.gold_24k_dkk).toBe('620.00');
    expect(next.gold_matrix.find((row) => row.row_key === 'gold:8')?.dkk_per_gram).toBe('206.67');
    expect(next.gold_matrix.find((row) => row.row_key === 'gold:14')?.dkk_per_gram).toBe('361.67');
    expect(next.gold_matrix.find((row) => row.row_key === 'gold:24')?.dkk_per_gram).toBe('620.00');
  });
});
