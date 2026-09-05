import type { CustomerDetailOut, CustomerOut, PosDocumentDetail, PosDocumentListItem } from '@/types';

export type CustomerDraft = {
  name: string;
  email: string;
  phone: string;
  address: string;
  postal_code: string;
  cpr_number: string;
  identity_doc_type: string;
  identity_doc_number: string;
  identity_doc_country: string;
};

export const EMPTY_DRAFT: CustomerDraft = {
  name: '',
  email: '',
  phone: '',
  address: '',
  postal_code: '',
  cpr_number: '',
  identity_doc_type: '',
  identity_doc_number: '',
  identity_doc_country: 'DK',
};

export interface CustomerHistoryLogMeta {
  inLog: boolean;
  splitCount: number;
  smykkerCount: number;
  smykkerGrams: number;
  whiteGoldCount: number;
  whiteGoldGrams: number;
  separateStorageCount: number;
  separateStorageGrams: number;
}

/** A6-3: pasif müşteriler filtresi — backend `status=active|inactive|all`. */
export type CustomerStatusFilter = 'active' | 'inactive' | 'all';

/** A6-5: geçmiş / detay-satırı / preview sorguları için ortak retry hedefi. */
export type CustomerDocumentQueryTarget = 'history' | 'expanded-detail' | 'preview';

/**
 * A6-5: adapter phase — "veri yok" ile "veri alınamadı"yı ve arama boşluğunu ayırır.
 * (modern/adapters/customers.ts benimser; yadaplıncaya kadar modül local türetir.)
 */
export type CustomersPhase = 'loading' | 'empty' | 'no-results' | 'ready';

export interface CustomersPageProps {
  search: string;
  onSearchChange: (value: string) => void;
  customers: CustomerOut[];
  totalCustomers: number;
  customerPage: number;
  customerPageSize: number;
  customerTotalPages: number;
  onCustomerPageChange: (page: number) => void;
  /** A6-5: liste iskeleti için ilk yükleme göstergesi. */
  customersLoading: boolean;
  /** A6-5: liste sorgusu hata durumunda "Müşteriler yüklenemedi" bandı. */
  customersError: boolean;
  onRetryCustomers: () => void;
  /** A6-3: Aktif / Pasif / Tümü filtresi. */
  customerStatus: CustomerStatusFilter;
  onCustomerStatusChange: (status: CustomerStatusFilter) => void;
  selectedId: string | null;
  onSelectCustomer: (customerId: string | null) => void;
  editingId: string | null;
  showNewRow: boolean;
  onToggleNewRow: () => void;
  newDraft: CustomerDraft;
  onNewDraftChange: (field: keyof CustomerDraft, value: string) => void;
  onSaveNew: () => void;
  isSavingNew: boolean;
  editDraft: CustomerDraft;
  onEditDraftChange: (field: keyof CustomerDraft, value: string) => void;
  onSaveEdit: (customerId: string) => void;
  isUpdatingCustomer: boolean;
  onCancelEdit: () => void;
  onStartEdit: (customer: CustomerOut) => void;
  onDelete: (customer: CustomerOut) => void;
  isDeletingCustomer: boolean;
  /** A6-6: silme isteği olan satırın id'si — yalnız ilgili satır kilitlenir. */
  deletingId: string | null;
  /** A6-3: pasif kaydı geri açma (PUT is_active=true). */
  onReactivate: (customer: CustomerOut) => void;
  reactivatingId: string | null;
  selectedCustomer: CustomerDetailOut | CustomerOut | null;
  historyItems: PosDocumentListItem[];
  /** A6-5: geçmiş sorgusu yükleniyor / hata + ortak retry. */
  isHistoryLoading: boolean;
  isHistoryError: boolean;
  onRetryDocumentQuery: (target: CustomerDocumentQueryTarget) => void;
  historySummary: {
    count: number;
    total: number;
    lastDate: string | null;
  };
  historyLogMeta: Record<number, CustomerHistoryLogMeta>;
  expandedSequenceNo: number | null;
  onToggleHistory: (sequenceNo: number) => void;
  expandedDetail: PosDocumentDetail | null;
  expandedDetailLoading: boolean;
  expandedDetailError: boolean;
  previewSequenceNo: number | null;
  previewDetail: PosDocumentDetail | null;
  previewLoading: boolean;
  previewError: boolean;
  onPreviewOpen: (sequenceNo: number) => void;
  onPreviewClose: () => void;
}
