import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { apiRequest, localizeApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { CustomerDetailOut, CustomerOut, LogWorkspace, PaginatedResponse, PosDocumentDetail, PosDocumentListItem } from '@/types';

import {
  EMPTY_DRAFT,
  type CustomerDraft,
  type CustomerDocumentQueryTarget,
  type CustomerHistoryLogMeta,
  type CustomersPageProps,
  type CustomersPhase,
  type CustomerStatusFilter,
} from './types';

function cleanDraft(draft: CustomerDraft) {
  return {
    name: draft.name.trim(),
    email: draft.email.trim() || undefined,
    phone: draft.phone.trim() || undefined,
    address: draft.address.trim() || undefined,
    postal_code: draft.postal_code.trim() || undefined,
    city: draft.city.trim() || undefined,
    cpr_number: draft.cpr_number.trim() || undefined,
    identity_doc_type: draft.identity_doc_type || undefined,
    identity_doc_number: draft.identity_doc_number.trim() || undefined,
    identity_doc_country: draft.identity_doc_country.trim() || undefined,
  };
}

/** A6-5: adapter phase — yükleniyor / boş / arama boş / hazır ayrımı. */
export function deriveCustomersPhase(state: Pick<CustomersPageProps, 'customersLoading' | 'customersError' | 'customers' | 'search'>): CustomersPhase {
  if (state.customersError) return 'ready';
  if (state.customersLoading) return 'loading';
  if (state.customers.length > 0) return 'ready';
  return state.search.trim().length >= 2 ? 'no-results' : 'empty';
}

export function useCustomersMakeState(): CustomersPageProps {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [customerPage, setCustomerPage] = useState(1);
  const [customerStatus, setCustomerStatus] = useState<CustomerStatusFilter>('active');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('customer'));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [expandedSequenceNo, setExpandedSequenceNo] = useState<number | null>(null);
  const [previewSequenceNo, setPreviewSequenceNo] = useState<number | null>(null);
  const [showNewRow, setShowNewRow] = useState(false);
  const [newDraft, setNewDraft] = useState<CustomerDraft>(EMPTY_DRAFT);
  const [editDraft, setEditDraft] = useState<CustomerDraft>(EMPTY_DRAFT);
  // M2: "Yeni Müşteri" düzenleme modunu keserse yarım düzenleme taslağı burada
  // saklanır; aynı müşteride düzenlemeye dönülünce geri yüklenir (Vazgeç/Kaydet
  // temizler). Taslak artık toggle/ekran kapanışında uyarısız silinmez.
  const [editDraftStash, setEditDraftStash] = useState<{ customerId: string; draft: CustomerDraft } | null>(null);

  useEffect(() => {
    const customerId = searchParams.get('customer');
    if (customerId === selectedId) return;
    setSelectedId(customerId);
  }, [searchParams, selectedId]);

  function setSelectedCustomerId(customerId: string | null) {
    setSelectedId(customerId);
    if (customerId) {
      navigate(customerSelectionRoute(customerId));
    } else {
      navigate('/musteriler');
    }
  }

  const customersQuery = useQuery({
    queryKey: ['customers', search, customerPage, customerStatus],
    queryFn: async () => {
      if (search.trim().length >= 2) {
        return await apiRequest<CustomerOut[]>(
          `/api/v2/musteriler/search?q=${encodeURIComponent(search.trim())}&status=${customerStatus}`,
        );
      }
      return await apiRequest<PaginatedResponse<CustomerOut>>(
        `/api/v2/musteriler?page=${customerPage}&page_size=100&status=${customerStatus}`,
      );
    },
  });

  const detailQuery = useQuery({
    queryKey: ['customers', 'detail', selectedId],
    enabled: selectedId !== null,
    queryFn: () => apiRequest<CustomerDetailOut>(`/api/v2/musteriler/${selectedId}`),
  });

  const historyQuery = useQuery({
    queryKey: ['customers', 'history', selectedId],
    enabled: selectedId !== null,
    queryFn: () => apiRequest<PosDocumentListItem[]>(`/api/v2/musteriler/${selectedId}/history`),
  });

  const logWorkspaceQuery = useQuery({
    queryKey: ['customers', 'log-workspace-sidecar'],
    queryFn: () => apiRequest<LogWorkspace>('/api/v2/log/workspace'),
  });

  const expandedDetailQuery = useQuery({
    queryKey: ['customers', 'history-detail', expandedSequenceNo],
    enabled: expandedSequenceNo !== null,
    queryFn: () => apiRequest<PosDocumentDetail>(`/api/pos/documents/${expandedSequenceNo}`),
  });
  const previewDetailQuery = useQuery({
    queryKey: ['customers', 'preview-document', previewSequenceNo],
    enabled: previewSequenceNo !== null,
    queryFn: () => apiRequest<PosDocumentDetail>(`/api/pos/documents/${previewSequenceNo}`),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest<CustomerOut>('/api/v2/musteriler', {
        method: 'POST',
        body: JSON.stringify(cleanDraft(newDraft)),
      }),
    onSuccess: async (created) => {
      setSelectedCustomerId(created.id);
      setNewDraft(EMPTY_DRAFT);
      setShowNewRow(false);
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
    },
    onError: (error) => {
      toast.error('Müşteri oluşturulamadı', localizeApiError(error));
    },
  });

  const updateMutation = useMutation({
    mutationFn: (customerId: string) =>
      apiRequest<CustomerOut>(`/api/v2/musteriler/${customerId}`, {
        method: 'PUT',
        body: JSON.stringify(cleanDraft(editDraft)),
      }),
    onSuccess: async (_, customerId) => {
      setEditingId(null);
      setEditDraftStash((current) => (current?.customerId === customerId ? null : current));
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['customers', 'detail', customerId] });
    },
    onError: (error) => {
      toast.error('Müşteri güncellenemedi', localizeApiError(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (customerId: string) =>
      apiRequest(`/api/v2/musteriler/${customerId}`, {
        method: 'DELETE',
      }),
    onSuccess: async (_, customerId) => {
      if (selectedId === customerId) {
        setSelectedCustomerId(null);
      }
      if (editingId === customerId) {
        setEditingId(null);
      }
      setEditDraftStash((current) => (current?.customerId === customerId ? null : current));
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
    },
    onError: (error) => {
      toast.error('Müşteri pasife alınamadı', localizeApiError(error));
    },
  });

  // A6-3: pasife alınan kaydı geri açma (PUT is_active=true).
  const reactivateMutation = useMutation({
    mutationFn: (customerId: string) =>
      apiRequest<CustomerOut>(`/api/v2/musteriler/${customerId}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: true }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['customers', 'detail'] });
    },
    onError: (error) => {
      toast.error('Müşteri aktifleştirilemedi', localizeApiError(error));
    },
  });

  const customers = Array.isArray(customersQuery.data) ? customersQuery.data : customersQuery.data?.items || [];
  const totalCustomers = Array.isArray(customersQuery.data)
    ? customers.length
    : customersQuery.data?.total || 0;
  const customerPageSize = Array.isArray(customersQuery.data)
    ? Math.max(customers.length, 1)
    : customersQuery.data?.page_size || 100;
  const customerTotalPages = Array.isArray(customersQuery.data)
    ? 1
    : customersQuery.data?.total_pages || 1;
  const selectedCustomer = detailQuery.data || customers.find((item) => item.id === selectedId) || null;
  const historyItems = historyQuery.data || [];
  const historySummary = useMemo(
    () => ({
      count: historyItems.length,
      total: historyItems.reduce((sum, item) => sum + Number(item.gross_amount_dkk || 0), 0),
      lastDate: historyItems[0]?.issued_at || null,
    }),
    [historyItems],
  );

  const historyLogMeta = useMemo<Record<number, CustomerHistoryLogMeta>>(() => {
    const workspace = logWorkspaceQuery.data;
    if (!workspace) return {};

    const map: Record<number, CustomerHistoryLogMeta> = {};
    const ensure = (sequenceNo: number): CustomerHistoryLogMeta => {
      if (!map[sequenceNo]) {
        map[sequenceNo] = {
          inLog: true,
          splitCount: 0,
          smykkerCount: 0,
          smykkerGrams: 0,
          whiteGoldCount: 0,
          whiteGoldGrams: 0,
          separateStorageCount: 0,
          separateStorageGrams: 0,
        };
      }
      return map[sequenceNo];
    };

    for (const bucket of [workspace.gold, workspace.silver]) {
      for (const document of bucket.documents) {
        const entry = ensure(document.sequence_no);
        for (const line of document.lines) {
          const grams = Number(line.weight_grams || 0);
          switch (line.operation_classification) {
            case 'jewelry_cleaning':
              entry.smykkerCount += 1;
              entry.smykkerGrams += grams;
              entry.splitCount += 1;
              break;
            case 'white_gold':
              entry.whiteGoldCount += 1;
              entry.whiteGoldGrams += grams;
              entry.splitCount += 1;
              break;
            case 'separate_storage':
              entry.separateStorageCount += 1;
              entry.separateStorageGrams += grams;
              entry.splitCount += 1;
              break;
            default:
              break;
          }
        }
      }
    }

    return map;
  }, [logWorkspaceQuery.data]);

  return {
    search,
    onSearchChange: (value) => {
      setSearch(value);
      setCustomerPage(1);
    },
    customers,
    totalCustomers,
    customerPage,
    customerPageSize,
    customerTotalPages,
    onCustomerPageChange: (page) => {
      setCustomerPage(Math.max(1, Math.min(page, customerTotalPages)));
    },
    // A6-5: liste yüzeyi — iskelet + hata bandı + retry.
    customersLoading: customersQuery.isLoading,
    customersError: customersQuery.isError,
    onRetryCustomers: () => {
      void customersQuery.refetch();
    },
    customerStatus,
    onCustomerStatusChange: (nextStatus) => {
      setCustomerStatus(nextStatus);
      setCustomerPage(1);
    },
    selectedId,
    onSelectCustomer: (customerId) => {
      // R2-02 (M2 revizyonu): seçim yeni-müşteri formunu kapatır ama doldurulmuş
      // taslak (OCR verisi dahil) korunur — yeniden açılışta kaldığı yerden gelir.
      if (customerId) {
        setShowNewRow(false);
      }
      setSelectedCustomerId(customerId);
    },
    editingId,
    showNewRow,
    onToggleNewRow: () => {
      setShowNewRow((current) => {
        const next = !current;
        if (next) {
          // M2: açılış — düzenleme modundaysa yarım taslağı kaybedip silmek
          // yerine stash'e koy (aynı müşteride düzenlemeye dönüşte geri gelir).
          if (editingId) {
            setEditDraftStash({ customerId: editingId, draft: editDraft });
            setEditingId(null);
          }
          // R1-04: yeni-müşteri moduna geçerken seçili müşteri temizlenir —
          // "seçili + boş NY KUNDE formu aynı anda" durumu (R2-02) biter.
          setSelectedCustomerId(null);
        }
        // M2: kapanış artık newDraft'ı EMPTY_DRAFT'a sıfırlamaz — kimlik OCR
        // çıktısıyla dolu form X ile uyarısız kaybolmaz.
        return next;
      });
    },
    newDraft,
    onNewDraftChange: (field, value) => setNewDraft((current) => ({ ...current, [field]: value })),
    onSaveNew: () => createMutation.mutate(),
    isSavingNew: createMutation.isPending,
    editDraft,
    onEditDraftChange: (field, value) => setEditDraft((current) => ({ ...current, [field]: value })),
    onSaveEdit: (customerId) => updateMutation.mutate(customerId),
    isUpdatingCustomer: updateMutation.isPending,
    // M2: Vazgeç = taslağı at (stash dahil); yeniden düzenleme kayıttan kurulur.
    onCancelEdit: () => {
      setEditingId(null);
      setEditDraftStash(null);
    },
    onStartEdit: (customer) => {
      setEditingId(customer.id);
      setShowNewRow(false);
      // M2: "Yeni Müşteri" tarafından kesilmiş yarım düzenleme varsa onu geri yükle.
      if (editDraftStash?.customerId === customer.id) {
        setEditDraft(editDraftStash.draft);
        setEditDraftStash(null);
        return;
      }
      setEditDraft({
        name: customer.name || '',
        email: customer.email || '',
        phone: customer.phone || '',
        address: customer.address || '',
        postal_code: customer.postal_code || '',
        // FE CustomerOut tipi henüz city tanımlamıyor (types.ts düzeltmesi ayrı iş).
        city: (customer as CustomerOut & { city?: string | null }).city || '',
        cpr_number: customer.cpr_number || '',
        identity_doc_type: customer.identity_doc_type || '',
        identity_doc_number: customer.identity_doc_number || '',
        identity_doc_country: customer.identity_doc_country || 'DNK',
      });
    },
    // A6-6: deletingId yalnız ilgili satırı kilitler; diğer satırlar erişilebilir kalır.
    onDelete: (customer) => {
      setDeletingId(customer.id);
      deleteMutation.mutate(customer.id, {
        onSettled: () => {
          setDeletingId((current) => (current === customer.id ? null : current));
        },
      });
    },
    isDeletingCustomer: deleteMutation.isPending,
    deletingId,
    onReactivate: (customer) => {
      setReactivatingId(customer.id);
      reactivateMutation.mutate(customer.id, {
        onSettled: () => {
          setReactivatingId((current) => (current === customer.id ? null : current));
        },
      });
    },
    reactivatingId,
    selectedCustomer,
    historyItems,
    // A6-5: geçmiş / detay-satırı / preview için isError+refetch tabanlı ortak retry.
    isHistoryLoading: historyQuery.isLoading,
    isHistoryError: historyQuery.isError,
    onRetryDocumentQuery: (target: CustomerDocumentQueryTarget) => {
      if (target === 'history') {
        void historyQuery.refetch();
      } else if (target === 'expanded-detail') {
        void expandedDetailQuery.refetch();
      } else {
        void previewDetailQuery.refetch();
      }
    },
    historySummary,
    historyLogMeta,
    expandedSequenceNo,
    onToggleHistory: (sequenceNo) =>
      setExpandedSequenceNo((current) => (current === sequenceNo ? null : sequenceNo)),
    expandedDetail:
      expandedSequenceNo !== null && expandedDetailQuery.data?.sequence_no === expandedSequenceNo
        ? expandedDetailQuery.data
        : null,
    expandedDetailLoading: expandedSequenceNo !== null && expandedDetailQuery.isLoading,
    expandedDetailError: expandedSequenceNo !== null && expandedDetailQuery.isError,
    previewSequenceNo,
    previewDetail:
      previewSequenceNo !== null && previewDetailQuery.data?.sequence_no === previewSequenceNo
        ? previewDetailQuery.data
        : null,
    previewLoading: previewSequenceNo !== null && previewDetailQuery.isLoading,
    previewError: previewSequenceNo !== null && previewDetailQuery.isError,
    onPreviewOpen: setPreviewSequenceNo,
    onPreviewClose: () => setPreviewSequenceNo(null),
  };
}

export function customerSelectionRoute(customerId: string): string {
  return `/musteriler?customer=${encodeURIComponent(customerId)}`;
}
