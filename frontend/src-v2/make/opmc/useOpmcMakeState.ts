import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { TransportError, apiRequest } from '@/lib/api';
import type { AntiFraudOrdersResponse } from '@/types';
import { normalizeRiskLevel, type RiskFilter } from '@/components/OpmcShared';

export function useOpmcMakeState() {
  const [days, setDays] = useState(30);
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [manualOnly, setManualOnly] = useState<'all' | 'yes' | 'no'>('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const ordersQuery = useQuery({
    queryKey: ['antifraud', 'recent', days],
    queryFn: () =>
      apiRequest<AntiFraudOrdersResponse>(`/api/v2/opmc/orders?days=${days}&per_page=40&detail_mode=true`),
    retry: (failureCount, error) => error instanceof TransportError && failureCount < 2,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const hasData = Boolean(ordersQuery.data);
  const errorKind: 'transport' | 'upstream' | null = !ordersQuery.isError
    ? null
    : ordersQuery.error instanceof TransportError
      ? 'transport'
      : 'upstream';
  const errorMessage =
    errorKind === 'transport'
      ? 'Yerel backend bağlantısı kurulamadı.'
      : ordersQuery.error instanceof Error
        ? ordersQuery.error.message
        : 'OPMC verisi alınamadı.';

  const filteredOrders = useMemo(
    () =>
      (ordersQuery.data?.items || []).filter((item) => {
        if (riskFilter !== 'all' && normalizeRiskLevel(item.risk_level) !== riskFilter) return false;
        if (manualOnly === 'yes' && !item.requires_manual_review) return false;
        if (manualOnly === 'no' && item.requires_manual_review) return false;
        if (statusFilter !== 'all' && (item.status || '').toLowerCase() !== statusFilter) return false;
        return true;
      }),
    [manualOnly, ordersQuery.data?.items, riskFilter, statusFilter],
  );

  const quickReviewOrders = useMemo(
    () => (ordersQuery.data?.items || []).filter((item) => item.requires_manual_review),
    [ordersQuery.data?.items],
  );

  return {
    days,
    riskFilter,
    manualOnly,
    statusFilter,
    source: ordersQuery.data?.source ?? null,
    hasData,
    errorKind,
    filteredOrders,
    quickReviewOrders,
    summary: ordersQuery.data?.summary,
    generatedAt: ordersQuery.data?.generated_at ?? null,
    isLoading: ordersQuery.isLoading,
    isFetching: ordersQuery.isFetching,
    isError: ordersQuery.isError,
    errorMessage,
    onRefresh: () => {
      void ordersQuery.refetch();
    },
    onDaysChange: (value: number) => setDays(value || 30),
    onRiskFilterChange: (value: RiskFilter) => setRiskFilter(value),
    onManualOnlyChange: (value: 'all' | 'yes' | 'no') => setManualOnly(value),
    onStatusFilterChange: (value: string) => setStatusFilter(value),
  };
}
