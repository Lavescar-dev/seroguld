import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
  ClipboardList,
  RefreshCw,
  ShieldAlert,
  ShoppingBag,
  Users,
} from 'lucide-react';

import { ModernBadge, ModernButton, ModernDataTable, ModernPage, ModernSection, ModernSectionHeader, ModernStat } from '@/modern/design-system';

import { AvailabilityBanner, TimelineList, formatDate, formatMoney, toneForText } from './shared';
import type { ModernDashboardPageProps } from './types';

export function ModernDashboardPage({
  summary,
  workInbox,
  relationHealth,
  timeline = [],
  onNavigate,
  refreshLabel = 'Yenile',
  onRefresh,
  isRefreshing,
}: ModernDashboardPageProps) {
  return (
    <ModernPage>
      <ModernSection>
        <ModernSectionHeader
          eyebrow="Operasyon merkezi"
          title="Bugünün kontrolü tek çalışma alanında"
          description="Alış, müşteri, stok, risk ve finans doğrularını aynı yoğun masaüstü bağlamında takip edin."
          action={
            <div className="flex flex-wrap items-center gap-2">
              {onRefresh ? (
                <ModernButton tone="ghost" icon={RefreshCw} onClick={onRefresh} disabled={isRefreshing}>
                  {isRefreshing ? 'Yenileniyor' : refreshLabel}
                </ModernButton>
              ) : null}
              <ModernButton tone="success" icon={ClipboardList} onClick={() => onNavigate?.('/')}>
                Yeni alış başlat
              </ModernButton>
            </div>
          }
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ModernStat label="Bugünkü alış" value={summary.alisSayisi} meta={formatMoney(summary.alisToplamKr)} icon={ShoppingBag} tone="primary" />
          <ModernStat label="Aktif müşteri" value={summary.musteriSayisi} meta={`${summary.sonMusteriler.length} yeni kayıt görünür`} icon={Users} tone="info" />
          <ModernStat label="Depo ürün" value={summary.depoToplamItem} meta={formatMoney(summary.depoSpotDeger)} icon={Boxes} tone="success" />
          <ModernStat label="Yüksek risk" value={summary.opmcYuksek} meta={`${summary.opmcManuel} manuel inceleme`} icon={ShieldAlert} tone={summary.opmcYuksek > 0 ? 'danger' : 'neutral'} />
        </div>
      </ModernSection>

      {summary.faturaAdedi > 0 && Math.abs(summary.faturaToplamKr) > 0 ? (
        <AvailabilityBanner
          availability={{
            state: 'readonly',
            title: 'Finansal gönderim koruması izleniyor.',
            description:
              'Uniconta toplamları ve satır eşleşmesi doğrulanmadan bu katmanda otomatik başarı ima edilmez; finans durumu izleme amacıyla sunulur.',
          }}
          action={onNavigate ? <ModernButton tone="warning" onClick={() => onNavigate('/uniconta')}>Uniconta’yı aç</ModernButton> : undefined}
        />
      ) : null}

      <div className="grid gap-5 2xl:grid-cols-[1.2fr_0.8fr]">
        <ModernSection>
          <ModernSectionHeader
            title="İş kutusu"
            description="Kullanıcının modül modül dolaşmadan çözmesi gereken merkezi görevler."
          />
          <div className="mt-4 space-y-3">
            {workInbox.map((item) => (
              <div key={item.id} className="rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <ModernBadge tone={item.tone || toneForText(item.meta)}>{item.meta}</ModernBadge>
                  {item.actionLabel && item.onAction ? (
                    <ModernButton tone="ghost" size="sm" trailingIcon={ArrowRight} onClick={item.onAction}>
                      {item.actionLabel}
                    </ModernButton>
                  ) : null}
                </div>
                <p className="mt-3 text-sm font-medium text-sg-text">{item.title}</p>
                <p className="mt-1 text-sm leading-6 text-sg-text-soft">{item.summary}</p>
              </div>
            ))}
          </div>
        </ModernSection>

        <ModernSection>
          <ModernSectionHeader
            title="Piyasa ve mutabakat"
            description="Spot fiyatlar ve gönderim koruması durumu."
          />
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <ModernStat label="Altın" value={`${summary.goldPrice} DKK`} meta="Gram başına" icon={Banknote} tone="warning" />
              <ModernStat label="Gümüş" value={`${summary.silverPrice} DKK`} meta="Gram başına" icon={Banknote} tone="neutral" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ModernStat label="Platin" value={`${summary.platinPrice} DKK`} meta="Gram başına" icon={Banknote} tone="neutral" />
              <ModernStat label="Palladyum" value={`${summary.palladyumPrice} DKK`} meta="Gram başına" icon={Banknote} tone="neutral" />
            </div>
            <div className="rounded-sg-md border border-sg-amber/20 bg-sg-amber-soft px-4 py-4">
              <div className="flex items-center gap-2 text-sg-amber">
                <AlertTriangle className="h-4 w-4" />
                <p className="text-sm font-semibold">Gönderim koruması görünür tutuldu</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-sg-text-soft">
                Yerel teklif ve uzak fatura satırları teyit edilmeden otomatik finans akışı tamamlandı gibi gösterilmez.
              </p>
            </div>
          </div>
        </ModernSection>
      </div>

      <ModernSection>
        <ModernSectionHeader
          title="İlişki sağlığı"
          description="UI, Excel, log, stok, risk ve dış sistem akışlarının görünür runtime ilişkisi."
        />
        <div className="mt-4">
          <ModernDataTable
            items={relationHealth}
            getRowKey={(item) => item.id}
            columns={[
              {
                key: 'flow',
                header: 'Akış',
                cell: (item) => (
                  <div>
                    <p className="font-medium text-sg-text">{item.source}</p>
                    <p className="text-xs text-sg-text-soft">{item.target}</p>
                  </div>
                ),
              },
              {
                key: 'detail',
                header: 'Detay',
                cell: (item) => <p className="max-w-xl text-sm text-sg-text-soft">{item.detail}</p>,
              },
              {
                key: 'status',
                header: 'Durum',
                align: 'right',
                cell: (item) => <ModernBadge tone={item.tone || toneForText(item.status)}>{item.status}</ModernBadge>,
              },
            ]}
          />
        </div>
      </ModernSection>

      <div className="grid gap-5 xl:grid-cols-2">
        <ModernSection>
          <ModernSectionHeader title="Son AFG işlemleri" description="Yerel belge, müşteri ve tutar görünümü." />
          <div className="mt-4">
            <ModernDataTable
              items={summary.sonAlislar}
              getRowKey={(item) => item.id}
              columns={[
                {
                  key: 'document',
                  header: 'Belge',
                  cell: (item) => (
                    <div>
                      <p className="font-medium text-sg-text">{item.afregningsnr}</p>
                      <p className="text-xs text-sg-text-soft">{formatDate(item.dato)}</p>
                    </div>
                  ),
                },
                {
                  key: 'customer',
                  header: 'Müşteri',
                  cell: (item) => item.musteri,
                },
                {
                  key: 'payment',
                  header: 'Ödeme',
                  cell: (item) => item.paymentMethod || 'Bankoverførsel',
                },
                {
                  key: 'total',
                  header: 'Tutar',
                  align: 'right',
                  cell: (item) => <span className="font-medium text-sg-text">{formatMoney(item.total / 100)}</span>,
                },
              ]}
            />
          </div>
        </ModernSection>

        <ModernSection>
          <ModernSectionHeader title="Son müşteri hareketi" description="Yakın müşteri kayıtları." />
          <div className="mt-4">
            <ModernDataTable
              items={summary.sonMusteriler}
              getRowKey={(item) => item.id}
              columns={[
                {
                  key: 'customer',
                  header: 'Müşteri',
                  cell: (item) => <span className="font-medium text-sg-text">{item.navn}</span>,
                },
                {
                  key: 'registered',
                  header: 'Kayıt',
                  align: 'right',
                  cell: (item) => formatDate(item.kayitTarihi),
                },
              ]}
            />
          </div>
        </ModernSection>
      </div>

      {timeline.length > 0 ? <TimelineList items={timeline} title="Akış zaman çizelgesi" description="Yüzey içinde görünür kalan son teknik ve operasyonel olaylar." /> : null}
    </ModernPage>
  );
}
