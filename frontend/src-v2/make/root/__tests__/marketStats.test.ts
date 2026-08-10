import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveMarketStat } from '../useRootMakeState';

describe('resolveMarketStat', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers live bootstrap market rates over stale local storage', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => '2850' } });

    expect(resolveMarketStat('market_gold', '615.50', 2850)).toBe(615.5);
  });

  it('falls back to local storage only when bootstrap has no numeric value', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => '2850' } });

    expect(resolveMarketStat('market_gold', undefined, 610)).toBe(2850);
    expect(resolveMarketStat('market_gold', null, 610)).toBe(2850);
    expect(resolveMarketStat('market_gold', '', 610)).toBe(2850);
    expect(resolveMarketStat('market_gold', '0', 610)).toBe(2850);
  });
});
