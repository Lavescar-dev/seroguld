import { AlertTriangle, Eye, RefreshCw, ShieldAlert } from 'lucide-react';

import { ModernBadge, ModernButton, ModernDataTable, ModernPage, ModernSection, ModernSectionHeader, ModernStat } from '@/modern/design-system';

import { AvailabilityBanner, DetailGrid, formatDate, toneForRisk, toneForText } from './shared';
import type { ModernOpmcDetailPageProps, ModernOpmcListPageProps } from './types';

export function ModernOpmcListPage({
  source,
  generatedAt,
  summary,
  items,
  availability,
  onRefresh,
}: ModernOpmcListPageProps) {
  return (
    <ModernPage>
      <ModernSection>
        <ModernSectionHeader
          eyebrow="OPMC / Risk"
          title="Risk kuyruğu ve manuel inceleme görünümü"
          description="Woo siparişlerinden gelen sinyaller burada görünür; doğrulanmamış kararlar başarı gibi gösterilmez."
          action={onRefresh ? <ModernButton tone="ghost" icon={RefreshCw} onClick={onRefresh}>Yenile</ModernButton> : undefined}
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {source ? <ModernBadge tone="info">{source}</ModernBadge> : null}
          {generatedAt ? <ModernBadge tone="neutral">Üretildi: {formatDate(generatedAt)}</ModernBadge> : null}
        </div>
        <div className="mt-4">
          <AvailabilityBanner availability={availability} />
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ModernStat label="Toplam sipariş" value={summary.total_orders} icon={ShieldAlert} />
          <ModernStat label="Yüksek risk" value={summary.high_risk_count} icon={AlertTriangle} tone="danger" />
          <ModernStat label="Orta risk" value={summary.medium_risk_count} icon={AlertTriangle} tone="warning" />
          <ModernStat label="Manuel inceleme" value={summary.manual_review_count} icon={Eye} tone="info" />
        </div>
      </ModernSection>

      <ModernSection>
        <ModernSectionHeader title="Sipariş kuyruğu" description="Detay görünümüne bağlanacak typed liste yüzeyi." />
        <div className="mt-4">
          <ModernDataTable
            items={items}
            getRowKey={(item) => String(item.order_id)}
            columns={[
              {
                key: 'order',
                header: 'Sipariş',
                cell: (item) => (
                  <div>
                    <p className="font-medium text-slate-900">{item.order_number || item.order_id}</p>
                    <p className="text-xs text-slate-500">{item.customer_name || item.customer_email || 'Guest buyer'}</p>
                  </div>
                ),
              },
              {
                key: 'geo',
                header: 'Fatura / teslimat',
                cell: (item) => `${item.billing_country || '-'} / ${item.shipping_country || '-'}`,
              },
              {
                key: 'manual',
                header: 'Manuel',
                cell: (item) => (item.requires_manual_review ? 'Evet' : 'Hayır'),
              },
              {
                key: 'risk',
                header: 'Risk',
                align: 'right',
                cell: (item) => (
                  <ModernBadge tone={toneForRisk(item.risk_score)}>
                    {item.risk_level || 'Belirsiz'} {item.risk_score !== null && item.risk_score !== undefined ? `· ${item.risk_score}` : ''}
                  </ModernBadge>
                ),
              },
            ]}
          />
        </div>
      </ModernSection>
    </ModernPage>
  );
}

export function ModernOpmcDetailPage({
  requestedId,
  detail,
  refreshAvailability,
  onRefresh,
  overrideAvailability,
  onOverride,
}: ModernOpmcDetailPageProps) {
  return (
    <ModernPage>
      <ModernSection>
        <ModernSectionHeader
          eyebrow="OPMC detay"
          title={`Sipariş ${requestedId}`}
          description="Risk nedeni, coğrafi sinyal ve müşteri geçmişi aynı ayrıntı yüzeyinde toplanır."
          action={onRefresh ? <ModernButton tone="ghost" icon={RefreshCw} onClick={onRefresh}>Detayı yenile</ModernButton> : undefined}
        />
        <div className="mt-4">
          <AvailabilityBanner availability={refreshAvailability} />
        </div>
      </ModernSection>

      {detail ? (
        <div className="grid gap-5 2xl:grid-cols-[1.1fr_0.9fr]">
          <DetailGrid
            title="Risk özeti"
            description="Gerçek override kaydı bağlanana kadar karar alanı kontrollü tutulur."
            items={[
              { label: 'Sipariş', value: detail.order_number || detail.order_id, accent: true },
              { label: 'Durum', value: detail.status },
              { label: 'Risk skoru', value: detail.risk_score ?? '—', accent: true },
              { label: 'Kaynak', value: detail.risk_score_source || 'unknown' },
              { label: 'Müşteri', value: detail.customer_name || detail.customer_email || 'Guest buyer' },
              { label: 'Toplam', value: detail.total || '—' },
              { label: 'Fatura ülke/şehir', value: `${detail.billing_country || '-'} / ${detail.billing_city || '-'}` },
              { label: 'Teslimat ülke/şehir', value: `${detail.shipping_country || '-'} / ${detail.shipping_city || '-'}` },
            ]}
          />

          <ModernSection>
            <ModernSectionHeader title="Karar alanı" description="Override mümkün değilse yüzey bunu açıkça söyler." />
            <div className="mt-4 space-y-3">
              <AvailabilityBanner availability={overrideAvailability} />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(['low', 'medium', 'high'] as const).map((level) => (
                  <ModernButton
                    key={level}
                    tone={level === 'high' ? 'danger' : level === 'medium' ? 'warning' : 'success'}
                    onClick={() => onOverride?.(level)}
                    disabled={!onOverride || overrideAvailability?.state !== 'available'}
                  >
                    {level === 'high' ? 'Yüksek risk' : level === 'medium' ? 'Orta risk' : 'Düşük risk'}
                  </ModernButton>
                ))}
              </div>
            </div>
          </ModernSection>
        </div>
      ) : (
        <AvailabilityBanner
          availability={{
            state: 'unavailable',
            title: 'Risk detayı alınamadı.',
            description: 'Detay view model sağlanmadan bu yüzey yalnız kabuk olarak bırakılır.',
          }}
        />
      )}

      {detail ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <ModernSection>
            <ModernSectionHeader title="Risk nedenleri" />
            <div className="mt-4 space-y-3">
              {detail.risk_reasons.length > 0 ? (
                detail.risk_reasons.map((reason) => (
                  <div key={reason.code} className="rounded-[20px] border border-slate-200 bg-slate-50/70 px-4 py-3">
                    <p className="text-sm font-medium text-slate-900">{reason.reason}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">{reason.code}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">Risk nedeni kaydı yok.</p>
              )}
            </div>
          </ModernSection>

          <ModernSection>
            <ModernSectionHeader title="Meta ve geçmiş" />
            <div className="mt-4 space-y-3">
              <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 px-4 py-3">
                <p className="text-sm font-medium text-slate-900">Müşteri geçmişi</p>
                <p className="mt-2 text-sm text-slate-600">
                  {detail.customer_history
                    ? `${detail.customer_history.total_orders} sipariş · güvenli eşleşme: ${detail.customer_history.known_safe ? 'evet' : 'hayır'}`
                    : 'Geçmiş kaydı yok.'}
                </p>
              </div>
              {detail.notes_human.map((note, index) => (
                <div key={`${note}-${index}`} className="rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                  {note}
                </div>
              ))}
              {detail.risk_meta_human.map((field) => (
                <div key={field.key} className="rounded-[20px] border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{field.label}</p>
                  <p className="mt-1 text-sm text-slate-700">{field.value}</p>
                </div>
              ))}
            </div>
          </ModernSection>
        </div>
      ) : null}
    </ModernPage>
  );
}
