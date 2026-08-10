import { describe, expect, it } from 'vitest';

import { reconcileDraftCustomerAutosaveAcknowledgement } from '../useAlisMakeState';
import type { EditableCustomer } from '../types';

const blankCustomer: EditableCustomer = {
  name: '',
  email: '',
  phone: '',
  address: '',
  postal_code: '',
  city: '',
  cpr_number: '',
  identity_doc_type: '',
  identity_doc_number: '',
  identity_doc_country: '',
};

describe('new-customer draft autosave acknowledgement', () => {
  it('settles an acknowledged new-customer draft against newCustomer, so it is not requeued or treated as pending', () => {
    const savedCustomer: EditableCustomer = {
      ...blankCustomer,
      name: 'Lars Nielsen',
      phone: '+45 12 34 56 78',
      cpr_number: '120385-1234',
      identity_doc_number: 'DK123456',
      address: 'Nørregade 1',
      postal_code: '1165',
      city: 'København K',
    };

    const acknowledgement = reconcileDraftCustomerAutosaveAcknowledgement({
      customerMode: 'new',
      customerForm: blankCustomer,
      newCustomer: savedCustomer,
      acknowledgedPayload: savedCustomer,
      savedCustomer,
    });

    expect(acknowledgement).toEqual({ settled: true, autosaveKey: JSON.stringify(savedCustomer) });
    expect(JSON.stringify(savedCustomer) === acknowledgement.autosaveKey).toBe(true);
  });

  it('does not settle an older draft response after another new-customer edit', () => {
    const acknowledgedPayload = { ...blankCustomer, name: 'Lars Nielsen' };
    const acknowledgement = reconcileDraftCustomerAutosaveAcknowledgement({
      customerMode: 'new',
      customerForm: blankCustomer,
      newCustomer: { ...acknowledgedPayload, phone: '+45 12 34 56 78' },
      acknowledgedPayload,
      savedCustomer: acknowledgedPayload,
    });

    expect(acknowledgement).toEqual({ settled: false });
  });
});
