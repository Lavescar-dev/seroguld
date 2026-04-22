import { useQuery } from '@tanstack/react-query';

import { SectionCard } from '@/components/SectionCard';
import { apiRequest, openAuthedDocument } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import type { ReportSummary } from '@/types';

function ReportBlock({ title, queryKey, path }: { title: string; queryKey: string; path: string }) {
  const query = useQuery({
    queryKey: ['report', queryKey],
    queryFn: () => apiRequest<ReportSummary>(path),
  });

  const data = query.data;

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <button
          type="button"
          onClick={() => void openAuthedDocument(`/api/reports/export?period=${queryKey}&format=xlsx`)}
          className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-brand-100 transition hover:bg-white/10"
        >
          XLSX Al
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-[#14120f] p-3">
          <p className="text-sm text-brand-300">Alım</p>
          <p className="mt-2 text-xl font-semibold text-white">{data?.purchased_count ?? '-'}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#14120f] p-3">
          <p className="text-sm text-brand-300">Satış</p>
          <p className="mt-2 text-xl font-semibold text-white">{data?.sold_count ?? '-'}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#14120f] p-3">
          <p className="text-sm text-brand-300">Kâr</p>
          <p className="mt-2 text-xl font-semibold text-white">{formatMoney(data?.total_profit_dkk)}</p>
        </div>
      </div>
      <p className="mt-4 text-sm text-brand-200/70">
        {formatDate(data?.period_start)} - {formatDate(data?.period_end)}
      </p>
    </div>
  );
}

export function ReportsPage() {
  return (
    <div className="space-y-6">
      <SectionCard title="Rapor Merkezi" description="Günlük, haftalık ve aylık summary raporları.">
        <div className="grid gap-4 xl:grid-cols-3">
          <ReportBlock title="Günlük" queryKey="daily" path="/api/reports/daily" />
          <ReportBlock title="Haftalık" queryKey="weekly" path="/api/reports/weekly" />
          <ReportBlock title="Aylık" queryKey="monthly" path="/api/reports/monthly" />
        </div>
      </SectionCard>
    </div>
  );
}
