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

export interface CustomersPageProps {
  search: string;
  onSearchChange: (value: string) => void;
  customers: CustomerOut[];
  selectedId: string | null;
  onSelectCustomer: (customerId: string | null) => void;
  editingId: string | null;
  showNewRow: boolean;
  onToggleNewRow: () => void;
  newDraft: CustomerDraft;
  onNewDraftChange: (field: keyof CustomerDraft, value: string) => void;
  onSaveNew: () => void;
  editDraft: CustomerDraft;
  onEditDraftChange: (field: keyof CustomerDraft, value: string) => void;
  onSaveEdit: (customerId: string) => void;
  onCancelEdit: () => void;
  onStartEdit: (customer: CustomerOut) => void;
  onDelete: (customer: CustomerOut) => void;
  selectedCustomer: CustomerDetailOut | CustomerOut | null;
  historyItems: PosDocumentListItem[];
  historySummary: {
    count: number;
    total: number;
    lastDate: string | null;
  };
  historyLogMeta: Record<number, CustomerHistoryLogMeta>;
  expandedSequenceNo: number | null;
  onToggleHistory: (sequenceNo: number) => void;
  expandedDetail: PosDocumentDetail | null;
  previewSequenceNo: number | null;
  previewDetail: PosDocumentDetail | null;
  previewLoading: boolean;
  onPreviewOpen: (sequenceNo: number) => void;
  onPreviewClose: () => void;
}
