import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api';

import type { GdprCopyTaskUpdatePayload } from './useGdprMakeState';
import type { GdprRequestDetail } from './types';

// Copy-task override/retry mutation'ı — Modern varyant props hattına yeni bir
// onUpdateCopyTask ekleyemeyiz (modern/pages/types.ts ve pages/GdprPage.tsx bu
// düzeltim paketinin sahipliği dışında), bu yüzden ModernGdprCockpitPage bu
// hook'u doğrudan kullanır. Classic varyant aynı ucun useGdprMakeState
// üzerinden sarılmış halini prop olarak alır; ikisi de aynı PATCH ucunu vurur:
// PATCH /api/v2/gdpr/requests/{request_id}/copy-tasks/{task_id}  body: {status, reason}
export function useGdprCopyTaskUpdate() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ requestId, taskId, status, reason }: GdprCopyTaskUpdatePayload) =>
      apiRequest<GdprRequestDetail>(`/api/v2/gdpr/requests/${requestId}/copy-tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, reason: reason || null }),
      }),
    onSuccess: async (detail) => {
      queryClient.setQueryData(['gdpr-request-detail', detail.id], detail);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['gdpr-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['gdpr-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['gdpr-request-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['gdpr-jobs'] }),
      ]);
    },
  });
  return mutation;
}
