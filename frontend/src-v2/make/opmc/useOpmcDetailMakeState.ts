import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { ApiError, TransportError, apiRequest } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { AntiFraudOrder } from '@/types';

export function useOpmcDetailMakeState() {
  const params = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const orderId = Number(params.id);
  const hasValidOrderId = Number.isFinite(orderId) && orderId > 0;

  const detailQuery = useQuery({
    queryKey: ['opmc', 'detail-page', orderId],
    enabled: hasValidOrderId,
    queryFn: () => apiRequest<AntiFraudOrder>(`/api/v2/opmc/orders/${orderId}`),
    retry: (failureCount, error) => error instanceof TransportError && failureCount < 2,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const overrideMutation = useMutation({
    mutationFn: (payload: { level: 'low' | 'medium' | 'high'; reason?: string }) =>
      apiRequest<AntiFraudOrder>(`/api/v2/opmc/orders/${orderId}/override`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['opmc', 'detail-page', orderId], data);
      void queryClient.invalidateQueries({ queryKey: ['opmc'] });
      toast.success('Risk seviyesi güncellendi', `Yeni seviye: ${data.risk_level}`);
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : 'Override hatası';
      toast.error('Override yapılamadı', msg);
    },
  });

  const hasData = Boolean(detailQuery.data);
  const errorKind: 'transport' | 'upstream' | 'not_found' | null =
    !hasValidOrderId || (detailQuery.error instanceof ApiError && detailQuery.error.status === 404)
      ? 'not_found'
      : detailQuery.error instanceof TransportError
        ? 'transport'
        : detailQuery.isError
          ? 'upstream'
          : null;
  const isNotFound = errorKind === 'not_found';
  const isError = errorKind === 'transport' || errorKind === 'upstream';
  const errorMessage =
    errorKind === 'transport'
      ? 'Yerel backend bağlantısı kurulamadı.'
      : detailQuery.error instanceof Error
        ? detailQuery.error.message
        : 'OPMC detay verisi alınamadı.';

  return {
    requestedId: params.id ?? '',
    detail: detailQuery.data ?? null,
    hasData,
    errorKind,
    isLoading: detailQuery.isLoading,
    isFetching: detailQuery.isFetching,
    isError,
    isNotFound,
    errorMessage,
    onRefresh: () => {
      void detailQuery.refetch();
    },
    onOverride: (level: 'low' | 'medium' | 'high', reason?: string) =>
      overrideMutation.mutate({ level, reason }),
    overriding: overrideMutation.isPending,
  };
}
