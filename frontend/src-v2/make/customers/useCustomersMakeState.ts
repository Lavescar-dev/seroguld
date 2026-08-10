import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { apiRequest } from '@/lib/api';
import type { CustomerDetailOut, CustomerOut, LogWorkspace, PaginatedResponse, PosDocumentDetail, PosDocumentListItem } from '@/types';

import { EMPTY_DRAFT, type CustomerDraft, type CustomerHistoryLogMeta, type CustomersPageProps } from './types';

function cleanDraft(draft: CustomerDraft) {
  return {
    name: draft.name.trim(),
    email: draft.email.trim() || undefined,
    phone: draft.phone.trim() || undefined,
    address: draft.address.trim() || undefined,
    postal_code: draft.postal_code.trim() || undefined,
    cpr_number: draft.cpr_number.trim() || undefined,
    identity_doc_type: draft.identity_doc_type || undefined,
    identity_doc_number: draft.identity_doc_number.trim() || undefined,
    identity_doc_country: draft.identity_doc_country.trim() || undefined,
  };
}

export function useCustomersMakeState(): CustomersPageProps {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [customerPage, setCustomerPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('customer'));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedSequenceNo, setExpandedSequenceNo] = useState<number | null>(null);
  const [previewSequenceNo, setPreviewSequenceNo] = useState<number | null>(null);
  const [showNewRow, setShowNewRow] = useState(false);
  const [newDraft, setNewDraft] = useState<CustomerDraft>(EMPTY_DRAFT);
  const [editDraft, setEditDraft] = useState<CustomerDraft>(EMPTY_DRAFT);

  useEffect(() => {
    const customerId = searchParams.get('customer');
    if (customerId === selectedId) return;
    setSelectedId(customerId);
  }, [searchParams, selectedId]);

  function setSelectedCustomerId(customerId: string | null) {
    setSelectedId(customerId);
    const nextParams = new URLSearchParams(searchParams);
    if (customerId) {
      nextParams.set('customer', customerId);
    } else {
      nextParams.delete('customer');
    }
    setSearchParams(nextParams, { replace: true });
  }

  const customersQuery = useQuery({
    queryKey: ['customers', search, customerPage],
    queryFn: async () => {
      if (search.trim().length >= 2) {
        return await apiRequest<CustomerOut[]>(`/api/v2/musteriler/search?q=${encodeURIComponent(search.trim())}`);
      }
      return await apiRequest<PaginatedResponse<CustomerOut>>(
        `/api/v2/musteriler?page=${customerPage}&page_size=100`,
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
  });

  const updateMutation = useMutation({
    mutationFn: (customerId: string) =>
      apiRequest<CustomerOut>(`/api/v2/musteriler/${customerId}`, {
        method: 'PUT',
        body: JSON.stringify(cleanDraft(editDraft)),
      }),
    onSuccess: async (_, customerId) => {
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['customers', 'detail', customerId] });
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
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
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
    selectedId,
    onSelectCustomer: (customerId) => setSelectedCustomerId(customerId),
    editingId,
    showNewRow,
    onToggleNewRow: () => {
      setEditingId(null);
      setShowNewRow((current) => {
        const next = !current;
        if (!next) {
          setNewDraft(EMPTY_DRAFT);
        }
        return next;
      });
    },
    newDraft,
    onNewDraftChange: (field, value) => setNewDraft((current) => ({ ...current, [field]: value })),
    onSaveNew: () => createMutation.mutate(),
    editDraft,
    onEditDraftChange: (field, value) => setEditDraft((current) => ({ ...current, [field]: value })),
    onSaveEdit: (customerId) => updateMutation.mutate(customerId),
    onCancelEdit: () => setEditingId(null),
    onStartEdit: (customer) => {
      setEditingId(customer.id);
      setShowNewRow(false);
      setEditDraft({
        name: customer.name || '',
        email: customer.email || '',
        phone: customer.phone || '',
        address: customer.address || '',
        postal_code: customer.postal_code || '',
        cpr_number: customer.cpr_number || '',
        identity_doc_type: customer.identity_doc_type || '',
        identity_doc_number: customer.identity_doc_number || '',
        identity_doc_country: customer.identity_doc_country || 'DK',
      });
    },
    onDelete: (customer) => deleteMutation.mutate(customer.id),
    selectedCustomer,
    historyItems,
    historySummary,
    historyLogMeta,
    expandedSequenceNo,
    onToggleHistory: (sequenceNo) =>
      setExpandedSequenceNo((current) => (current === sequenceNo ? null : sequenceNo)),
    expandedDetail:
      expandedSequenceNo !== null && expandedDetailQuery.data?.sequence_no === expandedSequenceNo
        ? expandedDetailQuery.data
        : null,
    previewSequenceNo,
    previewDetail:
      previewSequenceNo !== null && previewDetailQuery.data?.sequence_no === previewSequenceNo
        ? previewDetailQuery.data
        : null,
    previewLoading: previewSequenceNo !== null && previewDetailQuery.isLoading,
    onPreviewOpen: setPreviewSequenceNo,
    onPreviewClose: () => setPreviewSequenceNo(null),
  };
}
