import { Activity, Download, HeartPulse, SearchCode } from 'lucide-react';

import { ModernBadge, ModernButton, ModernCard, ModernDataTable, ModernPage, ModernSection, ModernSectionHeader, ModernStat } from '@/modern/design-system';

import { AvailabilityBanner, formatDate, formatMoney, toneForText } from './shared';
import type { ModernReportsHealthPageProps } from './types';

export function ModernReportsHealthPage({
  reports,
  health,
  salesDiscovery,
}: ModernReportsHealthPageProps) {
  return (
    <ModernPage>
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <ModernSection>
          <ModernSectionHeader
            eyebrow="Raporlar ve sağlık"
            title="Export, ilişki sağlığı ve read-only discovery"
            description="Bu yüzey rapor exportlarını, kritik runtime ilişkilerini ve henüz üretime alınmamış satış discovery notlarını aynı yerde toplar."
          />
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {reports.map((report) => (
              <ModernCard key={report.id} className="bg-white">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{report.label}</p>
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-50 text-sky-700">
                    <Activity className="h-4 w-4" />
                  </span>
                </div>
                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  <div className="flex items-center justify-between">
                    <span>Alım</span>
                    <strong className="text-slate-900">{report.summary.purchased_count}</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Satış</span>
                    <strong className="text-slate-900">{report.summary.sold_count}</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Kâr</span>
                    <strong className="text-slate-900">{formatMoney(report.summary.total_profit_dkk)}</strong>
                  </div>
                </div>
                <p className="mt-4 text-xs text-slate-500">
                  {formatDate(report.summary.period_start)} - {formatDate(report.summary.period_end)}
                </p>
                <div className="mt-4">
                  {report.availability && report.availability.state !== 'available' ? (
                    <AvailabilityBanner availability={report.availability} />
                  ) : (
                    <ModernButton tone="ghost" icon={Download} onClick={report.onExport} disabled={!report.onExport}>
                      XLSX al
                    </ModernButton>
                  )}
                </div>
              </ModernCard>
            ))}
          </div>
        </ModernSection>

        <ModernSection>
          <ModernSectionHeader title="Read-only satış discovery" description="Gerçek satış modülü yerine yalnız doğrulanmış keşif ve karar notları gösterilir." />
          <div className="mt-4 space-y-4">
            <AvailabilityBanner availability={salesDiscovery.availability} />
            <ModernStat label="Durum" value={salesDiscovery.availability.state === 'readonly' ? 'Yalnız okunur' : 'Kısıtlı'} meta={salesDiscovery.summary} icon={SearchCode} tone="warning" />
            {salesDiscovery.lastReviewed ? (
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Son gözden geçirme: {formatDate(salesDiscovery.lastReviewed)}
              </p>
            ) : null}
            <div className="space-y-3">
              {salesDiscovery.findings.map((finding) => (
                <div key={finding.id} className="rounded-[20px] border border-slate-200 bg-slate-50/70 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-900">{finding.title}</p>
                    <ModernBadge tone={finding.tone || toneForText(finding.status)}>{finding.status}</ModernBadge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{finding.note}</p>
                </div>
              ))}
            </div>
          </div>
        </ModernSection>
      </div>

      <ModernSection>
        <ModernSectionHeader title="Runtime ilişki sağlığı" description="Fragile ve broken bağlantılar bu görünümde saklanmaz." />
        <div className="mt-4">
          <ModernDataTable
            items={health}
            getRowKey={(item) => item.id}
            columns={[
              {
                key: 'relation',
                header: 'İlişki',
                cell: (item) => (
                  <div>
                    <p className="font-medium text-slate-900">{item.source}</p>
                    <p className="text-xs text-slate-500">{item.target}</p>
                  </div>
                ),
              },
              {
                key: 'detail',
                header: 'Detay',
                cell: (item) => item.detail,
              },
              {
                key: 'status',
                header: 'Sağlık',
                align: 'right',
                cell: (item) => <ModernBadge tone={item.tone || toneForText(item.status)}>{item.status}</ModernBadge>,
              },
            ]}
          />
        </div>
      </ModernSection>
    </ModernPage>
  );
}
