import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest, downloadAuthedDocument } from '@/lib/api';
import { emitArtifactSync, listenArtifactSync, signalMatches } from '@/lib/artifactSync';
import { useToast } from '@/lib/toast';
import { useConfirm } from '@/components/ConfirmDialog';
import type {
  AfgWorkspaceLine,
  LogMeltLot,
  LogMeltLotHistory,
  LogMeltLotLine,
  LogRouteBatchApplyResponse,
  LogWorkspace,
  OfficeRuntimeStatus,
} from '@/types';

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

function extractApiMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed === 'object') {
        if (parsed.detail && typeof parsed.detail === 'object' && parsed.detail.message) {
          return String(parsed.detail.message);
        }
        if (typeof parsed.detail === 'string') return parsed.detail;
      }
    } catch {
      // ignore parse failure
    }
    return error.message || fallback;
  }
  return fallback;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    typeof document !== 'undefined' ? !document.hidden : true,
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handler = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);
  return visible;
}

export function useLogMakeState(): LogPageProps {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const [activeTab, setActiveTab] = useState<LogActiveTab>('gold');
  const [activeView, setActiveView] = useState<LogSurfaceView>('system');
  const [expandedDocument, setExpandedDocument] = useState<number | null>(null);
  const [showMeltSection, setShowMeltSection] = useState(false);
  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>({});
  const [lotDrafts, setLotDrafts] = useState<Record<string, MeltLotDraft>>({});
  const [selectedYear, setSelectedYear] = useState<number>(() => new Date().getFullYear());
  const [historyLotId, setHistoryLotId] = useState<string | null>(null);
  const [linesLotId, setLinesLotId] = useState<string | null>(null);

  const visible = useDocumentVisible();

  useEffect(() => {
    void queryClient.prefetchQuery({
      queryKey: ['office-runtime-status', 'log'],
      queryFn: () => apiRequest<OfficeRuntimeStatus>('/api/v2/office-runtime/status?kind=log'),
      staleTime: 30_000,
    });
  }, [queryClient]);

  const workspaceQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
    if (selectedYear) params.set('year', String(selectedYear));
    return params.toString();
  }, [debouncedQuery, selectedYear]);

  // L3 — Polling visibility-aware: Excel view'da veya tab gizliyken durdur
  const pollEnabled = visible && activeView === 'system';

  const workspaceQuery = useQuery({
    queryKey: ['log', 'workspace', workspaceQueryString],
    queryFn: () =>
      apiRequest<LogWorkspace>(`/api/v2/log/workspace${workspaceQueryString ? `?${workspaceQueryString}` : ''}`),
    refetchInterval: pollEnabled ? 5_000 : false,
    refetchOnWindowFocus: true,
  });

  const bucket = activeTab === 'silver' ? workspaceQuery.data?.silver : workspaceQuery.data?.gold;
  const documents = bucket?.documents ?? [];
  const activeLines = useMemo(() => flattenBucketLines(workspaceQuery.data, activeTab), [workspaceQuery.data, activeTab]);

  // L16 — re-seed loop fix: drafts ref'i kullan, sadece active line ID setine bağlı
  const lineDraftsRef = useRef(lineDrafts);
  useEffect(() => {
    lineDraftsRef.current = lineDrafts;
  }, [lineDrafts]);

  const activeLineIdsKey = useMemo(
    () => activeLines.map((line) => line.id).join('|'),
    [activeLines],
  );

  useEffect(() => {
    const current = lineDraftsRef.current;
    const seeded: Record<string, LineDraft> = {};
    for (const line of activeLines) {
      if (!current[line.id]) {
        seeded[line.id] = buildLineDraft(line);
      }
    }
    if (Object.keys(seeded).length > 0) {
      setLineDrafts((prev) => ({ ...seeded, ...prev }));
    }
    // sadece line ID seti veya tab değişince yeniden seed et
  }, [activeLineIdsKey, activeLines]);

  useEffect(() => {
    if (!expandedDocument && documents[0]) {
      setExpandedDocument(documents[0].sequence_no);
      return;
    }
    if (expandedDocument && !documents.some((document) => document.sequence_no === expandedDocument)) {
      setExpandedDocument(documents[0]?.sequence_no ?? null);
    }
  }, [documents, expandedDocument]);

  const lotDraftsRef = useRef(lotDrafts);
  useEffect(() => {
    lotDraftsRef.current = lotDrafts;
  }, [lotDrafts]);

  const bucketLotsKey = useMemo(
    () => (bucket?.melt_lots ?? []).map((lot) => `${lot.id}:${lot.updated_at}`).join('|'),
    [bucket?.melt_lots],
  );

  useEffect(() => {
    const current = lotDraftsRef.current;
    const seeded: Record<string, MeltLotDraft> = {};
    for (const lot of bucket?.melt_lots ?? []) {
      if (!current[lot.id]) {
        seeded[lot.id] = toLotDraft(lot);
      }
    }
    if (Object.keys(seeded).length > 0) {
      setLotDrafts((prev) => ({ ...seeded, ...prev }));
    }
  }, [bucketLotsKey, bucket?.melt_lots]);

  useEffect(() => {
    return listenArtifactSync((signal) => {
      if (signal.source === 'log-ui') return;
      // Hem direkt log sinyali hem alış/depolama'dan tetiklenen cross-module sinyali yakala
      if (!signalMatches(signal, 'log')) return;
      void queryClient.invalidateQueries({ queryKey: ['log'] });
    });
  }, [queryClient]);

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

  // L18 — batch invalidate helper
  const invalidateLog = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['log'] }),
      queryClient.invalidateQueries({ queryKey: ['depolama'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
    ]);
  }, [queryClient]);

  const applyRouteReviewMutation = useMutation({
    mutationFn: async (items: Array<{ line: AfgWorkspaceLine; draft: LineDraft }>) =>
      apiRequest<LogRouteBatchApplyResponse>('/api/v2/log/routes/batch-apply', {
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
    onSuccess: async (response) => {
      const refreshedLines = flattenBucketLines(response.workspace, activeTab);
      setLineDrafts((current) => {
        const next = { ...current };
        for (const line of refreshedLines) {
          delete next[line.id];
        }
        return next;
      });
      queryClient.setQueryData(['log', 'workspace', workspaceQueryString], response.workspace);
      await invalidateLog();
      emitArtifactSync({ kind: 'log', key: String(selectedYear), source: 'log-ui' });
      if (response.failed > 0) {
        toast.warning(
          `${response.succeeded} satır başarılı, ${response.failed} satır hatalı`,
          response.failures.slice(0, 3).map((f) => f.error).join(' · '),
        );
      } else {
        toast.success(`${response.succeeded} satır rotalandı`);
      }
    },
    onError: (error) => {
      toast.error('Rota uygulanamadı', extractApiMessage(error, 'Sunucu hatası'));
    },
  });

  const createMeltLotMutation = useMutation({
    mutationFn: async () =>
      apiRequest<LogMeltLot>('/api/v2/log/melt-lots', {
        method: 'POST',
        body: JSON.stringify({ metal_bucket: activeTab }),
      }),
    onSuccess: async (lot) => {
      await invalidateLog();
      emitArtifactSync({ kind: 'log', key: String(selectedYear), source: 'log-ui' });
      setShowMeltSection(true);
      toast.success('Yeni eritme lotu oluşturuldu', lot.id ? `Lot #${lot.id.slice(0, 8)}` : undefined);
    },
    onError: (error) => {
      toast.error('Lot oluşturulamadı', extractApiMessage(error, 'Sunucu hatası'));
    },
  });

  const updateMeltLotMutation = useMutation({
    mutationFn: async (payload: { lotId: string; draft: MeltLotDraft; expectedUpdatedAt?: string }) =>
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
          expected_updated_at: payload.expectedUpdatedAt || null,
        }),
      }),
    onSuccess: async (_, variables) => {
      await invalidateLog();
      emitArtifactSync({ kind: 'log', key: String(selectedYear), source: 'log-ui' });
      setLotDrafts((current) => ({
        ...current,
        [variables.lotId]: current[variables.lotId],
      }));
      toast.success('Lot kaydedildi');
    },
    onError: (error) => {
      const msg = extractApiMessage(error, 'Sunucu hatası');
      if (msg.includes('stale_lot') || msg.toLowerCase().includes('başka bir kullanıcı')) {
        toast.warning('Çakışma', 'Lot başka bir kullanıcı tarafından güncellenmiş. Lütfen sayfayı yenileyin.');
      } else {
        toast.error('Lot kaydedilemedi', msg);
      }
    },
  });

  const finalizeMeltLotMutation = useMutation({
    mutationFn: (payload: { lotId: string; reverse?: boolean }) =>
      apiRequest<LogMeltLot>(`/api/v2/log/melt-lots/${payload.lotId}/${payload.reverse ? 'reopen' : 'finalize'}`, {
        method: 'POST',
      }),
    onSuccess: async (lot, vars) => {
      await invalidateLog();
      emitArtifactSync({ kind: 'log', key: String(selectedYear), source: 'log-ui' });
      toast.success(vars.reverse ? 'Lot tekrar düzenlenebilir' : 'Lot finalize edildi', lot.id?.slice(0, 8));
    },
    onError: (error) => {
      toast.error('Lot durumu güncellenemedi', extractApiMessage(error, 'Sunucu hatası'));
    },
  });

  const deleteMeltLotMutation = useMutation({
    mutationFn: (lotId: string) =>
      apiRequest<Blob>(`/api/v2/log/melt-lots/${lotId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await invalidateLog();
      emitArtifactSync({ kind: 'log', key: String(selectedYear), source: 'log-ui' });
      toast.success('Lot silindi');
    },
    onError: (error) => {
      toast.error('Lot silinemedi', extractApiMessage(error, 'Sunucu hatası'));
    },
  });

  const lotHistoryQuery = useQuery({
    queryKey: ['log', 'melt-lot', historyLotId, 'history'],
    enabled: Boolean(historyLotId),
    queryFn: () =>
      apiRequest<LogMeltLotHistory[]>(`/api/v2/log/melt-lots/${historyLotId}/history?limit=50`),
  });

  const lotLinesQuery = useQuery({
    queryKey: ['log', 'melt-lot', linesLotId, 'lines'],
    enabled: Boolean(linesLotId),
    queryFn: () =>
      apiRequest<LogMeltLotLine[]>(`/api/v2/log/melt-lots/${linesLotId}/lines`),
  });

  async function downloadLotPdf(lotId: string) {
    try {
      await downloadAuthedDocument(`/api/v2/log/melt-lots/${lotId}/pdf`, `lot-${lotId.slice(0, 8)}.pdf`);
      toast.success('PDF indirildi');
    } catch (error) {
      toast.error('PDF alınamadı', extractApiMessage(error, 'Sunucu hatası'));
    }
  }

  return {
    workspace: workspaceQuery.data,
    isLoading: workspaceQuery.isLoading,
    isError: workspaceQuery.isError,
    onRetryWorkspace: () => workspaceQuery.refetch(),
    activeView,
    onActiveViewChange: (nextView) => {
      if (pendingRouteSummary.count > 0 && nextView !== 'system') {
        toast.warning('Bekleyen değişiklik var', 'Önce review bar içinden uygula veya vazgeç.');
        return;
      }
      setActiveView(nextView);
    },
    activeTab,
    onActiveTabChange: (nextTab) => {
      if (nextTab === activeTab) return;
      if (pendingRouteSummary.count > 0) {
        toast.warning('Bekleyen değişiklik var', 'Sekme değişimi için önce review bar içinden uygula veya vazgeç.');
        return;
      }
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
    finalizeBusy: finalizeMeltLotMutation.isPending,
    deleteBusy: deleteMeltLotMutation.isPending,
    pendingRouteCount: pendingRouteSummary.count,
    pendingRouteSummary,
    onDiscardRouteReview: async () => {
      if (pendingRouteSummary.count === 0) return;
      const ok = await confirm({
        title: 'Bekleyen rota değişikliklerini sil',
        message: `${pendingRouteSummary.count} bekleyen rota değişikliği silinecek.`,
        confirmText: 'Sil',
        variant: 'warning',
      });
      if (!ok) return;
      setLineDrafts((current) => {
        const next = { ...current };
        for (const line of activeLines) {
          next[line.id] = buildLineDraft(line);
        }
        return next;
      });
      toast.info('Bekleyen değişiklikler silindi');
    },
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
      updateMeltLotMutation.mutate({
        lotId,
        draft,
        expectedUpdatedAt: fallback.updated_at,
      });
    },
    onCreateMeltLot: () => createMeltLotMutation.mutate(),
    onFinalizeLot: (lotId, reverse) => finalizeMeltLotMutation.mutate({ lotId, reverse }),
    onDeleteLot: async (lotId) => {
      const ok = await confirm({
        title: 'Lotu sil',
        message: 'Bu lotu silmek istediğinize emin misiniz? Bağlı satırlar serbest bırakılır.',
        confirmText: 'Sil',
        variant: 'danger',
      });
      if (!ok) return;
      deleteMeltLotMutation.mutate(lotId);
    },
    onDownloadLotPdf: downloadLotPdf,
    onOpenLotHistory: (lotId) => setHistoryLotId(lotId),
    onCloseLotHistory: () => setHistoryLotId(null),
    historyLotId,
    lotHistory: lotHistoryQuery.data ?? [],
    lotHistoryLoading: lotHistoryQuery.isLoading,
    onOpenLotLines: (lotId) => setLinesLotId(lotId),
    onCloseLotLines: () => setLinesLotId(null),
    linesLotId,
    lotLines: lotLinesQuery.data ?? [],
    lotLinesLoading: lotLinesQuery.isLoading,
    selectedYear,
    onSelectedYearChange: setSelectedYear,
  };
}
