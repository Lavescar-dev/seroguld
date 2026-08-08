import { useState } from 'react';
import { Activity, Building2, CheckCircle2, FileCheck2, RefreshCw, RotateCcw, Send, TriangleAlert } from 'lucide-react';

import {
  ModernBadge,
  ModernButton,
  ModernCard,
  ModernDataTable,
  ModernPage,
  ModernSection,
  ModernSectionHeader,
  ModernStat,
  type ModernTone,
} from '@/modern/design-system';

import { AvailabilityBanner, DetailGrid, formatDate, formatMoney, TimelineList, toneForText } from './shared';
import type { ModernUnicontaPageProps } from './types';

type UnicontaTab = 'reconciliation' | 'outbox' | 'delivery' | 'connection';

const tabLabels: Array<{ id: UnicontaTab; label: string }> = [
  { id: 'reconciliation', label: 'Mutabakat' },
  { id: 'outbox', label: 'Outbox' },
  { id: 'delivery', label: 'Belge Teslimi' },
  { id: 'connection', label: 'Bağlantı' },
];

function connectionTone(value: string): ModernTone {
  if (value === 'bagli') return 'success';
  if (value === 'hata') return 'danger';
  if (value === 'yukleniyor') return 'info';
  return 'warning';
}

function connectionLabel(value: string): string {
  if (value === 'bagli') return 'Bağlı';
  if (value === 'hata') return 'Hata';
  if (value === 'yukleniyor') return 'Yükleniyor';
  return 'Bağlı değil';
}

function stateBadge(value: string, tone: ModernTone = toneForText(value)) {
  return <ModernBadge tone={tone}>{value}</ModernBadge>;
}

export function ModernUnicontaPage({
  connectionStatus,
  config,
  connectionInfo,
  invoices,
  syncSummary,
  failedSyncs,
  health,
  selectedInvoice,
  stats,
  connectAvailability,
  retryAvailability,
  onConnect,
  onRefresh,
  onSelectInvoice,
  onRetryAll,
  onRetryFailed,
}: ModernUnicontaPageProps) {
  const [activeTab, setActiveTab] = useState<UnicontaTab>('reconciliation');
  const deliveredCount = stats?.eFakturaGonderildi ?? invoices.filter((invoice) => Boolean(invoice.eFakturaSendt)).length;
  const invoiceCount = stats?.toplam ?? invoices.length;
  const selected = selectedInvoice || invoices[0] || null;
  const auditItems = [
    {
      id: 'health',
      title: 'Uniconta health',
      detail: health?.last_call_ok === true ? 'Son çağrı başarılı' : health?.last_call_ok === false ? 'Son çağrı başarısız' : 'Son çağrı sonucu henüz yok',
      timestamp: health?.last_call_at ? formatDate(health.last_call_at) : undefined,
      tone: health?.last_call_ok === true ? 'success' as const : health?.last_call_ok === false ? 'danger' as const : 'warning' as const,
    },
    {
      id: 'outbox',
      title: 'Outbox durumu',
      detail: syncSummary ? `${syncSummary.pending} bekleyen · ${syncSummary.failed} başarısız` : 'Sync özeti bekleniyor',
      timestamp: syncSummary?.last_synced_at ? formatDate(syncSummary.last_synced_at) : undefined,
      tone: (syncSummary?.failed ?? 0) > 0 ? 'danger' as const : 'info' as const,
    },
  ];

  return (
    <ModernPage>
      <ModernSection className="bg-sg-surface-soft">
        <ModernSectionHeader
          eyebrow="Finans ve entegrasyon"
          title="Uniconta Mutabakatı"
          description="Yerel AFG ve uzak fatura görünürlüğünü, outbox idempotency ve teslim kanıtıyla aynı çalışma alanında tutar."
          action={
            <div className="flex flex-wrap gap-2">
              <ModernButton tone="ghost" icon={RefreshCw} onClick={onRefresh} disabled={!onRefresh}>Yenile</ModernButton>
              <ModernButton tone="primary" icon={Building2} onClick={onConnect} disabled={!onConnect || connectAvailability?.state === 'unavailable'}>
                Bağlantıyı test et
              </ModernButton>
            </div>
          }
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ModernStat
            label="Mutabık belge"
            value={invoiceCount}
            meta={stats ? `${stats.toplamKredit} kredi notu` : 'Gerçek fatura listesi'}
            icon={FileCheck2}
            tone="success"
          />
          <ModernStat
            label="Outbox bekleyen"
            value={syncSummary?.pending ?? 0}
            meta={syncSummary ? `${syncSummary.period_hours} saatlik pencere` : 'Sync özeti bekleniyor'}
            icon={RotateCcw}
            tone={(syncSummary?.pending ?? 0) > 0 ? 'warning' : 'neutral'}
          />
          <ModernStat
            label="Teslim edilen belge"
            value={deliveredCount}
            meta={stats ? `${stats.mailGonderildi} e-posta kaydı` : 'Gerçek teslim alanı'}
            icon={Send}
            tone="info"
          />
          <ModernStat
            label="Finansal fark"
            value={<ModernBadge tone="info">DISCOVERY</ModernBadge>}
            meta="Parity payloadı mevcut DTO'da expose edilmiyor"
            icon={TriangleAlert}
            tone="info"
          />
        </div>
        <div className="mt-4 space-y-3">
          <AvailabilityBanner availability={connectAvailability} />
          <AvailabilityBanner availability={retryAvailability} />
        </div>
      </ModernSection>

      <div className="flex flex-wrap gap-1 rounded-sg-lg border border-sg-border bg-sg-surface-soft p-1">
        {tabLabels.map((tab) => (
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

      {activeTab === 'reconciliation' ? (
        <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <ModernSection className="min-w-0">
            <ModernSectionHeader
              title="Yerel ↔ Uzak mutabakat"
              description="AFG/fatura kimliği, business key ve teslim alanları gerçek fatura DTO'sundan okunur."
              action={<ModernBadge tone="info">B1 + B2 görünürlüğü</ModernBadge>}
            />
            <div className="mt-4">
              <ModernDataTable
                items={invoices}
                getRowKey={(item) => item.id}
                emptyTitle="Mutabakat satırı bulunmuyor"
                emptyDescription="Uniconta fatura endpoint'i gerçek satır döndürdüğünde çalışma listesi burada açılır."
                columns={[
                  {
                    key: 'document',
                    header: 'AFG / remote',
                    cell: (item) => (
                      <div>
                        <p className="font-semibold text-sg-text">{item.fakturanummer}</p>
                        <p className="mt-1 text-xs text-sg-text-soft">{item.ordrenummer || item.id}</p>
                      </div>
                    ),
                  },
                  { key: 'local', header: 'Yerel', cell: (item) => formatMoney(item.total) },
                  { key: 'remote', header: 'Uniconta', cell: (item) => item.unicontaRef || '—' },
                  { key: 'difference', header: 'Fark', cell: () => stateBadge('DISCOVERY', 'info') },
                  {
                    key: 'status',
                    header: 'Durum',
                    cell: (item) => stateBadge(item.unicontaRef ? 'Mutabık' : 'İnceleme', item.unicontaRef ? 'success' : 'warning'),
                  },
                  {
                    key: 'detail',
                    header: 'Detay',
                    align: 'right',
                    cell: (item) => onSelectInvoice ? (
                      <ModernButton tone="ghost" size="sm" onClick={() => onSelectInvoice(item)}>Aç</ModernButton>
                    ) : <ModernBadge tone="neutral">Read-only</ModernBadge>,
                  },
                ]}
              />
            </div>
          </ModernSection>

          <div className="space-y-5">
            <DetailGrid
              title={selected ? `AFG · ${selected.fakturanummer}` : 'Fatura detayı'}
              description="Satır seçimi aynı route içinde detay çalışma alanını günceller."
              items={selected ? [
                { label: 'Müşteri', value: selected.kunde.navn, accent: true },
                { label: 'Tarih', value: formatDate(selected.fakturadato) },
                { label: 'Yerel net', value: formatMoney(selected.subtotal) },
                { label: 'Toplam', value: formatMoney(selected.total), accent: true },
                { label: 'Business key', value: selected.ordrenummer || selected.id },
                { label: 'Belge teslimi', value: selected.eFakturaSendt || selected.mailSendt || 'Bekliyor' },
              ] : [{ label: 'Durum', value: 'Fatura seçimi bekleniyor', accent: true }]}
            />
            <ModernSection>
              <ModernSectionHeader title="Contract health" description="Backend DTO'sunda olmayan başarılar otomatik PASS gösterilmez." />
              <div className="mt-4 grid gap-3">
                <div className="flex items-center justify-between rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3">
                  <div><p className="text-sm font-semibold text-sg-text">B1 · Local net parity</p><p className="mt-1 text-xs text-sg-text-soft">İki taraflı net toplam alanı bekleniyor.</p></div>
                  {stateBadge('DISCOVERY', 'info')}
                </div>
                <div className="flex items-center justify-between rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3">
                  <div><p className="text-sm font-semibold text-sg-text">B2 · Outbox idempotency</p><p className="mt-1 text-xs text-sg-text-soft">Stable business key kanıtı bu yüzeyde yok.</p></div>
                  {stateBadge('DISCOVERY', 'info')}
                </div>
                <div className="flex items-center justify-between rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3">
                  <div><p className="text-sm font-semibold text-sg-text">Correction / credit</p><p className="mt-1 text-xs text-sg-text-soft">İş kuralı onayı olmadan aksiyon açılmaz.</p></div>
                  {stateBadge('DISCOVERY', 'warning')}
                </div>
              </div>
            </ModernSection>
          </div>
        </div>
      ) : null}

      {activeTab === 'outbox' ? (
        <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
          <ModernSection className="min-w-0">
            <ModernSectionHeader title="Outbox ve retry journal" description="Sadece backend'in döndürdüğü başarısız sync satırları aksiyon alabilir." />
            <div className="mt-4">
              <ModernDataTable
                items={failedSyncs}
                getRowKey={(item) => String(item.sequence_no)}
                emptyTitle="Outbox hatası yok"
                emptyDescription="Retry için gerçek hata satırı gerektiğinden boş kuyruk başarı gibi boyanmaz."
                columns={[
                  { key: 'document', header: 'Belge', cell: (item) => <><p className="font-semibold text-sg-text">#{item.sequence_no}</p><p className="mt-1 text-xs text-sg-text-soft">{item.document_number || 'Belge no yok'}</p></> },
                  { key: 'customer', header: 'Müşteri', cell: (item) => item.customer_name || '—' },
                  { key: 'amount', header: 'Tutar', cell: (item) => item.gross_amount_dkk || '—' },
                  { key: 'error', header: 'Hata', cell: (item) => item.uniconta_sync_error || '—' },
                  { key: 'action', header: 'Aksiyon', align: 'right', cell: (item) => onRetryFailed ? <ModernButton tone="ghost" size="sm" onClick={() => onRetryFailed(item.sequence_no)}>Tekrar dene</ModernButton> : <ModernBadge tone="warning">Read-only</ModernBadge> },
                ]}
              />
            </div>
          </ModernSection>
          <div className="space-y-5">
            <DetailGrid
              title="Sync özeti"
              items={syncSummary ? [
                { label: 'Toplam', value: syncSummary.total, accent: true },
                { label: 'Başarılı', value: syncSummary.synced },
                { label: 'Başarısız', value: syncSummary.failed },
                { label: 'Bekleyen', value: syncSummary.pending },
                { label: 'Atlanan', value: syncSummary.skipped },
                { label: 'Son sync', value: syncSummary.last_synced_at ? formatDate(syncSummary.last_synced_at) : '—' },
              ] : [{ label: 'Durum', value: 'Sync özeti bekleniyor', accent: true }]}
            />
            <AvailabilityBanner availability={retryAvailability} action={onRetryAll ? <ModernButton tone="warning" onClick={onRetryAll}>Tümünü tekrar dene</ModernButton> : undefined} />
          </div>
        </div>
      ) : null}

      {activeTab === 'delivery' ? (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <ModernSection>
            <ModernSectionHeader title="Belge teslim zinciri" description="Yerel kayıt → Uniconta referansı → belge/e-posta kanıtı." />
            <div className="mt-4 space-y-3">
              {[
                { label: 'Yerel AFG / transaction', value: selected ? 'Mevcut' : 'Bekliyor', tone: selected ? 'success' as const : 'warning' as const, detail: selected ? selected.fakturanummer : 'Fatura seçimi yok' },
                { label: 'Uniconta outbox', value: selected?.unicontaRef ? 'Referans mevcut' : 'DISCOVERY', tone: selected?.unicontaRef ? 'success' as const : 'info' as const, detail: selected?.unicontaRef || 'Stable key / remote ref DTO’da yok' },
                { label: 'PDF / e-fatura', value: selected?.eFakturaSendt || 'DISCOVERY', tone: selected?.eFakturaSendt ? 'success' as const : 'info' as const, detail: selected?.eFakturaSendt ? formatDate(selected.eFakturaSendt) : 'Kanonik PDF teslim alanı expose değil' },
                { label: 'E-posta', value: selected?.mailSendt || 'Kapalı', tone: selected?.mailSendt ? 'success' as const : 'neutral' as const, detail: config?.sendEmailOnFinalize || connectionInfo?.sendEmailOnFinalize ? 'Konfigürasyonda açık' : 'Konfigürasyonda kapalı' },
              ].map((step) => (
                <div key={step.label} className="flex items-center justify-between gap-4 rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sg-surface ring-1 ring-sg-border"><CheckCircle2 className="h-4 w-4 text-sg-green" /></span><div className="min-w-0"><p className="text-sm font-semibold text-sg-text">{step.label}</p><p className="mt-1 truncate text-xs text-sg-text-soft">{step.detail}</p></div></div>
                  {stateBadge(step.value, step.tone)}
                </div>
              ))}
            </div>
          </ModernSection>
          <TimelineList items={auditItems} title="Son audit" description="Health ve sync olayları mevcut hook çıktısından okunur." />
        </div>
      ) : null}

      {activeTab === 'connection' ? (
        <div className="grid min-w-0 gap-5 xl:grid-cols-2">
          <DetailGrid
            title="Bağlantı durumu"
            items={[
              { label: 'Durum', value: stateBadge(connectionLabel(connectionStatus), connectionTone(connectionStatus)), accent: true },
              { label: 'Company ID', value: connectionInfo?.companyId || config?.companyId || '—' },
              { label: 'Ortam', value: connectionInfo?.env || config?.env || '—' },
              { label: 'E-posta finalize', value: (config?.sendEmailOnFinalize ?? connectionInfo?.sendEmailOnFinalize) ? 'Açık' : 'Kapalı' },
              { label: 'XML finalize', value: (config?.sendXmlOnFinalize ?? connectionInfo?.sendXmlOnFinalize) ? 'Açık' : 'Kapalı' },
            ]}
          />
          <DetailGrid
            title="Token ve health"
            items={health ? [
              { label: 'Configured', value: health.configured ? 'Evet' : 'Hayır', accent: true },
              { label: 'Token', value: health.has_token ? 'Mevcut' : 'Yok' },
              { label: 'Son çağrı', value: health.last_call_at ? formatDate(health.last_call_at) : '—' },
              { label: 'Sonuç', value: health.last_call_ok === null || health.last_call_ok === undefined ? '—' : health.last_call_ok ? 'OK' : 'Hata' },
              { label: 'Süre sonu', value: health.access_expires_at ? formatDate(health.access_expires_at) : '—' },
            ] : [{ label: 'Health', value: 'Backend health yanıtı bekleniyor', accent: true }]}
          />
        </div>
      ) : null}

      {activeTab !== 'connection' ? <div className="flex items-center gap-2 text-xs text-sg-text-soft"><Activity className="h-3.5 w-3.5" /> Mutabakat ve teslim aksiyonları gerçek API durumuna göre sınırlıdır.</div> : null}
    </ModernPage>
  );
}
