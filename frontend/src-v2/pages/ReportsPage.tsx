import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { SectionCard } from '@/components/SectionCard';
import { apiRequest, downloadAuthedDocument, localizeApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { ModernReportsHealthPage } from '@/modern/pages';
import { useToast } from '@/lib/toast';
import { useUiVariant } from '@/ui-variants';
import type { ReportSummary } from '@/types';

const EMPTY_REPORT: ReportSummary = { period_start: '', period_end: '', purchased_count: 0, sold_count: 0, melted_count: 0, total_purchase_value_dkk: '0', total_sale_value_dkk: '0', total_profit_dkk: '0' };

// Backend desteklerinin tamamı (reports.py: period=all|daily|weekly|monthly,
// format=csv|xlsx|pdf); yüzey daha önce yalnız xlsx + 3 dönem açıyordu.
const EXPORT_PERIODS = [
  { value: 'daily', label: 'Günlük' },
  { value: 'weekly', label: 'Haftalık' },
  { value: 'monthly', label: 'Aylık' },
  { value: 'all', label: 'Tüm kayıtlar' },
] as const;
const EXPORT_FORMATS = [
  { value: 'xlsx', label: 'XLSX' },
  { value: 'pdf', label: 'PDF' },
  { value: 'csv', label: 'CSV' },
] as const;

type ExportPeriod = (typeof EXPORT_PERIODS)[number]['value'];
type ExportFormat = (typeof EXPORT_FORMATS)[number]['value'];

// Zaman damgalı ad: aynı dönemi tekrar indirirken üst üste binmesin.
// (Content-Disposition'daki backend adını okumak lib/api tarafı işi — oradaki
// helper sabit ad yazıyor; oraya dokunulamadığı için istemci damgası kullanılır.)
function exportFilename(period: ExportPeriod | string, format: ExportFormat | string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `seroguld-${period}-report-${stamp}.${format}`;
}

function useReportExport() {
  const toast = useToast();
  return (period: string, format: string) => {
    void downloadAuthedDocument(`/api/reports/export?period=${period}&format=${format}`, exportFilename(period, format)).catch(
      (error: unknown) => toast.error('Rapor indirilemedi', localizeApiError(error)),
    );
  };
}

function ReportBlock({ title, queryKey, path }: { title: string; queryKey: string; path: string }) {
  const query = useQuery({
    queryKey: ['report', queryKey],
    queryFn: () => apiRequest<ReportSummary>(path),
  });
  const onExport = useReportExport();
  const [exportPeriod, setExportPeriod] = useState<ExportPeriod | 'all'>(queryKey as ExportPeriod | 'all');
  const [format, setFormat] = useState<ExportFormat>('xlsx');

  const data = query.data;
  const isPending = query.isPending;
  const isError = query.isError;

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <div className="flex items-center gap-2">
          {/* Dönem ve format seçimi: backend'in period=all ve csv/pdf uçları artık yüzeyde. */}
          <select
            aria-label={`${title} dönem seçimi`}
            value={exportPeriod}
            onChange={(event) => setExportPeriod(event.target.value as ExportPeriod | 'all')}
            className="rounded-2xl border border-white/10 bg-[#14120f] px-3 py-2 text-sm text-brand-100"
          >
            {EXPORT_PERIODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label={`${title} format seçimi`}
            value={format}
            onChange={(event) => setFormat(event.target.value as ExportFormat)}
            className="rounded-2xl border border-white/10 bg-[#14120f] px-3 py-2 text-sm text-brand-100"
          >
            {EXPORT_FORMATS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onExport(exportPeriod, format)}
            className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-brand-100 transition hover:bg-white/10"
          >
            İndir
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-[#14120f] p-3">
          <p className="text-sm text-brand-300">Alım</p>
          <p className="mt-2 text-xl font-semibold text-white">{isPending || isError ? '—' : data?.purchased_count ?? '-'}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#14120f] p-3">
          <p className="text-sm text-brand-300">Satış</p>
          <p className="mt-2 text-xl font-semibold text-white">{isPending || isError ? '—' : data?.sold_count ?? '-'}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#14120f] p-3">
          <p className="text-sm text-brand-300">Kâr</p>
          <p className="mt-2 text-xl font-semibold text-white">{isPending || isError ? '—' : formatMoney(data?.total_profit_dkk)}</p>
        </div>
      </div>
      {isPending ? (
        <p className="mt-3 text-sm text-brand-200/70" role="status">
          Rapor yükleniyor…
        </p>
      ) : isError ? (
        <div role="alert" className="mt-3 flex flex-col gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-rose-200">
            Rapor alınamadı: {query.error instanceof Error ? query.error.message : 'bilinmeyen hata'}
          </p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="rounded-2xl border border-rose-400/40 px-3 py-1.5 text-sm text-rose-100 transition hover:bg-rose-500/20"
          >
            Tekrar dene
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-brand-200/70">
          {formatDate(data?.period_start)} - {formatDate(data?.period_end)}
        </p>
      )}
    </div>
  );
}

export function ReportsPage() {
  const { variant } = useUiVariant();
  const daily = useQuery({ queryKey: ['report', 'daily'], queryFn: () => apiRequest<ReportSummary>('/api/reports/daily') });
  const weekly = useQuery({ queryKey: ['report', 'weekly'], queryFn: () => apiRequest<ReportSummary>('/api/reports/weekly') });
  const monthly = useQuery({ queryKey: ['report', 'monthly'], queryFn: () => apiRequest<ReportSummary>('/api/reports/monthly') });
  const onExport = useReportExport();

  if (variant === 'modern') {
    const reportsPending = daily.isPending || weekly.isPending || monthly.isPending;
    const reportsError = daily.isError || weekly.isError || monthly.isError;
    const report = (id: string, label: string, query: typeof daily) => ({
      id,
      label,
      // Bekleme sırasında EMPTY_REPORT sıfırları basılmadan önce health şeridi
      // "Kontrol ediliyor" der; ModernReportsHealthPage kontratı ReportSummary
      // istediği için özet alanı değişmeden kalır.
      summary: query.data || EMPTY_REPORT,
      availability: query.isError ? { state: 'unavailable' as const, title: 'Rapor alınamadı', description: query.error instanceof Error ? query.error.message : 'Transport error' } : { state: 'available' as const },
      onExport: () => onExport(id, 'xlsx'),
    });
    return (
      <ModernReportsHealthPage
        reports={[report('daily', 'Günlük', daily), report('weekly', 'Haftalık', weekly), report('monthly', 'Aylık', monthly)]}
        health={[
          {
            id: 'report-api',
            source: 'CRM',
            target: 'Rapor API',
            // Üçüncü durum: istek sürerken "Bağlı" sahte sağlıklı görünüyordu.
            status: reportsError ? 'Kontrol' : reportsPending ? 'Kontrol ediliyor' : 'Bağlı',
            detail: 'Gerçek günlük, haftalık ve aylık summary endpointleri.',
            tone: reportsError ? 'warning' : reportsPending ? 'info' : 'success',
          },
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
      <SectionCard
        title="Rapor Merkezi"
        description="Günlük, haftalık, aylık ve tüm kayıtlar; XLSX, PDF ve CSV formatlarında."
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <ReportBlock title="Günlük" queryKey="daily" path="/api/reports/daily" />
          <ReportBlock title="Haftalık" queryKey="weekly" path="/api/reports/weekly" />
          <ReportBlock title="Aylık" queryKey="monthly" path="/api/reports/monthly" />
        </div>
        <div className="mt-4 flex items-center justify-end">
          <button
            type="button"
            onClick={() => onExport('all', 'xlsx')}
            className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-brand-100 transition hover:bg-white/10"
          >
            Tüm kayıtları indir (XLSX)
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
