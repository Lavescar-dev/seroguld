import { describe, expect, it } from 'vitest';

import { labelMetalDanish } from '../format';

describe('labelMetalDanish', () => {
  it('maps every metal enum to a single Danish display name', () => {
    expect(labelMetalDanish('yellow_gold')).toBe('Guld');
    expect(labelMetalDanish('white_gold')).toBe('Hvidguld');
    expect(labelMetalDanish('silver')).toBe('Sølv');
    expect(labelMetalDanish('platinum')).toBe('Platin');
    expect(labelMetalDanish('palladium')).toBe('Palladium');
  });

  it('never renders raw enum values as-is for unknown or empty input', () => {
    expect(labelMetalDanish('')).toBe('-');
    expect(labelMetalDanish(null)).toBe('-');
    expect(labelMetalDanish(undefined)).toBe('-');
  });
});
