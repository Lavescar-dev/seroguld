import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { ApiError, TransportError, apiRequest } from '@/lib/api';
import type { AntiFraudOrder } from '@/types';

export function useOpmcDetailMakeState() {
  const params = useParams();
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
  };
}
