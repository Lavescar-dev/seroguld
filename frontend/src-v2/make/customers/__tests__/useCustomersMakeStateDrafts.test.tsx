import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/lib/toast';
import type { CustomerOut } from '@/types';

// M2: taslaklar artık toggle/ekran kapanışında uyarısız silinmiyor —
// yeni-müşteri taslağı korunur, yarım düzenleme "Yeni Müşteri" ile kesilirse
// stash'e gider ve aynı müşteride düzenlemeye dönüşte geri yüklenir.

vi.mock('@/lib/api', () => ({
  apiRequest: vi.fn(async (path: string) => {
    if (path.includes('/history')) return [];
    if (path.includes('log/workspace')) return { gold: { documents: [] }, silver: { documents: [] } };
    if (path.includes('/search')) return [];
    return { items: [], total: 0, page: 1, page_size: 100, total_pages: 1 };
  }),
  localizeApiError: vi.fn((error: unknown) => String(error)),
  printAuthedDocument: vi.fn(async () => undefined),
}));

import { useCustomersMakeState } from '../useCustomersMakeState';

function makeCustomer(overrides: Partial<CustomerOut> = {}): CustomerOut {
  return {
    id: 'c-1',
    name: 'Ada Yilmaz',
    email: 'ada@example.dk',
    phone: '87654321',
    address: 'Vesterbro 1',
    postal_code: '1620',
    city: 'København V',
    cpr_number: '',
    cpr_number_masked: '******1234',
    identity_doc_type: null,
    identity_doc_number: '',
    identity_doc_number_masked: null,
    identity_doc_country: null,
    identity_photo_refs: [],
    gdpr_status: 'active',
    gdpr_pseudonymized_at: null,
    marketing_opt_out_at: null,
    is_active: true,
    created_at: '2026-08-01T10:00:00Z',
    ...overrides,
  } as CustomerOut;
}

function DraftHarness({ customer }: { customer: CustomerOut }) {
  const state = useCustomersMakeState();
  return (
    <div>
      <button type="button" data-testid="toggle" onClick={state.onToggleNewRow}>toggle</button>
      <button type="button" data-testid="start-edit" onClick={() => state.onStartEdit(customer)}>start-edit</button>
      <button type="button" data-testid="cancel-edit" onClick={state.onCancelEdit}>cancel-edit</button>
      <input data-testid="new-name" value={state.newDraft.name} onChange={(event) => state.onNewDraftChange('name', event.target.value)} />
      <input data-testid="new-city" value={state.newDraft.city} onChange={(event) => state.onNewDraftChange('city', event.target.value)} />
      <input data-testid="edit-name" value={state.editDraft.name} onChange={(event) => state.onEditDraftChange('name', event.target.value)} />
      <span data-testid="editing">{state.editingId ?? ''}</span>
      <span data-testid="show-new">{String(state.showNewRow)}</span>
    </div>
  );
}

function renderHarness(customer: CustomerOut) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/musteriler']}>
        <ToastProvider>
          <DraftHarness customer={customer} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('useCustomersMakeState — taslak korunumu (M2)', () => {
  it('yeni-müşteri taslağı form kapatılıp açıldığında korunur (OCR verisi uyarısız kaybolmaz)', () => {
    renderHarness(makeCustomer());

    fireEvent.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('show-new').textContent).toBe('true');

    fireEvent.change(screen.getByTestId('new-name'), { target: { value: 'Ada OCR Taraması' } });
    fireEvent.change(screen.getByTestId('new-city'), { target: { value: 'København V' } });

    // X ile kapatma — taslak silinmez.
    fireEvent.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('show-new').textContent).toBe('false');

    // Yeniden açınca taslak doldurulmuş gelir.
    fireEvent.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('show-new').textContent).toBe('true');
    expect((screen.getByTestId('new-name') as HTMLInputElement).value).toBe('Ada OCR Taraması');
    expect((screen.getByTestId('new-city') as HTMLInputElement).value).toBe('København V');
  });

  it('"Yeni Müşteri" düzenlemeyi keserse yarım düzenleme taslağı saklanır ve geri yüklenir', () => {
    renderHarness(makeCustomer());

    fireEvent.click(screen.getByTestId('start-edit'));
    expect(screen.getByTestId('editing').textContent).toBe('c-1');
    fireEvent.change(screen.getByTestId('edit-name'), { target: { value: 'Yarım Düzenleme' } });

    // "Yeni Müşteri" — düzenleme kapanır ama taslak saklanır.
    fireEvent.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('editing').textContent).toBe('');
    expect(screen.getByTestId('show-new').textContent).toBe('true');

    // Aynı müşteride düzenlemeye dönüş — stash geri yüklenir.
    fireEvent.click(screen.getByTestId('start-edit'));
    expect(screen.getByTestId('editing').textContent).toBe('c-1');
    expect((screen.getByTestId('edit-name') as HTMLInputElement).value).toBe('Yarım Düzenleme');
  });

  it('Vazgeç taslağı atar — yeniden düzenleme kayıttan kurulur', () => {
    renderHarness(makeCustomer());

    fireEvent.click(screen.getByTestId('start-edit'));
    fireEvent.change(screen.getByTestId('edit-name'), { target: { value: 'Atılacak Düzenleme' } });

    fireEvent.click(screen.getByTestId('cancel-edit'));
    expect(screen.getByTestId('editing').textContent).toBe('');

    fireEvent.click(screen.getByTestId('start-edit'));
    expect((screen.getByTestId('edit-name') as HTMLInputElement).value).toBe('Ada Yilmaz');
    // M2: düzenleme taslağı kayıttan kurulurken city de gelir.
    expect(screen.getByTestId('editing').textContent).toBe('c-1');
  });
});
