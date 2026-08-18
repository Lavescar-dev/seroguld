import { describe, expect, it } from 'vitest';

import { customerSelectionRoute } from '../useCustomersMakeState';

describe('customer selection route', () => {
  it('keeps the selected customer on the customer workspace route', () => {
    expect(customerSelectionRoute('customer/id 1')).toBe('/musteriler?customer=customer%2Fid%201');
  });
});
