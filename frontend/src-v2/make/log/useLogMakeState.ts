import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api';
import { emitArtifactSync, listenArtifactSync } from '@/lib/artifactSync';
import type { AfgWorkspaceLine, LogMeltLot, LogWorkspace, OfficeRuntimeStatus } from '@/types';

import type { LogPageProps } from './LogPage';
import {
  defaultClassification,
  defaultDestination,
  toLotDraft,
  type LineDraft,
  type LogActiveTab,
  type LogSurfaceView,
  type MeltLotDraft,
} from './types';

function buildLineDraft(line: AfgWorkspaceLine): LineDraft {
  return {
    classification: defaultClassification(line),
    note: line.product_notes || '',
    destination: defaultDestination(line),
  };
}

function flattenBucketLines(workspace: LogWorkspace | undefined, activeTab: LogActiveTab): AfgWorkspaceLine[] {
  const bucket = activeTab === 'silver' ? workspace?.silver : workspace?.gold;
  return bucket?.documents.flatMap((document) => document.lines) ?? [];
}

function hasPendingLineChange(line: AfgWorkspaceLine, draft: LineDraft | undefined) {
  if (!draft) return false;
  return (
    draft.classification !== defaultClassification(line) ||
    draft.destination !== defaultDestination(line) ||
    draft.note.trim() !== (line.product_notes || '').trim()
  );
}

export function useLogMakeState(): LogPageProps {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<LogActiveTab>('gold');
  const [activeView, setActiveView] = useState<LogSurfaceView>('system');
  const [expandedDocument, setExpandedDocument] = useState<number | null>(null);
  const [showMeltSection, setShowMeltSection] = useState(false);
  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>({});
  const [lotDrafts, setLotDrafts] = useState<Record<string, MeltLotDraft>>({});

  useEffect(() => {
    void queryClient.prefetchQuery({
      queryKey: ['office-runtime-status', 'log'],
      queryFn: () => apiRequest<OfficeRuntimeStatus>('/api/v2/office-runtime/status?kind=log'),
      staleTime: 30_000,
    });
  }, [queryClient]);

  const workspaceQuery = useQuery({
    queryKey: ['log', 'workspace', query],
    queryFn: () =>
      apiRequest<LogWorkspace>(`/api/v2/log/workspace${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['log'] });
  }, [activeView, queryClient]);

  useEffect(() => {
    return listenArtifactSync((signal) => {
      if (signal.kind !== 'log' || signal.source === 'log-ui') return;
      void queryClient.invalidateQueries({ queryKey: ['log'] });
    });
  }, [queryClient]);

  const bucket = activeTab === 'silver' ? workspaceQuery.data?.silver : workspaceQuery.data?.gold;
  const documents = bucket?.documents ?? [];
  const activeLines = useMemo(() => flattenBucketLines(workspaceQuery.data, activeTab), [workspaceQuery.data, activeTab]);

  useEffect(() => {
    if (!expandedDocument && documents[0]) {
      setExpandedDocument(documents[0].sequence_no);
    }
    if (expandedDocument && !documents.some((document) => document.sequence_no === expandedDocument)) {
      setExpandedDocument(documents[0]?.sequence_no ?? null);
    }
  }, [documents, expandedDocument]);

  useEffect(() => {
    const seeded: Record<string, LineDraft> = {};
    for (const line of activeLines) {
      if (!lineDrafts[line.id]) {
        seeded[line.id] = buildLineDraft(line);
      }
    }
    if (Object.keys(seeded).length > 0) {
      setLineDrafts((current) => ({ ...seeded, ...current }));
    }
  }, [activeLines, lineDrafts]);

  useEffect(() => {
    const seeded: Record<string, MeltLotDraft> = {};
    for (const lot of bucket?.melt_lots ?? []) {
      if (!lotDrafts[lot.id]) {
        seeded[lot.id] = toLotDraft(lot);
      }
    }
    if (Object.keys(seeded).length > 0) {
      setLotDrafts((current) => ({ ...seeded, ...current }));
    }
  }, [bucket?.melt_lots, lotDrafts]);

  const pendingRouteChanges = useMemo(
    () =>
      activeLines
        .map((line) => ({ line, draft: lineDrafts[line.id] || buildLineDraft(line) }))
        .filter(({ line, draft }) => hasPendingLineChange(line, draft)),
    [activeLines, lineDrafts],
  );

  const pendingRouteSummary = useMemo(
    () =>
      pendingRouteChanges.reduce(
        (sum, item) => ({
          count: sum.count + 1,
          weight: sum.weight + Number(item.line.weight_grams || 0),
          amount: sum.amount + Number(item.line.line_total_dkk || 0),
          pure: sum.pure + Number(item.line.pure_gold_grams || 0),
        }),
        { count: 0, weight: 0, amount: 0, pure: 0 },
      ),
    [pendingRouteChanges],
  );

  const applyRouteReviewMutation = useMutation({
    mutationFn: async (items: Array<{ line: AfgWorkspaceLine; draft: LineDraft }>) =>
      apiRequest<LogWorkspace>('/api/v2/log/routes/batch-apply', {
        method: 'POST',
        body: JSON.stringify({
          line_decisions: items.map(({ line, draft }) => ({
            line_id: line.id,
            destination: draft.destination,
            classification: draft.classification,
            note: draft.note.trim() || null,
          })),
        }),
      }),
    onSuccess: async (workspace) => {
      const refreshedLines = flattenBucketLines(workspace, activeTab);
      setLineDrafts((current) => {
        const next = { ...current };
        for (const line of refreshedLines) {
          delete next[line.id];
        }
        return next;
      });
      queryClient.setQueryData(['log', 'workspace', query], workspace);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['log'] }),
        queryClient.invalidateQueries({ queryKey: ['depolama'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ]);
      emitArtifactSync({ kind: 'log', key: String(new Date().getFullYear()), source: 'log-ui' });
    },
  });

  const createMeltLotMutation = useMutation({
    mutationFn: async () =>
      apiRequest<LogMeltLot>('/api/v2/log/melt-lots', {
        method: 'POST',
        body: JSON.stringify({ metal_bucket: activeTab }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['log'] });
      emitArtifactSync({ kind: 'log', key: String(new Date().getFullYear()), source: 'log-ui' });
      setShowMeltSection(true);
    },
  });

  const updateMeltLotMutation = useMutation({
    mutationFn: async (payload: { lotId: string; draft: MeltLotDraft }) =>
      apiRequest<LogMeltLot>(`/api/v2/log/melt-lots/${payload.lotId}`, {
        method: 'PUT',
        body: JSON.stringify({
          sent_date: payload.draft.sent_date || null,
          purchased_from_date: payload.draft.purchased_from_date || null,
          after_pure_gold_grams: payload.draft.after_pure_gold_grams || null,
          insurance_dkk: payload.draft.insurance_dkk || null,
          shipping_dkk: payload.draft.shipping_dkk || null,
          refining_dkk: payload.draft.refining_dkk || null,
          sale_date: payload.draft.sale_date || null,
          quote_eur: payload.draft.quote_eur || null,
          exchange_rate_dkk: payload.draft.exchange_rate_dkk || null,
          payout_total_dkk: payload.draft.payout_total_dkk || null,
          notes: payload.draft.notes.trim() || null,
        }),
      }),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['log'] });
      emitArtifactSync({ kind: 'log', key: String(new Date().getFullYear()), source: 'log-ui' });
      setLotDrafts((current) => ({
        ...current,
        [variables.lotId]: current[variables.lotId],
      }));
    },
  });

  return {
    workspace: workspaceQuery.data,
    isLoading: workspaceQuery.isLoading,
    isError: workspaceQuery.isError,
    activeView,
    onActiveViewChange: (nextView) => {
      if (pendingRouteSummary.count > 0 && nextView !== 'system') return;
      setActiveView(nextView);
    },
    activeTab,
    onActiveTabChange: (nextTab) => {
      if (nextTab === activeTab) return;
      if (pendingRouteSummary.count > 0) return;
      setActiveTab(nextTab);
      setExpandedDocument(null);
    },
    query,
    onQueryChange: setQuery,
    expandedDocument,
    onToggleDocument: (sequenceNo) => setExpandedDocument(sequenceNo),
    showMeltSection,
    onToggleMeltSection: () => setShowMeltSection((current) => !current),
    lineDrafts,
    onDraftChange: (lineId, patch) =>
      setLineDrafts((current) => ({
        ...current,
        [lineId]: {
          ...(current[lineId] ||
            (() => {
              const line = activeLines.find((candidate) => candidate.id === lineId);
              return line ? buildLineDraft(line) : { classification: 'standard', note: '', destination: 'undecided' };
            })()),
          ...patch,
        },
      })),
    lotDrafts,
    onLotDraftChange: (lotId, patch) =>
      setLotDrafts((current) => ({
        ...current,
        [lotId]: { ...(current[lotId] || toLotDraft(bucket?.melt_lots.find((lot) => lot.id === lotId) as LogMeltLot)), ...patch },
      })),
    routeBusy: applyRouteReviewMutation.isPending,
    meltBusy: updateMeltLotMutation.isPending,
    createMeltBusy: createMeltLotMutation.isPending,
    pendingRouteCount: pendingRouteSummary.count,
    pendingRouteSummary,
    onDiscardRouteReview: () =>
      setLineDrafts((current) => {
        const next = { ...current };
        for (const line of activeLines) {
          next[line.id] = buildLineDraft(line);
        }
        return next;
      }),
    onApplyRouteReview: () => {
      if (pendingRouteChanges.length === 0) return;
      applyRouteReviewMutation.mutate(pendingRouteChanges);
    },
    onRoute: (line, destination) =>
      setLineDrafts((current) => ({
        ...current,
        [line.id]: { ...(current[line.id] || buildLineDraft(line)), destination },
      })),
    onSaveLot: (lotId) => {
      const fallback = bucket?.melt_lots.find((lot) => lot.id === lotId);
      if (!fallback) return;
      const draft = lotDrafts[lotId] || toLotDraft(fallback);
      updateMeltLotMutation.mutate({ lotId, draft });
    },
    onCreateMeltLot: () => createMeltLotMutation.mutate(),
  };
}
