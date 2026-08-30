import { describe, expect, it } from 'vitest';

import { resolveRouteMeta } from '../ModernAppShell';

describe('ModernAppShell route metadata', () => {
  it('uses the parent route metadata for dynamic OPMC detail paths', () => {
    expect(resolveRouteMeta('/opmc/37866')).toMatchObject({ eyebrow: 'Risk', title: 'OPMC / Risk' });
  });

  it('returns dedicated metadata for the reports route', () => {
    expect(resolveRouteMeta('/reports')).toMatchObject({ eyebrow: 'Raporlama', title: 'Raporlar' });
  });

  it('falls back safely for removed module routes', () => {
    expect(resolveRouteMeta('/removed-module')).toMatchObject({ eyebrow: 'Alış / POS / AFG', title: 'Yeni alış çalışma alanı' });
    expect(resolveRouteMeta('/unknown')).toMatchObject({ eyebrow: 'Alış / POS / AFG', title: 'Yeni alış çalışma alanı' });
  });
});
