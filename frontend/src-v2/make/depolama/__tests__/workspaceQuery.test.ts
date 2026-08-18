import { describe, expect, it } from 'vitest';

import { EMPTY_FILTERS, describeActiveInventoryFilters } from '../types';
import { buildWorkspaceQueryParams } from '../useDepolamaMakeState';

describe('depolama workspace category scope', () => {
  it('loads every category for the modern all-products view', () => {
    const params = new URLSearchParams(buildWorkspaceQueryParams(EMPTY_FILTERS, 'all', null));
    expect(params.has('category')).toBe(false);
    expect(params.has('subcategory')).toBe(false);
  });

  it('keeps explicit category and subcategory filters', () => {
    const params = new URLSearchParams(buildWorkspaceQueryParams(EMPTY_FILTERS, 'gumus', 'barrer'));
    expect(params.get('category')).toBe('gumus');
    expect(params.get('subcategory')).toBe('barrer');
  });
});

describe('describeActiveInventoryFilters', () => {
  it('reports nothing when no filter hides records', () => {
    expect(describeActiveInventoryFilters(EMPTY_FILTERS, 'all')).toEqual([]);
  });

  it('explains which filters hide the empty screen', () => {
    const active = describeActiveInventoryFilters(
      { ...EMPTY_FILTERS, q: 'ring', needsCleaning: true, gdprLocked: 'locked' },
      'gumus',
    );
    expect(active).toContain('kategori seçimi');
    expect(active).toContain('arama "ring"');
    expect(active).toContain('temizlik bekleyenler');
    expect(active).toContain('GDPR kilidi');
  });
});
