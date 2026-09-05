import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmProvider } from '@/components/ConfirmDialog';
import { ToastProvider } from '@/lib/toast';
import type { CustomerOut } from '@/types';

import { CustomersPage } from '../CustomersPage';
import type { CustomerDraft, CustomersPageProps } from '../types';

function makeCustomer(overrides: Partial<CustomerOut> = {}): CustomerOut {
  return {
    id: overrides.id ?? 'c-1',
    name: 'Ada Yilmaz',
    email: 'ada@example.dk',
    phone: '87654321',
    address: 'Vesterbro 1',
    postal_code: '1620',
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

const EMPTY_DRAFT: CustomerDraft = {
  name: '',
  email: '',
  phone: '',
  address: '',
  postal_code: '',
  city: '',
  cpr_number: '',
  identity_doc_type: '',
  identity_doc_number: '',
  identity_doc_country: 'DNK',
};

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

function renderPage(state: CustomersPageProps) {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <CustomersPage {...state} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe('CustomersPage klasik yüzey (A6 düzeltimleri)', () => {
  it('A6-4: rozet totalCustomers gösterir; Önceki/Sonraki + "X/Y kayıt" kontrolü çalışır', () => {
    const onCustomerPageChange = vi.fn();
    renderPage(
      buildState({
        customers: [makeCustomer({ id: 'c-1' }), makeCustomer({ id: 'c-2', name: 'Bora Mert' })],
        totalCustomers: 247,
        customerTotalPages: 3,
        onCustomerPageChange,
      }),
    );

    // Rozet artık yalnız indirilen sayfayı (2) değil toplamı (247) gösterir.
    expect(screen.getByText('247')).toBeInTheDocument();
    expect(screen.getByText('1/3 — 247 kayıt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Önceki müşteri sayfası' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Sonraki müşteri sayfası' }));
    expect(onCustomerPageChange).toHaveBeenCalledWith(2);
  });

  it('A6-4: arama modunda sayfalama gizlidir', () => {
    renderPage(buildState({ search: 'ada', customers: [makeCustomer()] }));
    expect(screen.queryByRole('button', { name: 'Sonraki müşteri sayfası' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Önceki müşteri sayfası' })).not.toBeInTheDocument();
  });

  it('A6-5: hata bandı "Müşteriler yüklenemedi" + Tekrar dene onRetryCustomers çağırır', () => {
    const onRetryCustomers = vi.fn();
    renderPage(buildState({ customersError: true, onRetryCustomers }));
    expect(screen.getByText('Müşteriler yüklenemedi')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(onRetryCustomers).toHaveBeenCalledTimes(1);
  });

  it('A6-5: yüklenirken iskelet satırları gösterilir, "veri yok" metni ÇIKMAZ', () => {
    renderPage(buildState({ customersLoading: true }));
    expect(screen.queryByText('Henüz kayıtlı müşteri yok')).not.toBeInTheDocument();
    // 5 satırlık iskelet (aria-hidden).
    expect(screen.getAllByRole('row', { hidden: true }).filter((row) => row.getAttribute('aria-hidden') === 'true')).toHaveLength(5);
  });

  it('A6-3: pasif müşteri soluk satırda Pasif rozeti + "Yeniden aktifleştir" ile geri açılır', () => {
    const onReactivate = vi.fn();
    renderPage(
      buildState({
        customers: [makeCustomer({ id: 'c-1', is_active: false, name: 'Pasif Kisi' })],
        onReactivate,
      }),
    );
    expect(screen.getByText('Pasif', { selector: 'span' })).toBeInTheDocument();
    const reactivate = screen.getByRole('button', { name: 'Pasif Kisi yeniden aktifleştir' });
    fireEvent.click(reactivate);
    expect(onReactivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-1' }));
  });

  it('A6-6: silme kilidi yalnız deletingId satırını kilitler, diğer satır erişilebilir kalır', () => {
    const onDelete = vi.fn();
    renderPage(
      buildState({
        customers: [makeCustomer({ id: 'c-1', name: 'Birinci' }), makeCustomer({ id: 'c-2', name: 'Ikinci' })],
        deletingId: 'c-1',
        isDeletingCustomer: true,
        onDelete,
      }),
    );
    expect(screen.getByRole('button', { name: 'Birinci pasife al' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ikinci pasife al' })).toBeEnabled();
  });

  it('A6-6: boş taslak gönderilmez — Kaydet kapalı ve Enter boş adla kaydetmez; ad dolunca Enter kaydeder', () => {
    const onSaveNew = vi.fn();
    const { rerender } = renderPage(buildState({ showNewRow: true, onSaveNew }));

    expect(screen.getByRole('button', { name: 'Yeni kaydet' })).toBeDisabled();
    const nameInput = screen.getByLabelText('Müşteri adı');
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    expect(onSaveNew).not.toHaveBeenCalled();

    // Kontrollü bileşen: ad dolu taslakla rerender sonrası Kaydet + Enter açılır.
    rerender(
      <ToastProvider>
        <ConfirmProvider>
          <CustomersPage {...buildState({ showNewRow: true, onSaveNew, newDraft: { ...EMPTY_DRAFT, name: 'Ada Yilmaz' } })} />
        </ConfirmProvider>
      </ToastProvider>,
    );
    const saveButton = screen.getByRole('button', { name: 'Yeni kaydet' });
    expect(saveButton).toBeEnabled();
    fireEvent.keyDown(screen.getByLabelText('Müşteri adı'), { key: 'Enter' });
    expect(onSaveNew).toHaveBeenCalledTimes(1);
  });

  it('A6-6: kaydetme sürerken (isSaving) isPending hem tıkı hem Enter\'ı keser', () => {
    const onSaveNew = vi.fn();
    renderPage(
      buildState({
        showNewRow: true,
        isSavingNew: true,
        newDraft: { ...EMPTY_DRAFT, name: 'Ada Yilmaz' },
        onSaveNew,
      }),
    );
    const saveButton = screen.getByRole('button', { name: 'Yeni kaydet' });
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(onSaveNew).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('Müşteri adı'), { key: 'Enter' });
    expect(onSaveNew).not.toHaveBeenCalled();
  });

  it('A6-3: Aktif/Pasif/Tümü durum filtresi onCustomerStatusChange ile sayfayı sıfırlar (state tarafı)', () => {
    const onCustomerStatusChange = vi.fn();
    renderPage(buildState({ onCustomerStatusChange }));
    fireEvent.click(screen.getByRole('button', { name: 'Pasif' }));
    expect(onCustomerStatusChange).toHaveBeenCalledWith('inactive');
    fireEvent.click(screen.getByRole('button', { name: 'Tümü' }));
    expect(onCustomerStatusChange).toHaveBeenCalledWith('all');
  });
});
