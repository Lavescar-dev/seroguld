import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import type {
  BaglantiDurumu,
  Fatura,
  FaturaTipi,
  SortKey,
  SortDir,
  TarihFiltre,
  UnicontaConfigResponse,
  UnicontaConnectResponse,
  UnicontaInvoicesResponse,
  UnicontaKimlik,
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

export function useUnicontaMakeState(): UseUnicontaMakeStateResult {
  const [kimlik, setKimlik] = useState<UnicontaKimlik>({
    companyId: '',
    username: '',
    password: '',
    env: 'production',
  });
  const [ayarlarAcik, setAyarlarAcik] = useState(false);
  const [secilenFatura, setSecilenFatura] = useState<Fatura | null>(null);
  const [aramaQ, setAramaQ] = useState('');
  const [tipFiltre, setTipFiltre] = useState<FaturaTipi | 'Tümü'>('Tümü');
  const [mailFiltre, setMailFiltre] = useState<MailFiltre>('tümü');
  const [eFaturaFiltre, setEFaturaFiltre] = useState<MailFiltre>('tümü');
  const [tarihFiltre, setTarihFiltre] = useState<TarihFiltre>('tümü');
  const [sortKey, setSortKey] = useState<SortKey>('fakturadato');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filtrePanelAcik, setFiltrePanelAcik] = useState(false);
  const [apiConfig, setApiConfig] = useState<UnicontaConfigResponse | null>(null);

  const configQuery = useQuery({
    queryKey: ['uniconta-config-v2'],
    queryFn: () => apiRequest<UnicontaConfigResponse>('/api/v2/uniconta/config'),
  });

  const invoicesQuery = useQuery({
    queryKey: ['uniconta-invoices-v2'],
    queryFn: () => apiRequest<UnicontaInvoicesResponse>('/api/v2/uniconta/invoices'),
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
        }),
      }),
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
    });
  }, [configQuery.data]);

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
          });
          setAyarlarAcik(false);
          void configQuery.refetch();
          void invoicesQuery.refetch();
        },
      },
    );
  };

  const yenile = () => {
    if (baglantiDurumu !== 'bagli') return;
    void invoicesQuery.refetch();
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

    if (aramaQ.trim()) {
      const q = aramaQ.toLowerCase();
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
  }, [aramaQ, eFaturaFiltre, faturalar, mailFiltre, sortDir, sortKey, tarihFiltre, tipFiltre]);

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
  };
}
