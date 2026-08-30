import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { listenArtifactSync, signalMatches } from '@/lib/artifactSync';
import { useToast } from '@/lib/toast';
import type {
  BaglantiDurumu,
  Fatura,
  FaturaTipi,
  SortKey,
  SortDir,
  TarihFiltre,
  UnicontaBulkRetry,
  UnicontaConfigResponse,
  UnicontaConnectionDraft,
  UnicontaConnectResponse,
  UnicontaFailedSyncRow,
  UnicontaHealth,
  UnicontaInvoicesResponse,
  UnicontaKimlik,
  UnicontaSyncSummary,
  UseUnicontaMakeStateResult,
  MailFiltre,
} from './types';

const UNICONTA_INVOICE_PAGE_SIZE = 500;
const UNICONTA_INVOICE_MAX_PAGES = 30;

function normalizeEnv(_value: string | null | undefined): UnicontaKimlik['env'] {
  return 'production';
}

function normalizeBaglantiDurumu(value: string | null | undefined): BaglantiDurumu {
  if (value === 'bagli' || value === 'bagli_degil' || value === 'yukleniyor' || value === 'hata') {
    return value;
  }
  return 'bagli_degil';
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
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
      // ignore
    }
    return error.message || fallback;
  }
  return fallback;
}

export async function fetchRemoteInvoices(signal?: AbortSignal): Promise<UnicontaInvoicesResponse> {
  const invoices: Fatura[] = [];
  let generatedAt = new Date().toISOString();
  let source = 'uniconta_remote';
  const seen = new Set<string>();
  let truncated = false;

  for (let page = 0; page < UNICONTA_INVOICE_MAX_PAGES; page += 1) {
    const skip = page * UNICONTA_INVOICE_PAGE_SIZE;
    const response = await apiRequest<UnicontaInvoicesResponse>(
      `/api/v2/uniconta/invoices?source=remote&limit=${UNICONTA_INVOICE_PAGE_SIZE}&skip=${skip}`,
      { signal },
    );
    source = response.source;
    generatedAt = response.generatedAt;

    let newInvoiceCount = 0;
    for (const invoice of response.invoices) {
      const key = invoice.id || `${invoice.fakturanummer}:${invoice.konto}:${invoice.fakturadato}`;
      if (!seen.has(key)) {
        seen.add(key);
        newInvoiceCount += 1;
      }
    }
    if (page > 0 && response.invoices.length > 0 && newInvoiceCount === 0) {
      throw new Error('Uniconta aynı fatura sayfasını tekrar döndürdü; listeleme durduruldu.');
    }
    invoices.push(...response.invoices);
    if (response.hasMore === false || response.invoices.length < UNICONTA_INVOICE_PAGE_SIZE) break;
    if (page === UNICONTA_INVOICE_MAX_PAGES - 1) truncated = true;
  }

  const uniqueSeen = new Set<string>();
  const uniqueInvoices = invoices.filter((invoice) => {
    const key = invoice.id || `${invoice.fakturanummer}:${invoice.konto}:${invoice.fakturadato}`;
    if (uniqueSeen.has(key)) return false;
    uniqueSeen.add(key);
    return true;
  });

  return { source, generatedAt, invoices: uniqueInvoices, skip: 0, limit: UNICONTA_INVOICE_PAGE_SIZE, hasMore: false, truncated };
}

export function useUnicontaMakeState(): UseUnicontaMakeStateResult {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [kimlik, setKimlik] = useState<UnicontaKimlik>({
    companyId: '',
    username: '',
    password: '',
    env: 'production',
    sendEmailOnFinalize: false,
    sendXmlOnFinalize: false,
  });
  const [ayarlarAcik, setAyarlarAcik] = useState(false);
  const [secilenFatura, setSecilenFatura] = useState<Fatura | null>(null);
  const [aramaQ, setAramaQ] = useState('');
  const debouncedAramaQ = useDebouncedValue(aramaQ, 300);
  const [tipFiltre, setTipFiltre] = useState<FaturaTipi | 'Tümü'>('Tümü');
  const [mailFiltre, setMailFiltre] = useState<MailFiltre>('tümü');
  const [eFaturaFiltre, setEFaturaFiltre] = useState<MailFiltre>('tümü');
  const [tarihFiltre, setTarihFiltre] = useState<TarihFiltre>('tümü');
  const [sortKey, setSortKey] = useState<SortKey>('fakturadato');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filtrePanelAcik, setFiltrePanelAcik] = useState(false);
  const [apiConfig, setApiConfig] = useState<UnicontaConfigResponse | null>(null);
  const [retryingSingleSeq, setRetryingSingleSeq] = useState<number | null>(null);
  const retryingSingleSeqRef = useRef<number | null>(null);
  const connectInFlightRef = useRef(false);
  const [lastBulkRetryResult, setLastBulkRetryResult] = useState<UnicontaBulkRetry | null>(null);

  const configQuery = useQuery({
    queryKey: ['uniconta-config-v2'],
    queryFn: () => apiRequest<UnicontaConfigResponse>('/api/v2/uniconta/config'),
  });

  const invoicesQuery = useQuery({
    queryKey: ['uniconta', 'invoices-v2'],
    queryFn: ({ signal }) => fetchRemoteInvoices(signal),
    enabled: configQuery.data?.configured === true,
  });

  const syncSummaryQuery = useQuery({
    queryKey: ['uniconta', 'sync-summary'],
    queryFn: () => apiRequest<UnicontaSyncSummary>('/api/v2/uniconta/sync-summary?hours=24'),
    staleTime: 30_000,
  });

  const failedSyncsQuery = useQuery({
    queryKey: ['uniconta', 'failed-syncs'],
    queryFn: () =>
      apiRequest<UnicontaFailedSyncRow[]>('/api/v2/uniconta/failed-syncs?status_filter=all&limit=100'),
    staleTime: 30_000,
  });

  const healthQuery = useQuery({
    queryKey: ['uniconta', 'health'],
    queryFn: () => apiRequest<UnicontaHealth>('/api/v2/uniconta/health'),
    refetchInterval: 60_000,
  });

  const connectMutation = useMutation({
    mutationFn: ({ draft, persist }: { draft: UnicontaConnectionDraft; persist: boolean }) =>
      apiRequest<UnicontaConnectResponse>('/api/v2/uniconta/connect', {
        method: 'POST',
        body: JSON.stringify({
          companyId: draft.companyId,
          username: draft.username,
          password: draft.password.trim() || null,
          sendEmailOnFinalize: draft.sendEmailOnFinalize,
          sendXmlOnFinalize: draft.sendXmlOnFinalize,
          // false -> "yalnızca test et": bağlantı doğrulanır, .env güncellenmez.
          persist,
        }),
      }),
    onError: (error) => {
      toast.error('Uniconta bağlantı hatası', extractApiMessage(error, 'Sunucu hatası'));
    },
  });

  const retrySingleMutation = useMutation({
    mutationFn: (sequenceNo: number) =>
      apiRequest<{ ok: boolean; message?: string | null; uniconta_invoice_number?: string | null }>(
        `/api/v2/uniconta/invoice/from-pos/${sequenceNo}`,
        { method: 'POST' },
      ),
    onMutate: (sequenceNo) => {
      setRetryingSingleSeq(sequenceNo);
    },
    onSuccess: async (result) => {
      if (result?.ok) {
        toast.success('Sync başarılı', result.uniconta_invoice_number || undefined);
      } else {
        toast.warning('Sync tamamlanamadı', result?.message || undefined);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['uniconta'] }),
        queryClient.invalidateQueries({ queryKey: ['pos', 'alis', 'list'] }),
      ]);
    },
    onError: (error) => {
      toast.error('Sync hatası', extractApiMessage(error, 'Sunucu hatası'));
    },
    onSettled: () => {
      setRetryingSingleSeq(null);
      retryingSingleSeqRef.current = null;
    },
  });

  const retryAllMutation = useMutation({
    mutationFn: () =>
      apiRequest<UnicontaBulkRetry>('/api/v2/uniconta/sync-retry-all?limit=50', { method: 'POST' }),
    onSuccess: async (result) => {
      setLastBulkRetryResult(result);
      if (result.failed === 0 && result.succeeded > 0) {
        toast.success(`${result.succeeded} fatura senkronize edildi`);
      } else if (result.succeeded > 0) {
        toast.warning(
          `${result.succeeded} başarılı, ${result.failed} başarısız`,
          'Detaylar için failed list paneline bakın.',
        );
      } else {
        toast.error('Hiçbir sync başarılı olmadı', `${result.attempted} deneme, ${result.failed} hata`);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['uniconta'] }),
        queryClient.invalidateQueries({ queryKey: ['pos', 'alis', 'list'] }),
      ]);
    },
    onError: (error) => {
      toast.error('Toplu retry hatası', extractApiMessage(error, 'Sunucu hatası'));
    },
  });

  useEffect(() => {
    if (!configQuery.data) return;
    setApiConfig({
      ...configQuery.data,
      env: normalizeEnv(configQuery.data.env),
      connectionStatus: normalizeBaglantiDurumu(configQuery.data.connectionStatus),
    });
    setKimlik({
      companyId: configQuery.data.companyId,
      username: configQuery.data.username,
      password: '',
      env: normalizeEnv(configQuery.data.env),
      sendEmailOnFinalize: configQuery.data.sendEmailOnFinalize,
      sendXmlOnFinalize: configQuery.data.sendXmlOnFinalize,
    });
  }, [configQuery.data]);

  useEffect(() => {
    if (configQuery.data?.configured === false) {
      queryClient.removeQueries({ queryKey: ['uniconta', 'invoices-v2'] });
    }
  }, [configQuery.data?.configured, queryClient]);

  // U3 — Cross-module sync listener (alış finalize → invalidate uniconta)
  useEffect(() => {
    return listenArtifactSync((signal) => {
      if (signal.source === 'uniconta-ui') return;
      if (!signalMatches(signal, 'uniconta')) return;
      void queryClient.invalidateQueries({ queryKey: ['uniconta'] });
    });
  }, [queryClient]);

  const faturalar = useMemo(() => invoicesQuery.data?.invoices ?? [], [invoicesQuery.data]);
  const invoicesError = invoicesQuery.error ? extractApiMessage(invoicesQuery.error, 'Uniconta fatura listesi alınamadı.') : null;

  useEffect(() => {
    if (!secilenFatura) return;
    const freshInvoice = faturalar.find((item) => item.id === secilenFatura.id);
    if (freshInvoice) {
      setSecilenFatura(freshInvoice);
      return;
    }
    setSecilenFatura(null);
  }, [faturalar, secilenFatura]);

  const baglantiDurumu = normalizeBaglantiDurumu(
    connectMutation.isPending || configQuery.isFetching
      ? 'yukleniyor'
      : connectMutation.data?.connectionStatus
        ?? (invoicesQuery.isError || healthQuery.data?.last_call_ok === false
          ? 'hata'
          : invoicesQuery.isSuccess || healthQuery.data?.last_call_ok === true
            ? 'bagli'
            : configQuery.data?.connectionStatus),
  );
  // Remote invoice pagination can take several requests (up to 30 pages).
  // Keep connection settings/test usable while that read-only list refreshes;
  // the page separately disables only the Yenile action during the fetch.
  const yukleniyor = connectMutation.isPending || configQuery.isFetching;
  const sonYenileme = invoicesQuery.data?.generatedAt ? new Date(invoicesQuery.data.generatedAt) : null;

  const baglan = (draft: UnicontaConnectionDraft = kimlik, opts?: { persist?: boolean }) => {
    // persist:false -> "yalnızca test et": kayıtlı kimlik bilgileri ve gönderim
    // tercihleri olduğu gibi kalır, panel de açık kalmaya devam eder.
    const persist = opts?.persist ?? true;
    if (connectInFlightRef.current || connectMutation.isPending) return;
    connectInFlightRef.current = true;
    connectMutation.mutate(
      { draft, persist },
      {
        onSuccess: (result) => {
          setApiConfig({
            ...result.config,
            env: normalizeEnv(result.config.env),
            connectionStatus: normalizeBaglantiDurumu(result.config.connectionStatus),
          });
          if (result.connectionStatus === 'bagli') {
            if (persist) {
              setKimlik({
                companyId: result.config.companyId,
                username: result.config.username,
                password: '',
                env: normalizeEnv(result.config.env),
                sendEmailOnFinalize: result.config.sendEmailOnFinalize,
                sendXmlOnFinalize: result.config.sendXmlOnFinalize,
              });
              setAyarlarAcik(false);
              void queryClient.invalidateQueries({ queryKey: ['uniconta-config-v2'] });
            } else {
              setKimlik((current) => ({ ...current, password: '' }));
            }
            void queryClient.invalidateQueries({ queryKey: ['uniconta'] });
            toast.success(
              persist ? 'Uniconta bağlandı' : 'Bağlantı testi başarılı',
              result.message || undefined,
            );
          } else if (result.connectionStatus === 'hata') {
            toast.error('Uniconta bağlantı hatası', result.message || undefined);
          } else {
            toast.warning('Uniconta yapılandırma eksik', result.message || undefined);
          }
        },
        onSettled: () => {
          connectInFlightRef.current = false;
        },
      },
    );
  };

  const yenile = () => {
    if (baglantiDurumu !== 'bagli') {
      toast.warning('Bağlı değil', 'Önce Uniconta\'ya bağlanın.');
      return;
    }
    void invoicesQuery.refetch().then(() => toast.success('Fatura listesi yenilendi'));
    void queryClient.invalidateQueries({ queryKey: ['uniconta', 'sync-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['uniconta', 'failed-syncs'] });
    void queryClient.invalidateQueries({ queryKey: ['uniconta', 'health'] });
  };

  const sort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir('asc');
  };

  const filtrelenmis = useMemo(() => {
    let list = [...faturalar];

    if (debouncedAramaQ.trim()) {
      const q = debouncedAramaQ.toLowerCase();
      list = list.filter((fatura) =>
        fatura.fakturanummer.toLowerCase().includes(q) ||
        fatura.kunde.navn.toLowerCase().includes(q) ||
        fatura.konto.toLowerCase().includes(q) ||
        (fatura.ordrenummer || '').toLowerCase().includes(q) ||
        (fatura.wooOrderId || '').toLowerCase().includes(q) ||
        (fatura.unicontaRef || '').toLowerCase().includes(q),
      );
    }

    if (tipFiltre !== 'Tümü') list = list.filter((fatura) => fatura.type === tipFiltre);
    if (mailFiltre === 'gonderildi') list = list.filter((fatura) => Boolean(fatura.mailSendt));
    if (mailFiltre === 'gonderilmedi') list = list.filter((fatura) => !fatura.mailSendt);
    if (eFaturaFiltre === 'gonderildi') list = list.filter((fatura) => Boolean(fatura.eFakturaSendt));
    if (eFaturaFiltre === 'gonderilmedi') list = list.filter((fatura) => !fatura.eFakturaSendt);

    if (tarihFiltre !== 'tümü') {
      const now = new Date();
      list = list.filter((fatura) => {
        const date = new Date(fatura.fakturadato);
        if (tarihFiltre === 'bu_ay') return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
        if (tarihFiltre === 'son_3ay') return now.getTime() - date.getTime() <= 90 * 86400000;
        if (tarihFiltre === 'bu_yil') return date.getFullYear() === now.getFullYear();
        return true;
      });
    }

    list.sort((a, b) => {
      const av =
        sortKey === 'fakturanummer' ? a.fakturanummer :
        sortKey === 'fakturadato' ? a.fakturadato :
        sortKey === 'total' ? a.signedTotalAmount :
        sortKey === 'kunde' ? a.kunde.navn :
        a.konto;
      const bv =
        sortKey === 'fakturanummer' ? b.fakturanummer :
        sortKey === 'fakturadato' ? b.fakturadato :
        sortKey === 'total' ? b.signedTotalAmount :
        sortKey === 'kunde' ? b.kunde.navn :
        b.konto;
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });

    return list;
  }, [debouncedAramaQ, eFaturaFiltre, faturalar, mailFiltre, sortDir, sortKey, tarihFiltre, tipFiltre]);

  const stats = useMemo(() => {
    const toplam = faturalar.length;
    const toplamKredit = faturalar.reduce((sum, fatura) => sum + fatura.signedTotalAmount, 0);
    const mailGonderildi = faturalar.filter((fatura) => Boolean(fatura.mailSendt)).length;
    const eFakturaGonderildi = faturalar.filter((fatura) => Boolean(fatura.eFakturaSendt)).length;
    return { toplam, toplamKredit, mailGonderildi, eFakturaGonderildi };
  }, [faturalar]);

  const activeFilters = useMemo(
    () => [tipFiltre !== 'Tümü', mailFiltre !== 'tümü', eFaturaFiltre !== 'tümü', tarihFiltre !== 'tümü'].filter(Boolean).length,
    [eFaturaFiltre, mailFiltre, tarihFiltre, tipFiltre],
  );

  const pendingSyncCount = useMemo(() => {
    if (!syncSummaryQuery.data) return 0;
    return syncSummaryQuery.data.failed + syncSummaryQuery.data.skipped;
  }, [syncSummaryQuery.data]);

  return {
    config: apiConfig,
    kimlik,
    setKimlik,
    ayarlarAcik,
    setAyarlarAcik,
    secilenFatura,
    setSecilenFatura,
    aramaQ,
    setAramaQ,
    tipFiltre,
    setTipFiltre,
    mailFiltre,
    setMailFiltre,
    eFaturaFiltre,
    setEFaturaFiltre,
    tarihFiltre,
    setTarihFiltre,
    sortKey,
    sortDir,
    filtrePanelAcik,
    setFiltrePanelAcik,
    faturalar,
    filtrelenmis,
    invoicesLoading: invoicesQuery.isFetching,
    invoicesError,
    invoicesTruncated: Boolean(invoicesQuery.data?.truncated),
    baglantiDurumu,
    yukleniyor,
    sonYenileme,
    stats,
    activeFilters,
    baglan,
    yenile,
    sort,
    syncSummary: syncSummaryQuery.data ?? null,
    syncSummaryLoading: syncSummaryQuery.isLoading,
    failedSyncs: failedSyncsQuery.data ?? [],
    failedSyncsLoading: failedSyncsQuery.isLoading,
    pendingSyncCount,
    onRetryAll: () => retryAllMutation.mutate(),
    retryingAll: retryAllMutation.isPending,
    lastBulkRetryResult,
    health: healthQuery.data ?? null,
    healthLoading: healthQuery.isLoading,
    onRetryFailed: (sequenceNo) => {
      if (retryingSingleSeqRef.current !== null) return;
      retryingSingleSeqRef.current = sequenceNo;
      retrySingleMutation.mutate(sequenceNo);
    },
    retryingSingleSeq,
  };
}
