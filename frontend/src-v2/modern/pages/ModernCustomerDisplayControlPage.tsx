import { Monitor, MonitorOff, RefreshCw, ShieldCheck } from 'lucide-react';

import { ModernBadge, ModernButton, ModernCard, ModernPage, ModernSection, ModernSectionHeader, ModernStat, type ModernTone } from '@/modern/design-system';

import { AvailabilityBanner, DetailGrid, StatusGrid, formatDate, labelDocumentKind, labelStatus } from './shared';
import type { ModernCustomerDisplayControlPageProps } from './types';

// M3 — ham enum değerleri ('live'/'connecting'/'blocked') basılmıyordu; klasik
// önizleme sayfasındaki yerelleştirme kalıbı buraya da uygulanır. 'unknown'
// (köprü yanıtı yok) nötr 'Bilinmiyor' etiketine düşer.
const CONNECTION_LABELS: Record<string, string> = {
  live: 'Canlı bağlı',
  connecting: 'Bağlanıyor',
  offline: 'Beklemede',
};

const WINDOW_STATE_LABELS: Record<string, string> = {
  open: 'Açık',
  closed: 'Kapalı',
  blocked: 'Engelli',
  unknown: 'Bilinmiyor',
};

const CONNECTION_TONES: Record<string, ModernTone> = {
  live: 'success',
  connecting: 'warning',
  offline: 'danger',
};

const WINDOW_STATE_TONES: Record<string, ModernTone> = {
  open: 'success',
  closed: 'neutral',
  blocked: 'danger',
  unknown: 'info',
};

export function ModernCustomerDisplayControlPage({
  status,
  snapshot,
  runtime,
  previewAvailability,
  onOpenWindow,
  onPreview,
  onRevoke,
  revokingToken,
}: ModernCustomerDisplayControlPageProps) {
  // Revoke yalnızca canlı token varken anlamlı; AvailabilityBanner ise tam tersine
  // token yokken render edildiği için aksiyon başlık satırında tutulur.
  const revokeAvailable = Boolean(status.token) && Boolean(onRevoke);
  const connectionLabel = CONNECTION_LABELS[status.connection] ?? status.connection;
  const windowStateLabel = WINDOW_STATE_LABELS[status.windowState] ?? status.windowState;
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
              {onRevoke ? (
                <ModernButton
                  tone="danger"
                  icon={MonitorOff}
                  onClick={onRevoke}
                  disabled={!revokeAvailable || revokingToken}
                  title={
                    revokeAvailable
                      ? 'Açık müşteri ekranı bağlantısını keser ve yeni bir token üretir.'
                      : 'Geri alınacak aktif token yok.'
                  }
                >
                  {revokingToken ? 'Geri alınıyor…' : 'Tokenı geri al'}
                </ModernButton>
              ) : null}
            </div>
          }
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ModernStat label="Bağlantı" value={connectionLabel} icon={status.connection === 'live' ? ShieldCheck : MonitorOff} tone={CONNECTION_TONES[status.connection] ?? 'neutral'} />
          <ModernStat label="Pencere" value={windowStateLabel} icon={Monitor} tone={WINDOW_STATE_TONES[status.windowState] ?? 'neutral'} />
          <ModernStat label="Token" value={status.token ? 'Aktif' : 'Yok'} icon={ShieldCheck} tone={status.token ? 'success' : 'warning'} />
          <ModernStat label="Snapshot" value={snapshot ? snapshot.session_code : 'Bekleniyor'} icon={Monitor} />
        </div>
        <div className="mt-4">
          <AvailabilityBanner availability={previewAvailability} />
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
          <ModernSectionHeader title="Çalışma zamanı görünürlüğü" description="Çift monitör, bağlantı sinyali ve önizleme yüzeyi için temel kontroller." />
          <div className="mt-4">
            <StatusGrid items={runtime} />
          </div>
        </ModernSection>
      </div>

      <ModernSection>
        <ModernSectionHeader title="Public görünüm notu" description="Operatör yüzeyi gerçek customer display skin yerine onun kontrol ve güven durumunu gösterir." />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <ModernCard className="bg-white">
            {/* M3 — 'Henüz sinyal yok' kalıcı yanıltıcıydı: modülde heartbeat
                üreten kod yoktu ve kart canlı bağlantıda bile boş görünüyordu.
                Kart artık son WS kare zamanını gösterir; sinyal yokken bağlantı
                durumuna göre dürüst metin basar. */}
            <p className="text-sm font-medium text-slate-900">Son sinyal</p>
            <p className="mt-2 text-sm text-slate-500">
              {status.lastHeartbeat
                ? formatDate(status.lastHeartbeat)
                : status.connection === 'live'
                  ? 'Bağlı — ilk sinyal bekleniyor'
                  : 'Bağlantı yok'}
            </p>
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
