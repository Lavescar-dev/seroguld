import { describe, expect, it } from 'vitest';

import { EMPTY_FILTERS } from '../types';
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
