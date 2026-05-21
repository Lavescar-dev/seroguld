import { describe, expect, it } from 'vitest';

import { normalizeCpr, validateCpr } from '@/lib/cpr';

describe('normalizeCpr', () => {
  it('removes punctuation and spaces', () => {
    expect(normalizeCpr('010101-1119')).toBe('0101011119');
    expect(normalizeCpr(' 12 03 85 / 1234 ')).toBe('1203851234');
  });

  it('returns empty string for empty/nullish input', () => {
    expect(normalizeCpr('')).toBe('');
    expect(normalizeCpr(null)).toBe('');
    expect(normalizeCpr(undefined)).toBe('');
  });
});

describe('validateCpr', () => {
  it('accepts a CPR that passes mod-11', () => {
    const r = validateCpr('010101-1119');
    expect(r.formatOk).toBe(true);
    expect(r.mod11Ok).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.birthdate).not.toBeNull();
  });

  it('flags mod-11 failure but accepts format (post-2007 reality)', () => {
    const r = validateCpr('120385-1234');
    expect(r.formatOk).toBe(true);
    expect(r.mod11Ok).toBe(false);
    expect(r.reason).toMatch(/Mod-11/i);
  });

  it('rejects too-short input', () => {
    const r = validateCpr('1234');
    expect(r.formatOk).toBe(false);
    expect(r.reason).toMatch(/10 haneli/);
  });

  it('rejects impossible birthdate', () => {
    const r = validateCpr('320185-1234');
    expect(r.formatOk).toBe(false);
    expect(r.reason).toMatch(/doğum tarihi/);
  });

  it('returns empty reason for empty value', () => {
    const r = validateCpr('');
    expect(r.formatOk).toBe(false);
    expect(r.reason).toBe('CPR boş');
  });
});
