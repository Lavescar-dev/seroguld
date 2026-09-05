import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ModernCustomersViewModel } from '@/modern/adapters/customers';
import { ModernCustomersModule } from '@/modern/modules/customers';
import type { CustomerOut } from '@/types';
import { EMPTY_DRAFT, type CustomersPageProps } from '@/make/customers/types';

function makeCustomer(overrides: Partial<CustomerOut> = {}): CustomerOut {
  return {
    id: 'c-1',
    name: 'Ada Yilmaz',
    email: 'ada@example.dk',
    phone: '87654321',
    address: null,
    postal_code: null,
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

function buildState(overrides: Partial<CustomersPageProps> = {}): CustomersPageProps {
  return {
    search: '',
    onSearchChange: vi.fn(),
    customers: [],
    totalCustomers: 0,
    customerPage: 1,
    customerPageSize: 100,
    customerTotalPages: 1,
    onCustomerPageChange: vi.fn(),
    customersLoading: false,
    customersError: false,
    onRetryCustomers: vi.fn(),
    customerStatus: 'active',
    onCustomerStatusChange: vi.fn(),
    selectedId: null,
    onSelectCustomer: vi.fn(),
    editingId: null,
    showNewRow: false,
    onToggleNewRow: vi.fn(),
    newDraft: { ...EMPTY_DRAFT },
    onNewDraftChange: vi.fn(),
    onSaveNew: vi.fn(),
    isSavingNew: false,
    editDraft: { ...EMPTY_DRAFT },
    onEditDraftChange: vi.fn(),
    onSaveEdit: vi.fn(),
    isUpdatingCustomer: false,
    onCancelEdit: vi.fn(),
    onStartEdit: vi.fn(),
    onDelete: vi.fn(),
    isDeletingCustomer: false,
    deletingId: null,
    onReactivate: vi.fn(),
    reactivatingId: null,
    selectedCustomer: null,
    historyItems: [],
    isHistoryLoading: false,
    isHistoryError: false,
    onRetryDocumentQuery: vi.fn(),
    historySummary: { count: 0, total: 0, lastDate: null },
    historyLogMeta: {},
    expandedSequenceNo: null,
    onToggleHistory: vi.fn(),
    expandedDetail: null,
    expandedDetailLoading: false,
    expandedDetailError: false,
    previewSequenceNo: null,
    previewDetail: null,
    previewLoading: false,
    previewError: false,
    onPreviewOpen: vi.fn(),
    onPreviewClose: vi.fn(),
    ...overrides,
  };
}

function buildViewModel(state: CustomersPageProps): ModernCustomersViewModel {
  return { state, phase: state.customers.length ? 'ready' : 'empty', stats: [] };
}

function renderModule(state: CustomersPageProps) {
  return render(<ModernCustomersModule viewModel={buildViewModel(state)} />);
}

describe('ModernCustomersModule (A6 düzeltimleri)', () => {
  it('A6-7: önizleme drawerı detay gelmeden AÇIKTIR ve yükleniyor gösterir', () => {
    renderModule(buildState({ previewSequenceNo: 42, previewDetail: null, previewLoading: true }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Belge yükleniyor')).toBeInTheDocument();
  });

  it('A6-7: önizleme hatası sessiz kalmaz — hata bandı + Tekrar dene onRetryDocumentQuery("preview")', () => {
    const onRetryDocumentQuery = vi.fn();
    renderModule(buildState({ previewSequenceNo: 42, previewError: true, onRetryDocumentQuery }));
    expect(screen.getByText('Belge yüklenemedi')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(onRetryDocumentQuery).toHaveBeenCalledWith('preview');
  });

  it('A6-6: boş adla Kaydet kapalıdır; isSavingNew pending gösterir ve gönderimi keser', () => {
    const onSaveNew = vi.fn();
    const { rerender } = renderModule(buildState({ showNewRow: true, onSaveNew }));

    const saveButton = screen.getByRole('button', { name: 'Kaydet' });
    expect(saveButton).toBeDisabled();
    expect(screen.getByText('Ad soyad zorunludur.')).toBeInTheDocument();

    const nameInput = screen.getByLabelText('Ad soyad');
    fireEvent.change(nameInput, { target: { value: 'Ada Yilmaz' } });

    // İsim doldu ama state değişmedi (rerender ile isimli taslak + pending simüle edilir).
    rerender(<ModernCustomersModule viewModel={buildViewModel(buildState({ showNewRow: true, onSaveNew, newDraft: { ...EMPTY_DRAFT, name: 'Ada Yilmaz' } }))} />);
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeEnabled();

    rerender(<ModernCustomersModule viewModel={buildViewModel(buildState({ showNewRow: true, onSaveNew, isSavingNew: true, newDraft: { ...EMPTY_DRAFT, name: 'Ada Yilmaz' } }))} />);
    const pendingButton = screen.getByRole('button', { name: 'Kaydediliyor…' });
    expect(pendingButton).toBeDisabled();
    // Enter ile form submit'i de isPending'de kaydetmez.
    fireEvent.submit(pendingButton.closest('form')!);
    expect(onSaveNew).not.toHaveBeenCalled();
  });

  it('A6-5: liste hatasında "Müşteriler yüklenemedi" bandı ve retry görünür', () => {
    const onRetryCustomers = vi.fn();
    renderModule(buildState({ customersError: true, onRetryCustomers }));
    expect(screen.getByText('Müşteriler yüklenemedi')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(onRetryCustomers).toHaveBeenCalledTimes(1);
  });

  it('A6-5: yükleniyor fazı iskelet gösterir; boş arama ile "Henüz müşteri kaydı" ayrışır', () => {
    const { rerender } = renderModule(buildState({ customersLoading: true }));
    expect(screen.getByText('Müşteriler yükleniyor')).toBeInTheDocument();

    rerender(<ModernCustomersModule viewModel={buildViewModel(buildState({ search: 'zz' }))} />);
    expect(screen.getByText('Sonuç Bulunamadı')).toBeInTheDocument();
  });

  it('A6-3: durum filtresi onCustomerStatusChange çağırır', () => {
    const onCustomerStatusChange = vi.fn();
    renderModule(buildState({ onCustomerStatusChange }));
    fireEvent.click(screen.getByRole('button', { name: 'Pasif' }));
    expect(onCustomerStatusChange).toHaveBeenCalledWith('inactive');
  });

  it('A6-3: pasif müşteri satırı Pasif rozetli ve Yeniden aktifleştir aksiyonlu', () => {
    const onReactivate = vi.fn();
    renderModule(
      buildState({
        customers: [makeCustomer({ id: 'c-1', is_active: false, name: 'Pasif Kisi' })],
        onReactivate,
      }),
    );
    // Aynı buton masaüstü tablo + mobil kartta iki kez render edilir.
    const reactivateButtons = screen.getAllByRole('button', { name: 'Pasif Kisi yeniden aktifleştir' });
    expect(reactivateButtons.length).toBeGreaterThanOrEqual(1);
    for (const button of reactivateButtons) expect(button).toBeEnabled();
    fireEvent.click(reactivateButtons[0]);
    expect(onReactivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-1' }));
  });
});
