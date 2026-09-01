import { useState } from 'react';
import { AlertTriangle, Eye, RefreshCw, ShieldAlert, UserRound } from 'lucide-react';

import {
  ModernBadge,
  ModernButton,
  ModernCard,
  ModernPage,
  ModernSection,
  ModernSectionHeader,
  ModernStat,
  ModernTextarea,
  ModernUnavailableState,
  ModernField,
} from '@/modern/design-system';

import { AvailabilityBanner, DetailGrid, formatDate, formatMoney, toneForRisk } from './shared';
import { formatOrderStatus, riskSourceLabel } from '@/components/OpmcShared';
import type { ModernOpmcDetailPageProps, ModernOpmcListPageProps } from './types';

type OpmcTab = 'queue' | 'history';

function riskAverage(items: ModernOpmcListPageProps['items']): number | string {
  const scores = items.map((item) => item.risk_score).filter((score): score is number => typeof score === 'number');
  return scores.length > 0 ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : '—';
}

export function ModernOpmcListPage({
  generatedAt,
  summary,
  items,
  availability,
  isLoading = false,
  onRefresh,
  days,
  onDaysChange,
  riskFilter,
  onRiskFilterChange,
  statusFilter,
  onStatusFilterChange,
  manualOnly,
  onManualOnlyChange,
}: ModernOpmcListPageProps) {
  const [activeTab, setActiveTab] = useState<OpmcTab>('queue');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  // Kullanıcı kuyruğun herhangi bir vakasını sağ panelde inceleyebilmeli;
  // seçim görünür listeden düşerse ilk kayda dönülür.
  const average = riskAverage(items);
  const hasFilters = Boolean(onRiskFilterChange || onStatusFilterChange || onManualOnlyChange || onDaysChange);
  const whitelistCount = items.filter((item) => item.is_whitelisted).length;
  const overrideCount = items.filter((item) => item.has_manual_override).length;
  const queueItems = items.filter((item) =>
    item.review_queue_status ? item.review_queue_status === 'active' : item.requires_manual_review,
  );
  const historyItems = items.filter((item) => item.review_queue_status === 'historical');
  const visibleItems = activeTab === 'history' ? historyItems : queueItems;
  const selected = visibleItems.find((item) => String(item.order_id) === selectedOrderId) || visibleItems[0] || null;

  if (isLoading && items.length === 0) {
    return (
      <ModernPage>
        <ModernSection>
          <ModernSectionHeader eyebrow="Risk ve karar" title="OPMC / Anti-fraud" description="Risk kuyruğu yükleniyor." />
          <div className="mt-5"><ModernUnavailableState title="OPMC verisi yükleniyor" description="Bağlantı kurulduğunda inceleme kuyruğu burada listelenir." /></div>
        </ModernSection>
      </ModernPage>
    );
  }

  return (
    <ModernPage>
      <ModernSection className="bg-sg-surface-soft">
        <ModernSectionHeader
          eyebrow="Risk ve karar"
          title="OPMC / Anti-fraud"
          description="Risk sinyallerini kaynak ve gerekçeyle izlenebilir karar çalışma alanına dönüştürür."
          action={onRefresh ? <ModernButton tone="ghost" icon={RefreshCw} onClick={onRefresh}>Riskleri yenile</ModernButton> : undefined}
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {generatedAt ? <ModernBadge tone="neutral">Üretildi: {formatDate(generatedAt)}</ModernBadge> : null}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ModernStat label="İnceleme kuyruğu" value={summary.active_review_count} meta={`${summary.historical_review_count} geçmiş sinyal`} icon={ShieldAlert} tone="danger" />
          <ModernStat label="Ortalama risk skoru" value={average} meta={`${summary.high_risk_count} yüksek risk`} icon={AlertTriangle} tone="warning" />
          <ModernStat label="Whitelist" value={whitelistCount} meta={`${summary.low_risk_count} düşük risk`} icon={Eye} tone="info" />
          <ModernStat label="Manuel override" value={overrideCount} meta="Operatör kararı" icon={UserRound} tone="info" />
        </div>
        <div className="mt-4"><AvailabilityBanner availability={availability} /></div>
      </ModernSection>

      <div className="flex flex-wrap gap-1 rounded-sg-lg border border-sg-border bg-sg-surface-soft p-1">
        {[
          { id: 'queue' as const, label: 'İnceleme kuyruğu' },
          { id: 'history' as const, label: 'Geçmiş sinyaller' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={activeTab === tab.id ? 'rounded-sg-md bg-sg-surface px-4 py-2 text-xs font-semibold text-sg-accent shadow-sg-sm' : 'rounded-sg-md px-4 py-2 text-xs font-semibold text-sg-text-soft hover:bg-sg-surface'}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'queue' ? (
        <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)]">
          <ModernSection className="min-w-0">
            <ModernSectionHeader title="İnceleme kuyruğu" description="Sıra ve durum OPMC sipariş verisinden gelir." />
            {hasFilters ? (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                {onDaysChange ? (
                  <label className="text-xs font-semibold text-sg-text-soft">Gün penceresi
                    <input
                      type="number"
                      min={1}
                      value={days ?? 30}
                      onChange={(event) => onDaysChange(Number(event.target.value) || 30)}
                      className="mt-1 block w-24 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none"
                    />
                  </label>
                ) : null}
                {onRiskFilterChange ? (
                  <label className="text-xs font-semibold text-sg-text-soft">Risk
                    <select value={riskFilter ?? 'all'} onChange={(event) => onRiskFilterChange(event.target.value as NonNullable<ModernOpmcListPageProps['riskFilter']>)} className="mt-1 block rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none">
                      <option value="all">Tümü</option>
                      <option value="high">Yüksek</option>
                      <option value="medium">Orta</option>
                      <option value="low">Düşük</option>
                      <option value="unknown">Belirsiz</option>
                    </select>
                  </label>
                ) : null}
                {onStatusFilterChange ? (
                  <label className="text-xs font-semibold text-sg-text-soft">Durum
                    <select value={statusFilter ?? 'all'} onChange={(event) => onStatusFilterChange(event.target.value)} className="mt-1 block rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none">
                      <option value="all">Tümü</option>
                      <option value="processing">İşleniyor</option>
                      <option value="pending">Beklemede</option>
                      <option value="completed">Tamamlandı</option>
                      <option value="cancelled">İptal</option>
                    </select>
                  </label>
                ) : null}
                {onManualOnlyChange ? (
                  <label className="text-xs font-semibold text-sg-text-soft">Manuel inceleme
                    <select value={manualOnly ?? 'all'} onChange={(event) => onManualOnlyChange(event.target.value as 'all' | 'yes' | 'no')} className="mt-1 block rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none">
                      <option value="all">Tümü</option>
                      <option value="yes">Yalnız manuel</option>
                      <option value="no">Manuel dışı</option>
                    </select>
                  </label>
                ) : null}
                <ModernBadge tone="neutral">Filtrelenen: {items.length}</ModernBadge>
              </div>
            ) : null}
            <div className="mt-4 space-y-3">
              {visibleItems.length > 0 ? visibleItems.map((item) => {
                const scoreTone = toneForRisk(item.risk_score);
                const isActive = selected ? String(selected.order_id) === String(item.order_id) : false;
                return (
                  <button
                    key={item.order_id}
                    type="button"
                    onClick={() => setSelectedOrderId(String(item.order_id))}
                    className={`block w-full rounded-sg-md border p-4 text-left transition hover:border-sg-accent hover:shadow-sg-sm ${isActive ? 'border-sg-accent bg-sg-accent-soft/40' : 'border-sg-border bg-sg-surface-soft'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="font-semibold text-sg-text">#{item.order_number || item.order_id} · {item.customer_name || 'Misafir alıcı'}</p><p className="mt-1 text-xs text-sg-text-soft">{item.date_created ? formatDate(item.date_created) : '—'} · {formatMoney(item.total)} · {formatOrderStatus(item.status)}</p></div>
                      <ModernBadge tone={scoreTone === 'danger' ? 'danger' : scoreTone === 'warning' ? 'warning' : 'success'} title="Risk skoru 0-100">Risk {item.risk_score ?? '—'}</ModernBadge>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <ModernBadge tone={item.review_queue_status === 'active' ? 'danger' : 'neutral'}>{item.review_queue_status === 'active' ? 'Aktif inceleme' : 'Geçmiş sinyal'}</ModernBadge>
                      <a href={`#/opmc/${item.order_id}`} onClick={(event) => event.stopPropagation()} className="text-sm font-semibold text-sg-accent hover:underline">Detaya git</a>
                    </div>
                  </button>
                );
              }) : <ModernUnavailableState title="İnceleme kuyruğu boş" description="Şu an inceleme bekleyen sipariş yok. Yeni risk sinyalleri burada listelenir." />}
            </div>
          </ModernSection>

          <ModernSection className="min-w-0">
            <ModernSectionHeader title={selected ? `#${selected.order_number || selected.order_id} · Vaka` : 'Vaka'} description="Risk skoru, kaynak ve müşteri geçmişi aynı detay panelinde." action={selected ? <ModernBadge tone={toneForRisk(selected.risk_score)}>{selected.risk_score ?? '—'}</ModernBadge> : undefined} />
            {selected ? (
              <div className="mt-4 space-y-5">
                <div className="h-2 overflow-hidden rounded-full bg-sg-surface-soft"><div className={`h-full rounded-full ${toneForRisk(selected.risk_score) === 'danger' ? 'bg-sg-red' : toneForRisk(selected.risk_score) === 'warning' ? 'bg-sg-amber' : 'bg-sg-green'}`} style={{ width: `${Math.min(Math.max(selected.risk_score ?? 0, 0), 100)}%` }} /></div>
                <DetailGrid title="Vaka özeti" items={[
                  { label: 'Kaynak', value: riskSourceLabel(selected.risk_score_source), accent: true },
                  { label: 'Müşteri geçmişi', value: selected.customer_history ? `${selected.customer_history.total_orders} sipariş` : 'Yok' },
                  { label: 'Fatura / teslimat', value: `${selected.billing_country || '-'} / ${selected.shipping_country || '-'}` },
                  { label: 'Toplam', value: formatMoney(selected.total) },
                  { label: 'Durum', value: formatOrderStatus(selected.status) },
                ]} />
                <ModernSection>
                  <ModernSectionHeader title="Risk sinyalleri" />
                  <div className="mt-4 flex flex-wrap gap-2">{selected.risk_reasons.length > 0 ? selected.risk_reasons.map((reason) => <ModernBadge key={reason.code} tone="danger">{reason.reason}</ModernBadge>) : <ModernBadge tone="neutral">Sinyal yok</ModernBadge>}</div>
                </ModernSection>
              </div>
            ) : <div className="mt-5"><ModernUnavailableState title="Vaka seçilmedi" description="Soldan bir vaka seçin; detay burada açılır." /></div>}
          </ModernSection>
        </div>
      ) : null}

      {activeTab === 'history' ? (
        <ModernSection>
          <ModernSectionHeader title="Geçmiş risk sinyalleri" description="Tamamlanan siparişlerin risk kaydı burada saklanır; aktif kuyruğa girmez." />
          <div className="mt-4 space-y-3">
            {visibleItems.length > 0 ? visibleItems.map((item) => <a key={item.order_id} href={`#/opmc/${item.order_id}`} className="block rounded-sg-md border border-sg-border bg-sg-surface-soft p-4"><p className="font-semibold text-sg-text">#{item.order_number || item.order_id} · {item.customer_name || 'Misafir alıcı'}</p><p className="mt-1 text-xs text-sg-text-soft">{formatOrderStatus(item.status)} · Risk {item.risk_score ?? '—'}</p></a>) : <ModernUnavailableState title="Geçmiş sinyal yok" description="Tamamlanmış ve inceleme gerektiren sipariş bulunamadı." />}
          </div>
        </ModernSection>
      ) : null}
    </ModernPage>
  );
}

export function ModernOpmcDetailPage({
  requestedId,
  detail,
  isLoading = false,
  refreshAvailability,
  onRefresh,
  overrideAvailability,
  onOverride,
}: ModernOpmcDetailPageProps) {
  const [reason, setReason] = useState('');
  const canOverride = Boolean(onOverride && reason.trim() && overrideAvailability?.state === 'available');

  if (isLoading && !detail) {
    return <ModernPage><ModernSection><ModernSectionHeader eyebrow="Risk ve karar · detay" title={`Sipariş ${requestedId || '—'}`} description="Vaka detayı yükleniyor." /><div className="mt-5"><ModernUnavailableState title="Vaka detayı yükleniyor" description="Bağlantı kurulduğunda vaka bilgileri burada açılır." /></div></ModernSection></ModernPage>;
  }

  return (
    <ModernPage>
      <ModernSection className="bg-sg-surface-soft">
        <ModernSectionHeader eyebrow="Risk ve karar · detay" title={detail ? `#${detail.order_number || requestedId} · ${detail.review_queue_status === 'historical' ? 'Geçmiş risk kaydı' : detail.review_queue_status === 'active' ? 'Aktif vaka' : 'Değerlendirme'}` : `Sipariş ${requestedId || '—'}`} description="Risk nedenleri, müşteri geçmişi ve karar gerekçesi aynı denetlenebilir yüzeyde." action={onRefresh ? <ModernButton tone="ghost" icon={RefreshCw} onClick={onRefresh}>Detayı yenile</ModernButton> : undefined} />
        <div className="mt-4"><AvailabilityBanner availability={refreshAvailability} /></div>
      </ModernSection>

      {detail ? (
        <>
          <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <DetailGrid title="Risk özeti" description="Skor ve kaynak mevcut OPMC sipariş verisinden gelir." items={[
              { label: 'Sipariş', value: detail.order_number || detail.order_id, accent: true },
              { label: 'Durum', value: formatOrderStatus(detail.status) },
              { label: 'Risk skoru', value: detail.risk_score ?? '—', accent: true },
              { label: 'OPMC güven / risk', value: `${detail.opmc_trust_score ?? '—'} / ${detail.opmc_risk_score ?? '—'}` },
              { label: 'Kaynak', value: riskSourceLabel(detail.risk_score_source) },
              { label: 'İnceleme durumu', value: detail.review_queue_status === 'historical' ? 'Geçmiş kayıt' : detail.review_queue_status === 'active' ? 'Aktif inceleme' : 'Değerlendirilmedi' },
              { label: 'Müşteri geçmişi', value: detail.customer_history ? `${detail.customer_history.total_orders} sipariş · ${detail.customer_history.known_safe ? 'güvenli' : 'eşleşme yok'}` : 'Kayıt yok' },
              { label: 'Toplam', value: formatMoney(detail.total) },
              // Dolandırıcılık kararının ana verileri: e-posta, IP ve ödeme yöntemi.
              { label: 'E-posta', value: detail.customer_email || '—' },
              { label: 'IP adresi', value: detail.ip_address || '—' },
              { label: 'Ödeme yöntemi', value: detail.payment_method || '—' },
              { label: 'Fatura / teslimat', value: `${detail.billing_country || '-'} / ${detail.shipping_country || '-'}` },
              { label: 'Sipariş tarihi', value: detail.date_created ? formatDate(detail.date_created) : '—' },
            ]} />

            <ModernSection>
              <ModernSectionHeader title="Manuel karar" description="Karar vermek için gerekçe zorunludur." />
              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-3 rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3"><UserRound className="h-4 w-4 text-sg-accent" /><div><p className="text-sm font-semibold text-sg-text">Oturum operatörü</p><p className="mt-1 text-xs text-sg-text-soft">Kararlar oturum operatörü adına kaydedilir; her işlem denetim kaydına işlenir.</p></div></div>
                <ModernField label="Karar gerekçesi" hint="Boş gerekçeyle override düğmeleri kapalıdır."><ModernTextarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Kanıt ve karar gerekçesini yazın" /></ModernField>
                <AvailabilityBanner availability={overrideAvailability} />
                <div className="grid gap-2 sm:grid-cols-3">
                  {(['low', 'medium', 'high'] as const).map((level) => <ModernButton key={level} tone={level === 'high' ? 'danger' : level === 'medium' ? 'warning' : 'success'} onClick={() => onOverride?.(level, reason.trim())} disabled={!canOverride}>{level === 'high' ? 'Yüksek risk' : level === 'medium' ? 'Orta risk' : 'Düşük risk'}</ModernButton>)}
                </div>
              </div>
            </ModernSection>
          </div>

          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <ModernSection>
              <ModernSectionHeader title="Risk sinyalleri" />
              <div className="mt-4 space-y-3">{detail.risk_reasons.length > 0 ? detail.risk_reasons.map((item) => <div key={item.code} className="flex items-start gap-3 rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sg-red" /><div><p className="text-sm font-semibold text-sg-text">{item.reason}</p></div></div>) : <ModernUnavailableState title="Risk nedeni yok" description="Bu vaka için risk sinyali bulunmuyor." />}</div>
            </ModernSection>
            <ModernSection>
              <ModernSectionHeader title="Meta ve karar geçmişi" />
              <div className="mt-4 space-y-3">
                {detail.notes_human.map((note, index) => <ModernCard key={`${note}-${index}`} className="bg-sg-surface-soft"><p className="text-sm text-sg-text-soft">{note}</p></ModernCard>)}
                {detail.risk_meta_human.map((field) => <ModernCard key={field.key} className="bg-sg-surface-soft"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sg-text-soft">{field.label}</p><p className="mt-1 text-sm text-sg-text">{String(field.value ?? '—')}</p></ModernCard>)}
                {detail.notes_human.length === 0 && detail.risk_meta_human.length === 0 ? <ModernUnavailableState title="Kayıt yok" description="Bu vaka için not veya metadata bulunmuyor." /> : null}
              </div>
            </ModernSection>
          </div>
        </>
      ) : <ModernUnavailableState title="Risk detayı alınamadı" description="Bağlantıyı kontrol edip yeniden deneyin." />}
    </ModernPage>
  );
}
