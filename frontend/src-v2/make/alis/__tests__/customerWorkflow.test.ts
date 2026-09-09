import { describe, expect, it } from 'vitest';

import { canApplyResolvedAddress, normalizeAddressSuggestions, normalizeResolvedAddress } from '../addressAutocomplete';
import { normalizeCustomerMatch } from '../customerMatch';
import { applyConfirmedIdentityResult, parseIdentityScan } from '../identityScan';
import type { EditableCustomer } from '../types';

const emptyCustomer: EditableCustomer = {
  name: '', email: '', phone: '', address: 'Nørregade', postal_code: '1165', city: '', cpr_number: '', identity_doc_type: '', identity_doc_number: '', identity_doc_country: '',
};

describe('purchase customer workflow parsers', () => {
  it('parses a TD3 passport without deriving a CPR number from its date of birth', () => {
    const result = parseIdentityScan([
      'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
      'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
    ].join('\n'));

    expect(result.documentType).toBe('passport');
    expect(result.fields.name?.value).toBe('ANNA MARIA ERIKSSON');
    expect(result.fields.identity_doc_number).toMatchObject({ value: 'L898902C3', review: 'validated' });
    expect(result.fields.identity_doc_type?.value).toBe('passport');
    expect('cpr_number' in result.fields).toBe(false);
  });

  it('parses TD1 identity cards with the backend id_card enum', () => {
    const result = parseIdentityScan([
      'I<UTOD231458907<<<<<<<<<<<<<<<',
      '7408122F1204159UTO<<<<<<<<<<<6',
      'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
    ].join('\n'));

    expect(result.documentType).toBe('id_card');
    expect(result.fields.identity_doc_type?.value).toBe('id_card');
    expect(result.fields.identity_doc_number).toMatchObject({ value: 'D23145890', review: 'validated' });
  });

  it('marks Danish/EU driver-license heuristics as needing review', () => {
    // WP6: DK kørekortunda bopælsadresse basılı değildir — adres/posta/şehir
    // 8. alandan artık üretilmez; belge türü ad+numara tamamsa validated.
    const result = parseIdentityScan('KØREKORT\n1. NIELSEN\n2. LARS\n5. ABC123456\n8. Hovedgade 1, 2100 KOBENHAVN\nDK');

    expect(result.documentType).toBe('driver_license');
    expect(result.fields.identity_doc_number).toMatchObject({ value: 'ABC123456', review: 'needs_review' });
    expect(result.fields.postal_code).toBeUndefined();
    expect(result.fields.city).toBeUndefined();
    expect(applyConfirmedIdentityResult(emptyCustomer, result)).toMatchObject({
      identity_doc_type: 'driver_license',
      identity_doc_country: 'DNK',
      // Ad okunduğu için kişi grubu (adres dahil) sıfırlanıp yeniden yazılır:
      // körekortun üretmediği posta/şehir kalıntı olarak kalmaz.
      address: '',
      postal_code: '',
      city: '',
    });
  });

  it('normalizes address contracts and blocks a stale resolve from replacing an edited address', () => {
    expect(normalizeAddressSuggestions({ available: true, results: [{ id: 'x', address_type: 'road', label: 'Nørregade 1, 1165 København' }] })).toEqual({
      available: true,
      results: [{ id: 'x', type: 'road', title: 'Nørregade 1, 1165 København' }],
    });
    expect(normalizeResolvedAddress({ address_line: 'Nørregade 1', postal_code: '1165', city: 'København K' })).toEqual({ address: 'Nørregade 1', postal_code: '1165', city: 'København K' });
    expect(canApplyResolvedAddress({ ...emptyCustomer, address: 'Nørrebrogade' }, { address: 'Nørregade', postal_code: '1165', city: '' })).toBe(false);
  });

  it('accepts both customer_id and id in customer-match results', () => {
    expect(normalizeCustomerMatch({ status: 'conflict', matches: [{ customer_id: 'first', name: 'A' }, { id: 'second', name: 'B' }] })).toEqual({
      status: 'conflict',
      matches: [
        { id: 'first', name: 'A', matched_by: null, match_kind: null },
        { id: 'second', name: 'B', matched_by: null, match_kind: null },
      ],
    });
  });

  it('carries match_kind (R1-CPR birth) through the normalize whitelist', () => {
    expect(normalizeCustomerMatch({ status: 'single', matches: [{ id: 'p1', name: 'P', matched_by: 'birth', match_kind: 'birth' }] })).toEqual({
      status: 'single',
      matches: [{ id: 'p1', name: 'P', matched_by: 'birth', match_kind: 'birth' }],
    });
  });
});
