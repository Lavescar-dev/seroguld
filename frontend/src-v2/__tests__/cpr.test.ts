import { describe, expect, it } from 'vitest';

import { classifyCpr, isAcceptableCprLength, normalizeCpr, validateCpr } from '@/lib/cpr';

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

describe('classifyCpr (R1-CPR: 6/10 anlambilim)', () => {
  it('classifies empty values', () => {
    expect(classifyCpr('')).toBe('empty');
    expect(classifyCpr(null)).toBe('empty');
    expect(classifyCpr('abc')).toBe('empty');
  });

  it('classifies 10 digits as full', () => {
    expect(classifyCpr('0101011119')).toBe('full');
    expect(classifyCpr('010101-1119')).toBe('full');
  });

  it('classifies a bare birth section as birth', () => {
    expect(classifyCpr('010190')).toBe('birth');
    expect(classifyCpr('31-12-99'.replace(/\D/g, ''))).toBe('birth');
  });

  it('rejects impossible day/month even at 6 digits', () => {
    expect(classifyCpr('320190')).toBe('invalid');
    expect(classifyCpr('001290')).toBe('invalid');
    expect(classifyCpr('011390')).toBe('invalid');
  });

  it('rejects 7-9 digit input', () => {
    expect(classifyCpr('0101901')).toBe('invalid');
    expect(classifyCpr('01019012')).toBe('invalid');
    expect(classifyCpr('010190123')).toBe('invalid');
  });
});

describe('isAcceptableCprLength (form kilidi)', () => {
  it('accepts empty, birth (6) and full (10)', () => {
    expect(isAcceptableCprLength('')).toBe(true);
    expect(isAcceptableCprLength('010190')).toBe(true);
    expect(isAcceptableCprLength('0101901234')).toBe(true);
  });

  it('rejects 7-9 digits', () => {
    expect(isAcceptableCprLength('0101901')).toBe(false);
    expect(isAcceptableCprLength('010190123')).toBe(false);
  });
});
