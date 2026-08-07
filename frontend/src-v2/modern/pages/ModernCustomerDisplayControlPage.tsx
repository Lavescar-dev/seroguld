import { Monitor, MonitorOff, RefreshCw, ShieldCheck } from 'lucide-react';

import { ModernBadge, ModernButton, ModernCard, ModernPage, ModernSection, ModernSectionHeader, ModernStat } from '@/modern/design-system';

import { AvailabilityBanner, DetailGrid, StatusGrid, formatDate, labelDocumentKind, labelStatus, toneForText } from './shared';
import type { ModernCustomerDisplayControlPageProps } from './types';

export function ModernCustomerDisplayControlPage({
  status,
  snapshot,
  runtime,
  previewAvailability,
  onOpenWindow,
  onPreview,
  onRevoke,
}: ModernCustomerDisplayControlPageProps) {
  return (
    <ModernPage>
      <ModernSection>
        <ModernSectionHeader
          eyebrow="Müşteri ekranı"
          title="İkinci ekran kontrol yüzeyi"
          description="Public DTO değişmeden, kiosk token ve canlı snapshot görünürlüğü operatör tarafında yoğun fakat sakin bir layout ile taşınır."
          action={
            <div className="flex flex-wrap gap-2">
              <ModernButton tone="ghost" icon={RefreshCw} onClick={onPreview} disabled={previewAvailability?.state === 'unavailable'}>
                Önizlemeyi yenile
              </ModernButton>
              <ModernButton tone="primary" icon={Monitor} onClick={onOpenWindow}>
                Pencereyi aç
              </ModernButton>
            </div>
          }
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ModernStat label="Bağlantı" value={status.connection} icon={status.connection === 'live' ? ShieldCheck : MonitorOff} tone={toneForText(status.connection)} />
          <ModernStat label="Pencere" value={status.windowState} icon={Monitor} tone={toneForText(status.windowState)} />
          <ModernStat label="Token" value={status.token ? 'Aktif' : 'Yok'} icon={ShieldCheck} tone={status.token ? 'success' : 'warning'} />
          <ModernStat label="Snapshot" value={snapshot ? snapshot.session_code : 'Bekleniyor'} icon={Monitor} />
        </div>
        <div className="mt-4">
          <AvailabilityBanner availability={previewAvailability} action={onRevoke ? <ModernButton tone="danger" onClick={onRevoke}>Tokenı geri al</ModernButton> : undefined} />
        </div>
      </ModernSection>

      <div className="grid gap-5 2xl:grid-cols-[1.1fr_0.9fr]">
        <DetailGrid
          title="Canlı snapshot özeti"
          description="Kiosk yüzeyinde gösterilecek veri, operatör tarafında maskeli ve readonly görünür."
          items={
            snapshot
              ? [
                  { label: 'Session', value: snapshot.session_code, accent: true },
                  { label: 'Belge', value: snapshot.document_number || '—' },
                  { label: 'Durum', value: labelStatus(snapshot.status), accent: true },
                  { label: 'Doküman tipi', value: labelDocumentKind(snapshot.document_kind) },
                  { label: 'Müşteri', value: snapshot.customer_name || '—' },
                  { label: 'Satır', value: snapshot.line_count },
                  { label: 'Toplam teklif', value: snapshot.final_offer_dkk || snapshot.lines_total_dkk || '—' },
                  { label: 'Son güncelleme', value: formatDate(snapshot.updated_at) },
                ]
              : [{ label: 'Durum', value: 'Henüz snapshot yok', accent: true }]
          }
        />

        <ModernSection>
          <ModernSectionHeader title="Runtime görünürlüğü" description="Çift monitör, heartbeat ve preview yüzeyi için temel kontroller." />
          <div className="mt-4">
            <StatusGrid items={runtime} />
          </div>
        </ModernSection>
      </div>

      <ModernSection>
        <ModernSectionHeader title="Public görünüm notu" description="Operatör yüzeyi gerçek customer display skin yerine onun kontrol ve güven durumunu gösterir." />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <ModernCard className="bg-white">
            <p className="text-sm font-medium text-slate-900">Heartbeat</p>
            <p className="mt-2 text-sm text-slate-500">{status.lastHeartbeat ? formatDate(status.lastHeartbeat) : 'Henüz sinyal yok'}</p>
          </ModernCard>
          <ModernCard className="bg-white">
            <p className="text-sm font-medium text-slate-900">Son önizleme</p>
            <p className="mt-2 text-sm text-slate-500">{status.lastPreviewAt ? formatDate(status.lastPreviewAt) : 'Henüz alınmadı'}</p>
          </ModernCard>
          <ModernCard className="bg-white">
            <p className="text-sm font-medium text-slate-900">Kiosk güveni</p>
            <div className="mt-2">
              <ModernBadge tone={status.connection === 'live' ? 'success' : 'warning'}>
                {status.connection === 'live' ? 'Canlı' : 'Kontrol gerekli'}
              </ModernBadge>
            </div>
          </ModernCard>
        </div>
      </ModernSection>
    </ModernPage>
  );
}
