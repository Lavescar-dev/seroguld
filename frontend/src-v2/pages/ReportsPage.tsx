import { useQuery } from '@tanstack/react-query';

import { SectionCard } from '@/components/SectionCard';
import { apiRequest, openAuthedDocument } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { ModernReportsHealthPage } from '@/modern/pages';
import { useUiVariant } from '@/ui-variants';
import type { ReportSummary } from '@/types';

const EMPTY_REPORT: ReportSummary = { period_start: '', period_end: '', purchased_count: 0, sold_count: 0, melted_count: 0, total_purchase_value_dkk: '0', total_sale_value_dkk: '0', total_profit_dkk: '0' };

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
  const { variant } = useUiVariant();
  const daily = useQuery({ queryKey: ['report', 'daily'], queryFn: () => apiRequest<ReportSummary>('/api/reports/daily') });
  const weekly = useQuery({ queryKey: ['report', 'weekly'], queryFn: () => apiRequest<ReportSummary>('/api/reports/weekly') });
  const monthly = useQuery({ queryKey: ['report', 'monthly'], queryFn: () => apiRequest<ReportSummary>('/api/reports/monthly') });

  if (variant === 'modern') {
    const report = (id: string, label: string, query: typeof daily) => ({
      id,
      label,
      summary: query.data || EMPTY_REPORT,
      availability: query.isError ? { state: 'unavailable' as const, title: 'Rapor alınamadı', description: query.error instanceof Error ? query.error.message : 'Transport error' } : { state: 'available' as const },
      onExport: () => void openAuthedDocument(`/api/reports/export?period=${id}&format=xlsx`),
    });
    return (
      <ModernReportsHealthPage
        reports={[report('daily', 'Günlük', daily), report('weekly', 'Haftalık', weekly), report('monthly', 'Aylık', monthly)]}
        health={[
          { id: 'report-api', source: 'CRM', target: 'Rapor API', status: daily.isError || weekly.isError || monthly.isError ? 'Kontrol' : 'Bağlı', detail: 'Gerçek günlük, haftalık ve aylık summary endpointleri.', tone: daily.isError || weekly.isError || monthly.isError ? 'warning' : 'success' },
          { id: 'export', source: 'Rapor API', target: 'XLSX', status: 'Kullanılabilir', detail: 'Mevcut authenticated document helper ile dışa aktarım.', tone: 'info' },
        ]}
        salesDiscovery={{
          availability: { state: 'readonly', title: 'Satış modülü V1 kapsamında değil', description: 'Rapor API satış toplamlarını okuyabilir; aktif satış workflow veya route bulunmuyor.' },
          summary: 'Karar ve backend kontratı bekleniyor.',
          findings: [{ id: 'sales-contract', title: 'Satış workflow kontratı', note: 'Stok düşümü, ödeme, iade ve muhasebe yan etkileri tanımlanmadan aksiyon açılmayacak.', status: 'V1 dışı', tone: 'warning' }],
        }}
      />
    );
  }

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
