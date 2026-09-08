import { describe, expect, it } from 'vitest';

import { karatRank, sortByKaratRank } from '../extraRowOrder';

describe('karatRank', () => {
  it("'22b' eki ikinci 22K seviyesi olarak 22'ye çözülür", () => {
    expect(karatRank('22b')).toBe(22);
  });

  it('ondalıklı karatlar sayısal çözülür', () => {
    expect(karatRank('21.6')).toBe(21.6);
    expect(karatRank('8')).toBe(8);
  });

  it("sayı çözülmeyen karatlar sonsuza düşer (daima sonda)", () => {
    expect(karatRank('—')).toBe(Number.POSITIVE_INFINITY);
    expect(karatRank('')).toBe(Number.POSITIVE_INFINITY);
    expect(karatRank(undefined)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('sortByKaratRank — 22K-2 her zaman 22K altında', () => {
  it('extra 22b satırı 22 taban satırıyla 24 arasına düşer', () => {
    const rows = [
      { key: 'base-22', karat: '22' },
      { key: 'base-24', karat: '24' },
      { key: 'extra-22b', karat: '22b' }, // yeni eklenen — sona gelir
      { key: 'base-8', karat: '8' },
    ];
    expect(sortByKaratRank(rows).map((row) => row.key)).toEqual([
      'base-8',
      'base-22',
      'extra-22b',
      'base-24',
    ]);
  });

  it('eşit rütbede taban satır önce basılır (kararlı sıralama)', () => {
    const rows = [
      { key: 'base-22', karat: '22' },
      { key: 'extra-22b-1', karat: '22b' },
      { key: 'extra-22b-2', karat: '22b' },
    ];
    expect(sortByKaratRank(rows).map((row) => row.key)).toEqual([
      'base-22',
      'extra-22b-1',
      'extra-22b-2',
    ]);
  });

  it('taban 8K–24K dizisi kendi iç sırasını korur', () => {
    const base = ['8', '14', '18', '21', '21.6', '22', '24'].map((karat) => ({ key: `base-${karat}`, karat }));
    expect(sortByKaratRank(base).map((row) => row.key)).toEqual([
      'base-8',
      'base-14',
      'base-18',
      'base-21',
      'base-21.6',
      'base-22',
      'base-24',
    ]);
  });

  it("çözülemeyen karatlı satırlar daima en sonda kalır", () => {
    const rows = [
      { key: 'extra-x', karat: '—' },
      { key: 'base-14', karat: '14' },
      { key: 'extra-y', karat: '' },
    ];
    expect(sortByKaratRank(rows).map((row) => row.key)).toEqual(['base-14', 'extra-x', 'extra-y']);
  });
});
