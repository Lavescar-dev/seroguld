import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmProvider } from '@/components/ConfirmDialog';
import type { EditableCustomer } from '@/make/alis/types';
import type { AlisPageProps } from '@/make/alis/AlisPage';
import { ModernCustomerDrawerBody } from '../modules/alis';

const EMPTY_CUSTOMER: EditableCustomer = {
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

function buildState(overrides: {
  customerMode: 'existing' | 'new' | null;
  hasSelectedCustomer: boolean;
  onDetachCustomer?: () => void;
}): AlisPageProps {
  const attachedCustomer: AlisPageProps['workspace'] = {
    customer: { name: 'OMAR HUSSEIN AL-RASHID', customer_id: 'c-1' },
  } as AlisPageProps['workspace'];
  return {
    customerMode: overrides.customerMode,
    setCustomerMode: vi.fn(),
    customerSearchTerm: '',
    setCustomerSearchTerm: vi.fn(),
    candidateCustomers: [],
    customerSelecting: false,
    newCustomer: { ...EMPTY_CUSTOMER },
    setNewCustomer: vi.fn(),
    customerForm: overrides.hasSelectedCustomer ? { ...EMPTY_CUSTOMER, name: 'OMAR HUSSEIN AL-RASHID', phone: '432324234' } : { ...EMPTY_CUSTOMER },
    setCustomerForm: vi.fn(),
    onCustomerBlur: vi.fn(),
    onDetachCustomer: overrides.onDetachCustomer ?? vi.fn(),
    detachCustomerPending: false,
    workspace: overrides.hasSelectedCustomer ? attachedCustomer : null,
  } as unknown as AlisPageProps;
}

function renderBody(state: AlisPageProps, hasSelectedCustomer: boolean) {
  return render(
    <ConfirmProvider>
      <ModernCustomerDrawerBody state={state} hasSelectedCustomer={hasSelectedCustomer} />
    </ConfirmProvider>,
  );
}

describe('ModernCustomerDrawerBody', () => {
  it('attached müşteride yalnız düzenleme alanlarını gösterir; arama/form ASLA yanında render edilmez', () => {
    const state = buildState({ customerMode: 'existing', hasSelectedCustomer: true });
    renderBody(state, true);

    // Seçili müşteri özeti + düzenlenebilir alanlar
    expect(screen.getByText('OMAR HUSSEIN AL-RASHID')).toBeInTheDocument();
    expect(screen.getByText('Değiştir')).toBeInTheDocument();
    expect(screen.getByLabelText('Ad Soyad')).toBeInTheDocument();

    // Stacking regresyon guard'ı: arama inputu ve segment yok
    expect(screen.queryByPlaceholderText('İsim, CPR, telefon...')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByText('Zorunlu kimlik alanlarını tamamlayın.')).not.toBeInTheDocument();
  });

  it('müşterisizken segment görünür; mevcut müşteri sekmesinde arama paneli açılır', () => {
    const state = buildState({ customerMode: 'existing', hasSelectedCustomer: false });
    renderBody(state, false);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[0]).toHaveTextContent('Mevcut müşteri');
    expect(tabs[1]).toHaveTextContent('Yeni müşteri');

    expect(screen.getByPlaceholderText('İsim, CPR, telefon...')).toBeInTheDocument();
    expect(screen.queryByLabelText('Ad Soyad')).not.toBeInTheDocument();
  });

  it('"Seçimi kaldır" onay diyaloğuyla onDetachCustomer çağrılır', async () => {
    const onDetachCustomer = vi.fn();
    const state = buildState({ customerMode: null, hasSelectedCustomer: true, onDetachCustomer });
    renderBody(state, true);

    fireEvent.click(screen.getByText('Seçimi kaldır'));

    expect(await screen.findByText('Müşteri seçimi kaldırılsın mı?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Bağlantıyı kaldır'));

    await waitFor(() => expect(onDetachCustomer).toHaveBeenCalledTimes(1));
  });

  it('"Değiştir" → müşteri seçimi sonrası panel attached görünümüne döner (replacing bayrağı takılı kalmaz)', () => {
    // Gerçek hook davranışını taklit eden sarmalayıcı: seçim başarıyla
    // tamamlandığında hook customerMode'u null'a çeker.
    function Harness({ onSelectExistingCustomer }: { onSelectExistingCustomer: (id: string) => void }) {
      const [mode, setMode] = useState<'existing' | 'new' | null>('existing');
      const [searchTerm, setSearchTerm] = useState('');
      const handleSelect = (id: string) => {
        onSelectExistingCustomer(id);
        setMode(null); // selectCustomerMutation.onSuccess davranışı
      };
      const state = {
        ...buildState({ customerMode: mode, hasSelectedCustomer: true }),
        customerSearchTerm: searchTerm,
        setCustomerSearchTerm: setSearchTerm,
        candidateCustomers: searchTerm.trim().length >= 2
          ? [{ id: 'c-2', name: 'Ada Yılmaz', phone: '87654321', cpr_number_masked: '******1234' }]
          : [],
        onSelectExistingCustomer: handleSelect,
      } as unknown as AlisPageProps;
      return <ModernCustomerDrawerBody state={state} hasSelectedCustomer />;
    }

    const onSelectExistingCustomer = vi.fn();
    render(<ConfirmProvider><Harness onSelectExistingCustomer={onSelectExistingCustomer} /></ConfirmProvider>);

    // Attached görünüm → Değiştir → arama paneli
    fireEvent.click(screen.getByText('Değiştir'));
    expect(screen.getByRole('tablist', { name: 'Müşteri seçim yöntemi' })).toBeInTheDocument();

    // Arama yapınca aday satırı gelir; tıklanınca seçim tetiklenir
    fireEvent.change(screen.getByPlaceholderText('İsim, CPR, telefon...'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByText('Ada Yılmaz'));

    expect(onSelectExistingCustomer).toHaveBeenCalledWith('c-2');

    // Seçim başarılı (mode null) olduktan sonra ASLA pick-action/segment'te takılı kalmaz
    expect(screen.queryByRole('tablist', { name: 'Müşteri seçim yöntemi' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ad Soyad')).toBeInTheDocument();
  });
});
