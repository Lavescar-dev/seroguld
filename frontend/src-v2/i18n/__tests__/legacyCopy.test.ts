import { describe, expect, it } from 'vitest';
import { LEGACY_COPY } from '../legacyCopy.generated';
import { translateVisibleCopy } from '../copy';

describe('legacy visible-copy catalog', () => {
  it('keeps exact key parity and non-empty values for all locales', () => {
    const trKeys = Object.keys(LEGACY_COPY.tr);
    expect(trKeys.length).toBeGreaterThan(1000);
    const sortedTrKeys = [...trKeys].sort();
    expect(Object.keys(LEGACY_COPY.en).sort()).toEqual(sortedTrKeys);
    expect(Object.keys(LEGACY_COPY.da).sort()).toEqual(sortedTrKeys);
    for (const locale of ['tr', 'en', 'da'] as const) {
      for (const key of trKeys) expect(LEGACY_COPY[locale][key].trim()).not.toBe('');
    }
  });

  it('translates critical operator and customer-display copy', () => {
    expect(translateVisibleCopy('Kaydet', 'en')).toBe('Save');
    expect(translateVisibleCopy('Kaydet', 'da')).toBe('Gem');
    expect(translateVisibleCopy('Müşteri ekranı', 'en')).toBe('Customer display');
    expect(translateVisibleCopy('Müşteri ekranı', 'da')).toBe('Kundeskærm');
    expect(translateVisibleCopy('Kundedatabase', 'tr')).toBe('Müşteri veritabanı');
    expect(translateVisibleCopy('Kundedatabase', 'en')).toBe('Customer database');
  });

  it('translates static fragments without modifying dynamic values', () => {
    expect(translateVisibleCopy('Toplam: 1250 DKK', 'en')).toContain('Total');
    expect(translateVisibleCopy('Toplam: 1250 DKK', 'da')).toContain('I alt');
    expect(translateVisibleCopy('Mads Jensen', 'da')).toBe('Mads Jensen');
  });
});
