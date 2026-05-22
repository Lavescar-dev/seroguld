import { useQuery } from '@tanstack/react-query';
import { Activity, BadgeCheck, History, TrendingUp } from 'lucide-react';

import { apiRequest } from '@/lib/api';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';

export interface CustomerAlisSummary {
  customer_id: string;
  total_documents: number;
  total_amount_dkk: string;
  total_weight_grams: string;
  last_purchase_at?: string | null;
  first_purchase_at?: string | null;
  avg_amount_dkk: string;
  last_30d_documents: number;
  last_30d_amount_dkk: string;
  last_365d_documents: number;
  last_365d_amount_dkk: string;
}

export function CustomerAlisSummaryStrip({ customerId }: { customerId: string | null | undefined }) {
  const query = useQuery({
    queryKey: ['customer', 'alis-summary', customerId],
    queryFn: () => apiRequest<CustomerAlisSummary>(`/api/v2/musteriler/${customerId}/alis-summary`),
    enabled: Boolean(customerId),
    staleTime: 60_000,
  });

  if (!customerId) return null;
  if (query.isLoading) {
    return (
      <div className="border-b border-brand-200 bg-brand-50/50 px-4 py-2 text-[11px] text-brand-400">
        Müşteri özeti yükleniyor...
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="border-b border-brand-200 bg-rose-50 px-4 py-2 text-[11px] text-rose-600">
        Müşteri özeti alınamadı
      </div>
    );
  }

  const data = query.data;
  if (data.total_documents === 0) {
    return (
      <div className="border-b border-brand-200 bg-emerald-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
        <BadgeCheck className="mr-1 inline-block h-3 w-3" /> İlk Alış · Yeni Müşteri
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-px border-b border-brand-200 bg-brand-200 sm:grid-cols-4">
      <SummaryTile
        icon={<History className="h-3 w-3" />}
        label="Toplam Alış"
        primary={`${data.total_documents} adet`}
        secondary={formatMoney(data.total_amount_dkk)}
        tone="emerald"
      />
      <SummaryTile
        icon={<Activity className="h-3 w-3" />}
        label="Son 30 Gün"
        primary={`${data.last_30d_documents} adet`}
        secondary={formatMoney(data.last_30d_amount_dkk)}
        tone={data.last_30d_documents > 0 ? 'amber' : 'slate'}
      />
      <SummaryTile
        icon={<TrendingUp className="h-3 w-3" />}
        label="Son 12 Ay"
        primary={`${data.last_365d_documents} adet`}
        secondary={formatMoney(data.last_365d_amount_dkk)}
        tone="brand"
      />
      <SummaryTile
        icon={<BadgeCheck className="h-3 w-3" />}
        label="Son Alış"
        primary={data.last_purchase_at ? formatDate(data.last_purchase_at) : '—'}
        secondary={`Ort. ${formatMoney(data.avg_amount_dkk)} · ${formatNumber(data.total_weight_grams, ' g')}`}
        tone="slate"
      />
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  primary,
  secondary,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  primary: string;
  secondary?: string;
  tone: 'emerald' | 'amber' | 'brand' | 'slate';
}) {
  const map = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    brand: 'bg-brand-50 border-brand-200 text-brand-900',
    slate: 'bg-slate-50 border-slate-200 text-slate-800',
  } as const;
  const labelMap = {
    emerald: 'text-emerald-600',
    amber: 'text-amber-700',
    brand: 'text-brand-500',
    slate: 'text-slate-500',
  } as const;
  return (
    <div className={`px-3 py-2 ${map[tone]}`}>
      <div className={`flex items-center gap-1 text-[9px] font-black uppercase tracking-widest ${labelMap[tone]}`}>
        {icon}
        {label}
      </div>
      <p className="mono mt-1 text-xs font-black">{primary}</p>
      {secondary ? <p className="mono mt-0.5 text-[10px] font-semibold opacity-80">{secondary}</p> : null}
    </div>
  );
}
