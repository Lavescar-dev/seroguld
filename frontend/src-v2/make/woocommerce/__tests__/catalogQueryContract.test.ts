import { describe, expect, it } from 'vitest';

import { ApiError, TransportError } from '@/lib/api';
import {
  isCatalogPreviewInvalidatedError,
  wooCatalogQueryKeys,
} from '@/make/woocommerce/useWooMakeState';


describe('Woo catalog query contract', () => {
  it('keeps remote catalog cache separate from local Woo product queries', () => {
    expect(wooCatalogQueryKeys.status).toEqual(['woocommerce-catalog', 'status']);
    expect(wooCatalogQueryKeys.list(2, 'ring')).toEqual([
      'woocommerce-catalog',
      'list',
      { page: 2, search: 'ring' },
    ]);
    expect(wooCatalogQueryKeys.status[0]).not.toBe('woocommerce');
  });

  it('invalidates a preview only for conflict or owner errors', () => {
    expect(isCatalogPreviewInvalidatedError(new ApiError(409, 'expired'))).toBe(true);
    expect(isCatalogPreviewInvalidatedError(new ApiError(403, 'wrong owner'))).toBe(true);
    expect(isCatalogPreviewInvalidatedError(new ApiError(502, 'upstream'))).toBe(false);
    expect(isCatalogPreviewInvalidatedError(new TransportError('offline'))).toBe(false);
  });
});
