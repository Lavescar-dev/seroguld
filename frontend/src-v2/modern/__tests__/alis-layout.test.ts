import { describe, expect, it } from 'vitest';

import { getAlisLayoutMode } from '../modules/alis/useAlisLayoutMode';

describe('modern Alış layout thresholds', () => {
  it('uses the compact row layout below 720px', () => {
    expect(getAlisLayoutMode(719)).toBe('compact');
  });

  it('uses the single-column context drawer between 720px and 1119px', () => {
    expect(getAlisLayoutMode(720)).toBe('medium');
    expect(getAlisLayoutMode(1119)).toBe('medium');
  });

  it('uses a ledger plus inspector from 1120px upward', () => {
    expect(getAlisLayoutMode(1120)).toBe('wide');
    expect(getAlisLayoutMode(1599)).toBe('wide');
    expect(getAlisLayoutMode(1600)).toBe('ultrawide');
  });
});
