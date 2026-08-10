import { useEffect, useRef, useState } from 'react';

import { apiRequest } from '@/lib/api';
import type { PosCustomerMatchItem, PosCustomerMatchResponse } from '@/types';

import type { EditableCustomer } from './types';

export type CustomerMatchState = {
  loading: boolean;
  response: PosCustomerMatchResponse | null;
  error: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeCustomerMatch(value: unknown): PosCustomerMatchResponse {
  const record = asRecord(value);
  const rawMatches = Array.isArray(record?.matches) ? record.matches : [];
  const matches = rawMatches.flatMap((item): PosCustomerMatchItem[] => {
    const match = asRecord(item);
    const id = text(match?.customer_id) || text(match?.id);
    const name = text(match?.name);
    return id && name ? [{ id, name, matched_by: text(match?.matched_by) || null }] : [];
  });
  const rawStatus = text(record?.status);
  const status = rawStatus === 'none' || rawStatus === 'single' || rawStatus === 'conflict'
    ? rawStatus
    : matches.length === 0 ? 'none' : matches.length === 1 ? 'single' : 'conflict';
  return { status, matches };
}

export function useCustomerMatch(customer: EditableCustomer): CustomerMatchState {
  const [state, setState] = useState<CustomerMatchState>({ loading: false, response: null, error: false });
  const requestRef = useRef(0);
  const cpr = customer.cpr_number.trim();
  const identityDocument = customer.identity_doc_number.trim();

  useEffect(() => {
    if (!cpr && !identityDocument) {
      requestRef.current += 1;
      setState({ loading: false, response: null, error: false });
      return;
    }
    const requestId = ++requestRef.current;
    setState((current) => ({ ...current, loading: true, error: false }));
    const timeoutId = window.setTimeout(() => {
      void apiRequest<unknown>('/api/v2/alis/customer-match', {
        method: 'POST',
        body: JSON.stringify({
          cpr_number: cpr || undefined,
          identity_doc_number: identityDocument || undefined,
        }),
      })
        .then((response) => {
          if (requestRef.current !== requestId) return;
          setState({ loading: false, response: normalizeCustomerMatch(response), error: false });
        })
        .catch(() => {
          if (requestRef.current !== requestId) return;
          setState({ loading: false, response: null, error: true });
        });
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [cpr, identityDocument]);

  return state;
}
