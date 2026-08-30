import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api';

import type { GdprPublicRequestCreateOut } from './types';

export type GdprCreateRequestPayload = {
  request_type: string;
  subject_name: string;
  subject_email?: string;
  subject_phone?: string;
  message?: string;
};

// Admin kokpitindeki "Yeni talep" aksiyonu için ayrı mutation hook'u —
// useGdprMakeState'in ikinci bir instance'ını kurmadan react-query cache'ini
// paylaşır. Backend'de admin POST /api/v2/gdpr/requests ucu yoktur; tek talep
// oluşturma yolu public request endpoint'idir ve talep channel="public_page",
// status="identity_pending" olarak açılır.
export function useGdprCreateRequest() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (payload: GdprCreateRequestPayload) =>
      apiRequest<GdprPublicRequestCreateOut>('/api/v2/public/gdpr/request', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ ...payload, accepted_privacy: true }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['gdpr-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['gdpr-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['gdpr-jobs'] }),
      ]);
    },
  });
  return mutation;
}
