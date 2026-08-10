import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';

import { apiRequest } from '@/lib/api';
import type { PosAddressResolveResponse, PosAddressSearchResponse, PosAddressSearchSuggestion, PosPostalLookup } from '@/types';

import type { EditableCustomer } from './types';

export type AddressAutocompleteStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'unavailable' | 'resolving';

type AddressSnapshot = Pick<EditableCustomer, 'address' | 'postal_code' | 'city'>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizePostalCode(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '').slice(0, 4);
}

export function normalizeAddressSuggestions(value: unknown): PosAddressSearchResponse {
  const record = asRecord(value);
  const rawResults = Array.isArray(record?.results) ? record.results : [];
  const results = rawResults.flatMap((item) => {
    const itemRecord = asRecord(item);
    const id = text(itemRecord?.id);
    const title = text(itemRecord?.title) || text(itemRecord?.label);
    const type = text(itemRecord?.type) || text(itemRecord?.address_type) || text(itemRecord?.kind);
    return id && title ? [{ id, title, type: type || 'address' }] : [];
  });
  return {
    available: record?.available !== false,
    results,
  };
}

export function normalizeResolvedAddress(value: unknown): PosAddressResolveResponse | null {
  const record = asRecord(value);
  const address = text(record?.address) || text(record?.address_line);
  const postalCode = normalizePostalCode(text(record?.postal_code) || text(record?.postnr));
  const city = text(record?.city) || text(record?.postal_district);
  if (!address || postalCode.length !== 4 || !city) return null;
  return { address, postal_code: postalCode, city };
}

export function canApplyResolvedAddress(current: EditableCustomer, snapshot: AddressSnapshot): boolean {
  return (
    current.address === snapshot.address &&
    normalizePostalCode(current.postal_code) === normalizePostalCode(snapshot.postal_code) &&
    current.city === snapshot.city
  );
}

export function useAddressAutocomplete({
  customer,
  setCustomer,
  onApplied,
}: {
  customer: EditableCustomer;
  setCustomer: Dispatch<SetStateAction<EditableCustomer>>;
  onApplied?: () => void;
}) {
  const [status, setStatus] = useState<AddressAutocompleteStatus>('idle');
  const [suggestions, setSuggestions] = useState<PosAddressSearchSuggestion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [postalLookupStatus, setPostalLookupStatus] = useState<'idle' | 'loading' | 'ready' | 'not_found' | 'unavailable'>('idle');
  const searchRequestRef = useRef(0);
  const resolveRequestRef = useRef(0);
  const postalRequestRef = useRef(0);
  const autoCityRef = useRef('');
  const customerRef = useRef(customer);
  customerRef.current = customer;
  const postalCode = normalizePostalCode(customer.postal_code);
  const query = customer.address.trim();

  useEffect(() => {
    if (postalCode.length !== 4) {
      postalRequestRef.current += 1;
      setPostalLookupStatus('idle');
      return;
    }
    const requestId = ++postalRequestRef.current;
    setPostalLookupStatus('loading');
    const timeoutId = window.setTimeout(() => {
      void apiRequest<PosPostalLookup>(`/api/v2/alis/postal-lookup/${postalCode}`)
        .then((response) => {
          if (postalRequestRef.current !== requestId || normalizePostalCode(customerRef.current.postal_code) !== postalCode) return;
          if (!response.available) {
            setPostalLookupStatus('unavailable');
            return;
          }
          const nextCity = String(response.postal_district || '').trim();
          if (!response.found || !nextCity) {
            setPostalLookupStatus('not_found');
            return;
          }
          const current = customerRef.current;
          const previousAutoCity = autoCityRef.current;
          if (current.city.trim() && current.city.trim() !== previousAutoCity) {
            setPostalLookupStatus('ready');
            return;
          }
          if (current.city === nextCity) {
            autoCityRef.current = nextCity;
            setPostalLookupStatus('ready');
            return;
          }
          autoCityRef.current = nextCity;
          setCustomer((latest) => {
            if (normalizePostalCode(latest.postal_code) !== postalCode) return latest;
            if (latest.city.trim() && latest.city.trim() !== previousAutoCity) return latest;
            return latest.city === nextCity ? latest : { ...latest, city: nextCity };
          });
          setPostalLookupStatus('ready');
          window.setTimeout(() => onApplied?.(), 0);
        })
        .catch(() => {
          if (postalRequestRef.current === requestId) setPostalLookupStatus('unavailable');
        });
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [onApplied, postalCode, setCustomer]);

  useEffect(() => {
    if (postalCode.length !== 4 || query.length < 2) {
      searchRequestRef.current += 1;
      setSuggestions([]);
      setSelectedId(null);
      setStatus('idle');
      return;
    }

    const requestId = ++searchRequestRef.current;
    setStatus('loading');
    const timeoutId = window.setTimeout(() => {
      const search = new URLSearchParams({ q: query, postal_code: postalCode, limit: '8' });
      void apiRequest<unknown>(`/api/v2/alis/address-search?${search.toString()}`)
        .then((response) => {
          if (searchRequestRef.current !== requestId) return;
          const normalized = normalizeAddressSuggestions(response);
          setSuggestions(normalized.results);
          setStatus(normalized.available ? (normalized.results.length ? 'ready' : 'empty') : 'unavailable');
        })
        .catch(() => {
          if (searchRequestRef.current !== requestId) return;
          setSuggestions([]);
          setStatus('unavailable');
        });
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [postalCode, query]);

  const selectSuggestion = useCallback((suggestion: PosAddressSearchSuggestion) => {
    const snapshot: AddressSnapshot = {
      address: customer.address,
      postal_code: customer.postal_code,
      city: customer.city,
    };
    const requestId = ++resolveRequestRef.current;
    setSelectedId(suggestion.id);
    setStatus('resolving');
    void apiRequest<unknown>(`/api/v2/alis/address-resolve/${encodeURIComponent(suggestion.id)}`)
      .then((response) => {
        if (resolveRequestRef.current !== requestId) return;
        const resolved = normalizeResolvedAddress(response);
        if (!resolved) {
          setSelectedId(null);
          setStatus('unavailable');
          return;
        }
        if (!canApplyResolvedAddress(customerRef.current, snapshot)) {
          setSelectedId(null);
          setStatus('ready');
          return;
        }
        setCustomer((current) => {
          if (!canApplyResolvedAddress(current, snapshot)) return current;
          return {
            ...current,
            address: resolved.address,
            postal_code: resolved.postal_code,
            city: resolved.city,
          };
        });
        setSelectedId(null);
        setSuggestions([]);
        setStatus('idle');
        window.setTimeout(() => onApplied?.(), 0);
      })
      .catch(() => {
        if (resolveRequestRef.current !== requestId) return;
        setSelectedId(null);
        setStatus('unavailable');
      });
  }, [customer.address, customer.city, customer.postal_code, onApplied, setCustomer]);

  return { status, suggestions, selectedId, postalCode, query, postalLookupStatus, selectSuggestion };
}
