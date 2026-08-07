import { Building2, Mail, RefreshCw, Send, ShieldAlert } from 'lucide-react';

import { ModernBadge, ModernButton, ModernDataTable, ModernPage, ModernSection, ModernSectionHeader, ModernStat } from '@/modern/design-system';

import { AvailabilityBanner, DetailGrid, formatDate, formatMoney, toneForText } from './shared';
import type { ModernUnicontaPageProps } from './types';

export function ModernUnicontaPage({
  connectionStatus,
  config,
  invoices,
  syncSummary,
  failedSyncs,
  health,
  selectedInvoice,
  connectAvailability,
  retryAvailability,
  onConnect,
  onRefresh,
  onRetryAll,
  onRetryFailed,
}: ModernUnicontaPageProps) {
  return (
    <ModernPage>
      <ModernSection>
        <ModernSectionHeader
          eyebrow="Uniconta"
          title="Mutabakat ve teslim zinciri"
          description="Finans gönderimi yalnız kanıtlı durumda açılır; burada görünürlük ve retry yüzeyleri taşınır."
          action={
            <div className="flex flex-wrap gap-2">
              <ModernButton tone="ghost" icon={RefreshCw} onClick={onRefresh}>Yenile</ModernButton>
              <ModernButton tone="primary" icon={Building2} onClick={onConnect} disabled={connectAvailability?.state === 'unavailable'}>
                Bağlantıyı kontrol et
              </ModernButton>
            </div>
          }
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ModernStat label="Bağlantı" value={connectionStatus} icon={Building2} tone={toneForText(connectionStatus)} />
          <ModernStat label="Kuyruk bekliyor" value={syncSummary?.pending ?? 0} icon={ShieldAlert} tone={(syncSummary?.pending ?? 0) > 0 ? 'warning' : 'neutral'} />
          <ModernStat label="Başarısız" value={syncSummary?.failed ?? 0} icon={Send} tone={(syncSummary?.failed ?? 0) > 0 ? 'danger' : 'success'} />
          <ModernStat label="Mail seçeneği" value={config?.sendEmailOnFinalize ? 'Açık' : 'Kapalı'} icon={Mail} tone="info" />
        </div>
        <div className="mt-4 space-y-3">
          <AvailabilityBanner availability={connectAvailability} />
          <AvailabilityBanner availability={retryAvailability} />
        </div>
      </ModernSection>

      <div className="grid gap-5 2xl:grid-cols-[1.1fr_0.9fr]">
        <ModernSection>
          <ModernSectionHeader
            title="Fatura görünümü"
            description="Gerçek PDF ve e-posta teslimi yerine mutabakat durumu görünür kalır."
          />
          <div className="mt-4">
            <ModernDataTable
              items={invoices}
              getRowKey={(item) => item.id}
              columns={[
                {
                  key: 'invoice',
                  header: 'Fatura',
                  cell: (item) => (
                    <div>
                      <p className="font-medium text-slate-900">{item.fakturanummer}</p>
                      <p className="text-xs text-slate-500">{item.kunde.navn}</p>
                    </div>
                  ),
                },
                {
                  key: 'date',
                  header: 'Tarih',
                  cell: (item) => formatDate(item.fakturadato),
                },
                {
                  key: 'type',
                  header: 'Tip',
                  cell: (item) => item.type,
                },
                {
                  key: 'total',
                  header: 'Toplam',
                  align: 'right',
                  cell: (item) => formatMoney(item.total),
                },
              ]}
            />
          </div>
        </ModernSection>

        <div className="space-y-5">
          <DetailGrid
            title="Bağlantı ve seçili fatura"
            items={
              selectedInvoice
                ? [
                    { label: 'Fatura no', value: selectedInvoice.fakturanummer, accent: true },
                    { label: 'Müşteri', value: selectedInvoice.kunde.navn, accent: true },
                    { label: 'Tip', value: selectedInvoice.type },
                    { label: 'Tarih', value: formatDate(selectedInvoice.fakturadato) },
                    { label: 'Toplam', value: formatMoney(selectedInvoice.total) },
                    { label: 'Valuta', value: selectedInvoice.valuta },
                    { label: 'Mail', value: selectedInvoice.mailSendt || '—' },
                    { label: 'eFaktura', value: selectedInvoice.eFakturaSendt || '—' },
                  ]
                : [
                    { label: 'Bağlantı durumu', value: connectionStatus, accent: true },
                    { label: 'API URL', value: config?.apiUrl || '—' },
                    { label: 'Company ID', value: config?.companyId || '—' },
                    { label: 'Mail finalize', value: config?.sendEmailOnFinalize ? 'Açık' : 'Kapalı' },
                    { label: 'XML finalize', value: config?.sendXmlOnFinalize ? 'Açık' : 'Kapalı' },
                  ]
            }
          />

          {health ? (
            <DetailGrid
              title="Token ve health"
              items={[
                { label: 'Configured', value: health.configured ? 'Evet' : 'Hayır', accent: true },
                { label: 'Token', value: health.has_token ? 'Mevcut' : 'Yok' },
                { label: 'Son çağrı', value: health.last_call_at ? formatDate(health.last_call_at) : '—' },
                { label: 'Çağrı sonucu', value: health.last_call_ok === null ? '—' : health.last_call_ok ? 'OK' : 'Hata' },
                { label: 'Süre sonu', value: health.access_expires_at ? formatDate(health.access_expires_at) : '—' },
              ]}
            />
          ) : null}
        </div>
      </div>

      <ModernSection>
        <ModernSectionHeader
          title="Retry kuyruğu"
          description="Başarısız sync satırları görünür, aksiyon availability ile sınırlandırılır."
          action={onRetryAll ? <ModernButton tone="warning" onClick={onRetryAll}>Tümünü tekrar dene</ModernButton> : undefined}
        />
        <div className="mt-4">
          <ModernDataTable
            items={failedSyncs}
            getRowKey={(item) => String(item.sequence_no)}
            emptyTitle="Başarısız sync bulunmuyor"
            emptyDescription="Bu görünüm için kuyruğa düşen satır görünmedi."
            columns={[
              {
                key: 'seq',
                header: 'Belge',
                cell: (item) => (
                  <div>
                    <p className="font-medium text-slate-900">#{item.sequence_no}</p>
                    <p className="text-xs text-slate-500">{item.document_number || 'Belge no yok'}</p>
                  </div>
                ),
              },
              {
                key: 'customer',
                header: 'Müşteri',
                cell: (item) => item.customer_name || '—',
              },
              {
                key: 'error',
                header: 'Hata',
                cell: (item) => item.uniconta_sync_error || '—',
              },
              {
                key: 'retry',
                header: 'Aksiyon',
                align: 'right',
                cell: (item) =>
                  onRetryFailed ? (
                    <ModernButton tone="ghost" size="sm" onClick={() => onRetryFailed(item.sequence_no)}>
                      Tekrar dene
                    </ModernButton>
                  ) : (
                    <ModernBadge tone="warning">Read-only</ModernBadge>
                  ),
              },
            ]}
          />
        </div>
      </ModernSection>
    </ModernPage>
  );
}
