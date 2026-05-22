import { useEffect, useMemo, useState } from 'react';
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
  UnicontaConnectResponse,
  UnicontaFailedSyncRow,
  UnicontaHealth,
  UnicontaInvoicesResponse,
  UnicontaKimlik,
  UnicontaSyncSummary,
  UseUnicontaMakeStateResult,
  MailFiltre,
} from './types';

function normalizeEnv(value: string | null | undefined): UnicontaKimlik['env'] {
  return value === 'sandbox' ? 'sandbox' : 'production';
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
  const [lastBulkRetryResult, setLastBulkRetryResult] = useState<UnicontaBulkRetry | null>(null);

  const configQuery = useQuery({
    queryKey: ['uniconta-config-v2'],
    queryFn: () => apiRequest<UnicontaConfigResponse>('/api/v2/uniconta/config'),
  });

  const invoicesQuery = useQuery({
    queryKey: ['uniconta-invoices-v2'],
    queryFn: () => apiRequest<UnicontaInvoicesResponse>('/api/v2/uniconta/invoices?source=remote&limit=50'),
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
    mutationFn: (payload: UnicontaConfigResponse) =>
      apiRequest<UnicontaConnectResponse>('/api/v2/uniconta/connect', {
        method: 'POST',
        body: JSON.stringify({
          companyId: payload.companyId,
          username: payload.username,
          password: payload.password,
          env: payload.env,
          apiUrl: payload.apiUrl,
          apiKey: payload.apiKey,
          sendEmailOnFinalize: payload.sendEmailOnFinalize,
          sendXmlOnFinalize: payload.sendXmlOnFinalize,
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
      password: configQuery.data.password,
      env: normalizeEnv(configQuery.data.env),
      sendEmailOnFinalize: configQuery.data.sendEmailOnFinalize,
      sendXmlOnFinalize: configQuery.data.sendXmlOnFinalize,
    });
  }, [configQuery.data]);

  // U3 — Cross-module sync listener (alış finalize → invalidate uniconta)
  useEffect(() => {
    return listenArtifactSync((signal) => {
      if (signal.source === 'uniconta-ui') return;
      if (!signalMatches(signal, 'uniconta')) return;
      void queryClient.invalidateQueries({ queryKey: ['uniconta'] });
    });
  }, [queryClient]);

  const faturalar = useMemo(() => invoicesQuery.data?.invoices ?? [], [invoicesQuery.data]);

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
    connectMutation.data?.connectionStatus ?? configQuery.data?.connectionStatus,
  );
  const yukleniyor = invoicesQuery.isFetching || connectMutation.isPending || configQuery.isFetching;
  const sonYenileme = invoicesQuery.data?.generatedAt ? new Date(invoicesQuery.data.generatedAt) : null;

  const baglan = () => {
    connectMutation.mutate(
      {
        companyId: kimlik.companyId,
        username: kimlik.username,
        password: kimlik.password,
        env: kimlik.env,
        apiUrl: apiConfig?.apiUrl || 'https://www.uniconta.com/api',
        apiKey: apiConfig?.apiKey || '',
        connectionStatus: 'bagli_degil',
        configured: false,
        lastRefreshedAt: null,
        message: null,
        sendEmailOnFinalize: Boolean(kimlik.sendEmailOnFinalize),
        sendXmlOnFinalize: Boolean(kimlik.sendXmlOnFinalize),
      },
      {
        onSuccess: (result) => {
          setApiConfig({
            ...result.config,
            env: normalizeEnv(result.config.env),
            connectionStatus: normalizeBaglantiDurumu(result.config.connectionStatus),
          });
          setKimlik({
            companyId: result.config.companyId,
            username: result.config.username,
            password: result.config.password,
            env: normalizeEnv(result.config.env),
            sendEmailOnFinalize: result.config.sendEmailOnFinalize,
            sendXmlOnFinalize: result.config.sendXmlOnFinalize,
          });
          setAyarlarAcik(false);
          void configQuery.refetch();
          void invoicesQuery.refetch();
          void queryClient.invalidateQueries({ queryKey: ['uniconta'] });
          if (result.connectionStatus === 'bagli') {
            toast.success('Uniconta bağlandı', result.message || undefined);
          } else if (result.connectionStatus === 'hata') {
            toast.error('Uniconta bağlantı hatası', result.message || undefined);
          } else {
            toast.warning('Uniconta yapılandırma eksik', result.message || undefined);
          }
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
        sortKey === 'total' ? a.total :
        sortKey === 'kunde' ? a.kunde.navn :
        a.konto;
      const bv =
        sortKey === 'fakturanummer' ? b.fakturanummer :
        sortKey === 'fakturadato' ? b.fakturadato :
        sortKey === 'total' ? b.total :
        sortKey === 'kunde' ? b.kunde.navn :
        b.konto;
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });

    return list;
  }, [debouncedAramaQ, eFaturaFiltre, faturalar, mailFiltre, sortDir, sortKey, tarihFiltre, tipFiltre]);

  const stats = useMemo(() => {
    const toplam = faturalar.length;
    const toplamKredit = faturalar.reduce((sum, fatura) => sum + fatura.total, 0);
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
    onRetryFailed: (sequenceNo) => retrySingleMutation.mutate(sequenceNo),
    retryingSingleSeq,
  };
}
