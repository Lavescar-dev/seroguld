import { describe, expect, it } from 'vitest';

import { resolveRouteMeta } from '../ModernAppShell';

describe('ModernAppShell route metadata', () => {
  it('uses the parent route metadata for dynamic OPMC detail paths', () => {
    expect(resolveRouteMeta('/opmc/37866')).toMatchObject({ eyebrow: 'Risk', title: 'OPMC / Risk' });
  });

  it('keeps exact route metadata and falls back safely', () => {
    expect(resolveRouteMeta('/reports')).toMatchObject({ eyebrow: 'Health', title: 'Raporlar ve Sağlık' });
    expect(resolveRouteMeta('/unknown')).toMatchObject({ eyebrow: 'Alış / POS / AFG', title: 'Yeni alış çalışma alanı' });
  });
});
