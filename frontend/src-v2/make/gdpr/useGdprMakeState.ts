import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { apiRequest } from '@/lib/api';

import type {
  GdprJob,
  GdprOverview,
  GdprPublicBridgeConfig,
  GdprProcessor,
  GdprPublicSiteConfig,
  GdprRequestDetail,
  GdprRequestListItem,
  GdprRetentionPolicy,
} from './types';

type DecisionPayload = { requestId: string; reason?: string };
type VerifyPayload = { requestId: string; customerId: string };
type RetentionPayload = {
  policyKey: string;
  title?: string;
  description?: string;
  action?: string;
  retention_days?: number;
  is_enabled?: boolean;
};

export function useGdprMakeState() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const customerFilter = searchParams.get('customer');
  const statusFilter = searchParams.get('status') || 'all';
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ['gdpr-overview'],
    queryFn: () => apiRequest<GdprOverview>('/api/v2/gdpr/overview'),
  });
  const requestsQuery = useQuery({
    queryKey: ['gdpr-requests', statusFilter, customerFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (customerFilter) params.set('customer_id', customerFilter);
      const suffix = params.toString();
      return apiRequest<GdprRequestListItem[]>(`/api/v2/gdpr/requests${suffix ? `?${suffix}` : ''}`);
    },
  });
  const policiesQuery = useQuery({
    queryKey: ['gdpr-policies'],
    queryFn: () => apiRequest<GdprRetentionPolicy[]>('/api/v2/gdpr/retention-policies'),
  });
  const processorsQuery = useQuery({
    queryKey: ['gdpr-processors'],
    queryFn: () => apiRequest<GdprProcessor[]>('/api/v2/gdpr/processors'),
  });
  const jobsQuery = useQuery({
    queryKey: ['gdpr-jobs'],
    queryFn: () => apiRequest<GdprJob[]>('/api/v2/gdpr/jobs'),
  });
  const publicConfigQuery = useQuery({
    queryKey: ['gdpr-public-site-config-admin'],
    queryFn: () => apiRequest<GdprPublicSiteConfig>('/api/v2/public/gdpr/site-config', { auth: false }),
  });
  const bridgeConfigQuery = useQuery({
    queryKey: ['gdpr-public-bridge-config-admin'],
    queryFn: () => apiRequest<GdprPublicBridgeConfig>('/api/v2/public/gdpr/bridge-config', { auth: false }),
  });

  useEffect(() => {
    if (!requestsQuery.data?.length) {
      setSelectedRequestId(null);
      return;
    }
    if (!selectedRequestId || !requestsQuery.data.some((item) => item.id === selectedRequestId)) {
      setSelectedRequestId(requestsQuery.data[0].id);
    }
  }, [requestsQuery.data, selectedRequestId]);

  const detailQuery = useQuery({
    queryKey: ['gdpr-request-detail', selectedRequestId],
    queryFn: () => apiRequest<GdprRequestDetail>(`/api/v2/gdpr/requests/${selectedRequestId}`),
    enabled: Boolean(selectedRequestId),
  });

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['gdpr-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['gdpr-requests'] }),
      queryClient.invalidateQueries({ queryKey: ['gdpr-request-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['gdpr-processors'] }),
      queryClient.invalidateQueries({ queryKey: ['gdpr-policies'] }),
      queryClient.invalidateQueries({ queryKey: ['gdpr-jobs'] }),
    ]);
  };

  const verifyMutation = useMutation({
    mutationFn: ({ requestId, customerId }: VerifyPayload) =>
      apiRequest<GdprRequestDetail>(`/api/v2/gdpr/requests/${requestId}/verify`, {
        method: 'POST',
        body: JSON.stringify({ customer_id: customerId }),
      }),
    onSuccess: async (detail) => {
      queryClient.setQueryData(['gdpr-request-detail', detail.id], detail);
      await invalidateAll();
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({ requestId, reason }: DecisionPayload) =>
      apiRequest<GdprRequestDetail>(`/api/v2/gdpr/requests/${requestId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || null }),
      }),
    onSuccess: async (detail) => {
      queryClient.setQueryData(['gdpr-request-detail', detail.id], detail);
      await invalidateAll();
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ requestId, reason }: DecisionPayload) =>
      apiRequest<GdprRequestDetail>(`/api/v2/gdpr/requests/${requestId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || null }),
      }),
    onSuccess: async (detail) => {
      queryClient.setQueryData(['gdpr-request-detail', detail.id], detail);
      await invalidateAll();
    },
  });

  const executeMutation = useMutation({
    mutationFn: (requestId: string) =>
      apiRequest<GdprRequestDetail>(`/api/v2/gdpr/requests/${requestId}/execute`, {
        method: 'POST',
      }),
    onSuccess: async (detail) => {
      queryClient.setQueryData(['gdpr-request-detail', detail.id], detail);
      await invalidateAll();
    },
  });
  const enqueueMutation = useMutation({
    mutationFn: (requestId: string) =>
      apiRequest<GdprRequestDetail>(`/api/v2/gdpr/requests/${requestId}/enqueue`, {
        method: 'POST',
      }),
    onSuccess: async (detail) => {
      queryClient.setQueryData(['gdpr-request-detail', detail.id], detail);
      await invalidateAll();
    },
  });

  const updatePolicyMutation = useMutation({
    mutationFn: ({ policyKey, ...payload }: RetentionPayload) =>
      apiRequest<GdprRetentionPolicy>(`/api/v2/gdpr/retention-policies/${policyKey}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      await invalidateAll();
    },
  });

  const selectedRequest = useMemo(
    () => requestsQuery.data?.find((item) => item.id === selectedRequestId) || null,
    [requestsQuery.data, selectedRequestId],
  );

  const setStatusFilter = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (!next || next === 'all') params.delete('status');
    else params.set('status', next);
    setSearchParams(params, { replace: true });
  };

  const clearCustomerFilter = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('customer');
    setSearchParams(params, { replace: true });
  };

  return {
    overview: overviewQuery.data || null,
    requests: requestsQuery.data || [],
    selectedRequest,
    selectedRequestId,
    setSelectedRequestId,
    requestDetail: detailQuery.data && detailQuery.data.id === selectedRequestId ? detailQuery.data : null,
    retentionPolicies: policiesQuery.data || [],
    processors: processorsQuery.data || [],
    jobs: jobsQuery.data || [],
    publicConfig: publicConfigQuery.data || null,
    bridgeConfig: bridgeConfigQuery.data || null,
    statusFilter,
    customerFilter,
    setStatusFilter,
    clearCustomerFilter,
    isLoading:
      overviewQuery.isLoading ||
      requestsQuery.isLoading ||
      policiesQuery.isLoading ||
      processorsQuery.isLoading ||
      jobsQuery.isLoading ||
      bridgeConfigQuery.isLoading,
    isRefreshing:
      overviewQuery.isFetching ||
      requestsQuery.isFetching ||
      policiesQuery.isFetching ||
      processorsQuery.isFetching ||
      jobsQuery.isFetching ||
      bridgeConfigQuery.isFetching ||
      detailQuery.isFetching,
    activeMutation:
      verifyMutation.isPending ||
      approveMutation.isPending ||
      rejectMutation.isPending ||
      executeMutation.isPending ||
      enqueueMutation.isPending ||
      updatePolicyMutation.isPending,
    onRefresh: invalidateAll,
    onVerify: (requestId: string, customerId: string) => verifyMutation.mutateAsync({ requestId, customerId }),
    onApprove: (requestId: string, reason?: string) => approveMutation.mutateAsync({ requestId, reason }),
    onReject: (requestId: string, reason?: string) => rejectMutation.mutateAsync({ requestId, reason }),
    onEnqueue: (requestId: string) => enqueueMutation.mutateAsync(requestId),
    onExecute: (requestId: string) => executeMutation.mutateAsync(requestId),
    onUpdatePolicy: (payload: RetentionPayload) => updatePolicyMutation.mutateAsync(payload),
  };
}
