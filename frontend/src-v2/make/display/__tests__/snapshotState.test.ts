import { describe, expect, it } from 'vitest';

import type { PosDisplaySnapshot } from '@/types';

import { applyIncomingDisplaySnapshot } from '../snapshotState';

function snapshot(overrides: Partial<PosDisplaySnapshot> = {}): PosDisplaySnapshot {
  return {
    session_code: 'AFG-1',
    status: 'draft',
    trade_side: 'buy_from_customer',
    customer_name: 'Ada',
    customer_phone: '123',
    customer_email: 'ada@example.test',
    customer_address: 'Old Street',
    customer_postal_code: '2500',
    customer_city: 'Copenhagen',
    customer_cpr_masked: '******1234',
    customer_identity_doc_number_masked: '****5678',
    preview_sequence: null,
    workspace_revision: 1,
    gold_rows: [],
    silver_rows: [],
    lines: [],
    ...overrides,
  } as PosDisplaySnapshot;
}

describe('display snapshot ordering', () => {
  it('treats explicit empty values as authoritative', () => {
    const current = snapshot();
    const incoming = snapshot({
      customer_name: '',
      customer_phone: null,
      customer_address: null,
      customer_postal_code: null,
      customer_city: '',
      workspace_revision: 2,
    });

    const next = applyIncomingDisplaySnapshot(current, incoming, 'display:update');

    expect(next.customer_name).toBe('');
    expect(next.customer_phone).toBeNull();
    expect(next.customer_address).toBeNull();
    expect(next.customer_postal_code).toBeNull();
    expect(next.customer_city).toBe('');
  });

  it('ignores an older revision even when its preview sequence is newer', () => {
    const current = snapshot({ workspace_revision: 4, preview_sequence: 8 });
    const stale = snapshot({ workspace_revision: 3, preview_sequence: 99, customer_name: 'Stale' });

    expect(applyIncomingDisplaySnapshot(current, stale, 'display:preview')).toBe(current);
  });

  it('lets a committed update replace a same-revision preview', () => {
    const current = snapshot({ preview_sequence: 7, customer_name: 'Typing' });
    const committed = snapshot({ preview_sequence: null, customer_name: 'Saved' });

    expect(applyIncomingDisplaySnapshot(current, committed, 'display:update').customer_name).toBe('Saved');
  });
});
