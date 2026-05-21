import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from '@/lib/format';

describe('formatRelativeTime', () => {
  const now = new Date('2026-05-14T12:00:00Z');

  it('returns "şimdi" for very recent timestamps', () => {
    const value = new Date(now.getTime() - 5_000).toISOString();
    expect(formatRelativeTime(value, now)).toBe('şimdi');
  });

  it('formats minutes', () => {
    const value = new Date(now.getTime() - 3 * 60_000).toISOString();
    expect(formatRelativeTime(value, now)).toBe('3 dakika önce');
  });

  it('formats hours', () => {
    const value = new Date(now.getTime() - 5 * 3_600_000).toISOString();
    expect(formatRelativeTime(value, now)).toBe('5 saat önce');
  });

  it('formats days', () => {
    const value = new Date(now.getTime() - 2 * 86_400_000).toISOString();
    expect(formatRelativeTime(value, now)).toBe('2 gün önce');
  });

  it('returns "-" for empty/invalid input', () => {
    expect(formatRelativeTime(null, now)).toBe('-');
    expect(formatRelativeTime('', now)).toBe('-');
    expect(formatRelativeTime('not-a-date', now)).toBe('-');
  });

  it('formats future timestamps with "sonra" suffix', () => {
    const value = new Date(now.getTime() + 2 * 3_600_000).toISOString();
    expect(formatRelativeTime(value, now)).toBe('2 saat sonra');
  });
});
