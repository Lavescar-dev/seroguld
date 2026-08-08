import { useState } from 'react';
import { CheckCircle2, Globe2, Package2, RefreshCw, ShieldCheck, Webhook } from 'lucide-react';

import {
  ModernBadge,
  ModernButton,
  ModernCard,
  ModernDataTable,
  ModernPage,
  ModernSection,
  ModernSectionHeader,
  ModernStat,
  ModernUnavailableState,
} from '@/modern/design-system';

import { AvailabilityBanner, DetailGrid, StatusGrid, TimelineList, formatMoney, formatNumber, labelMetalType, labelProductType, toneForText } from './shared';
import type { ModernWooPageProps } from './types';

type WooTab = 'products' | 'orders' | 'webhooks' | 'bridge';

const tabLabels: Array<{ id: WooTab; label: string }> = [
  { id: 'products', label: 'Ürünler' },
  { id: 'orders', label: 'Siparişler' },
  { id: 'webhooks', label: 'Webhook Sağlığı' },
  { id: 'bridge', label: 'WordPress Bridge' },
];

export function ModernWooCommercePage({
  availability,
  items,
  selectedProduct,
  readiness,
  syncTimeline = [],
  isLoading = false,
  onSelectProduct,
  onSync,
}: ModernWooPageProps) {
  const [activeTab, setActiveTab] = useState<WooTab>('products');
  const publishedCount = items.filter((item) => item.publishState === 'Yayında').length;
  const bridgeStatus = readiness.find((item) => item.label.toLocaleLowerCase().includes('bridge'));
  const webhookStatus = readiness.find((item) => item.label.toLocaleLowerCase().includes('webhook'));

  if (isLoading && items.length === 0) {
    return (
      <ModernPage>
        <ModernSection>
          <ModernSectionHeader eyebrow="E-ticaret entegrasyonu" title="WooCommerce / WordPress" description="Gerçek çalışma alanı yanıtı bekleniyor." />
          <div className="mt-5"><ModernUnavailableState title="Ürün çalışma alanı hazırlanıyor" description="Liste ve seçili ürün detayları backend hook'undan gelmeden sahte satır gösterilmez." detail="READ-ONLY RUNTIME" /></div>
        </ModernSection>
      </ModernPage>
    );
  }

  return (
    <ModernPage>
      <ModernSection className="bg-sg-surface-soft">
        <ModernSectionHeader
          eyebrow="E-ticaret entegrasyonu"
          title="WooCommerce / WordPress"
          description="CRM envanteri, ürün yayın hazırlığı, webhook güvenliği ve WordPress köprüsünü aynı operasyon görünümünde birleştirir."
          action={<ModernButton tone="ghost" icon={RefreshCw} onClick={onSync} disabled={!onSync} title="Dry-run endpoint'i mevcut değilse aksiyon kapalı kalır">Dry-run sync</ModernButton>}
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ModernStat label="Yayındaki ürün" value={publishedCount} meta={`${items.length} gerçek ürün satırı`} icon={Package2} tone="success" />
          <ModernStat label="Sipariş intake" value={<ModernBadge tone="info">DISCOVERY</ModernBadge>} meta="Order hook'u bu yüzeyde yok" icon={ShieldCheck} tone="info" />
          <ModernStat label="Webhook delivery" value={<ModernBadge tone={webhookStatus?.tone || 'info'}>{webhookStatus?.value || 'DISCOVERY'}</ModernBadge>} meta={webhookStatus?.detail || 'Fail-closed health alanı bekleniyor'} icon={Webhook} tone={webhookStatus?.tone || 'info'} />
          <ModernStat label="Bridge durumu" value={<ModernBadge tone={bridgeStatus?.tone || 'info'}>{bridgeStatus?.value || 'DISCOVERY'}</ModernBadge>} meta={bridgeStatus?.detail || 'Canonical plugin health alanı bekleniyor'} icon={Globe2} tone={bridgeStatus?.tone || 'info'} />
        </div>
        <div className="mt-4"><AvailabilityBanner availability={availability} /></div>
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

      {activeTab === 'products' ? (
        <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <ModernSection className="min-w-0">
            <ModernSectionHeader title="CRM ürün kaynağı" description="Publish readiness ve remote farkı gerçek inventory satırlarından okunur." action={<ModernBadge tone="info">Product master</ModernBadge>} />
            <div className="mt-4">
              <ModernDataTable
                items={items}
                getRowKey={(item) => item.id}
                emptyTitle="Ürün bulunmuyor"
                emptyDescription="Woo workspace gerçek ürün satırı döndürdüğünde liste burada görünür."
                columns={[
                  {
                    key: 'product',
                    header: 'Ürün',
                    cell: (item) => <div><p className="font-semibold text-sg-text">{item.title}</p><p className="mt-1 text-xs text-sg-text-soft">{item.sku || item.id}</p></div>,
                  },
                  { key: 'spec', header: 'Metal / gram', cell: (item) => <div><p className="text-sg-text">{item.metal}</p><p className="mt-1 text-xs text-sg-text-soft">{item.weightLabel}</p></div> },
                  { key: 'price', header: 'Fiyat', align: 'right', cell: (item) => item.priceLabel },
                  { key: 'state', header: 'Yayın', cell: (item) => <ModernBadge tone={item.tone || toneForText(item.publishState)}>{item.publishState}</ModernBadge> },
                  { key: 'open', header: 'Detay', align: 'right', cell: (item) => onSelectProduct ? <ModernButton tone="ghost" size="sm" onClick={() => onSelectProduct(item.id)}>Aç</ModernButton> : <ModernBadge tone="neutral">Read-only</ModernBadge> },
                ]}
              />
            </div>
          </ModernSection>

          <div className="space-y-5">
            <DetailGrid
              title={selectedProduct ? `${selectedProduct.product_number} · Publish workspace` : 'Publish workspace'}
              description="Ürün detayı gerçek ProductOut alanlarından gelir; live publish aksiyonu bu presentation'da otomatik çalıştırılmaz."
              items={selectedProduct ? [
                { label: 'Ürün adı', value: selectedProduct.display_name || selectedProduct.product_number, accent: true },
                { label: 'Metal / tip', value: `${labelMetalType(selectedProduct.metal_type)} · ${labelProductType(selectedProduct.product_type)}` },
                { label: 'Ağırlık', value: formatNumber(selectedProduct.weight_grams, ' g') },
                { label: 'Alış fiyatı', value: formatMoney(selectedProduct.purchase_price_dkk) },
                { label: 'Mağaza fiyatı', value: formatMoney(selectedProduct.shop_price_dkk) },
                { label: 'Woo ID', value: selectedProduct.woocommerce_product_id || '—' },
                { label: 'Stock state', value: selectedProduct.status },
                { label: 'GDPR', value: selectedProduct.is_gdpr_locked ? 'Kilitli' : 'Açık' },
              ] : [{ label: 'Durum', value: 'Ürün seçimi bekleniyor', accent: true }]}
            />
            <ModernSection>
              <ModernSectionHeader title="Publish readiness" description="Başlık, medya, AI onayı ve bridge state tek listede." />
              <div className="mt-4 grid gap-3">
                {readiness.map((item) => (
                  <ModernCard key={`${item.label}-${item.value}`} className="bg-sg-surface-soft">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0"><p className="text-sm font-semibold text-sg-text">{item.label}</p>{item.detail ? <p className="mt-1 text-xs text-sg-text-soft">{item.detail}</p> : null}</div>
                      <ModernBadge tone={item.tone || toneForText(item.value)}>{item.value}</ModernBadge>
                    </div>
                  </ModernCard>
                ))}
              </div>
            </ModernSection>
            {syncTimeline.length > 0 ? <TimelineList items={syncTimeline} title="Deterministic sync geçmişi" description="History ve sync-log hook çıktıları; sahte başarı eklenmez." /> : <ModernUnavailableState title="Sync geçmişi bekleniyor" description="Bu ürün için gerçek history/sync-log satırı dönmedi." detail="NOT RUN" />}
          </div>
        </div>
      ) : null}

      {activeTab === 'orders' ? (
        <ModernUnavailableState title="Sipariş intake görünümü hazır değil" description="Woo workspace hook'u bu route'ta ürün satırları sağlıyor; order, risk ve delivery key alanları expose edilmeden sipariş tablosu uydurulmaz." detail="BACKEND CONTRACT DISCOVERY" />
      ) : null}

      {activeTab === 'webhooks' ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <ModernSection>
            <ModernSectionHeader title="Webhook sağlığı" description="Fail-closed secret ve duplicate no-op kanıtı mevcut readiness state'iyle sınırlıdır." />
            <div className="mt-4"><StatusGrid items={readiness.length > 0 ? readiness : [{ label: 'Webhook health', value: 'DISCOVERY', tone: 'info', detail: 'Backend health alanı yok.' }]} /></div>
          </ModernSection>
          <ModernUnavailableState title="Delivery timeline expose değil" description="Canlı webhook payloadı veya remote write çalıştırılmadı; delivery timeline backend hook'u bekliyor." detail="READ-ONLY REVIEW" />
        </div>
      ) : null}

      {activeTab === 'bridge' ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <ModernSection>
            <ModernSectionHeader title="WordPress bridge" description="GDPR linkleri, media, SEO ve canonical plugin discovery ayrımı." />
            <div className="mt-4"><StatusGrid items={readiness.length > 0 ? readiness : [{ label: 'WordPress bridge', value: 'DISCOVERY', tone: 'info' }]} /></div>
          </ModernSection>
          <ModernUnavailableState title="Canonical plugin sonucu bekleniyor" description="Bridge config veya plugin discovery endpoint'i bu presentation prop'larına bağlanmadı; PARTIAL/DISCOVERY olarak tutulur." detail="NO LIVE WRITE" />
        </div>
      ) : null}

      <div className="flex items-center gap-2 text-xs text-sg-text-soft"><CheckCircle2 className="h-3.5 w-3.5 text-sg-green" /> Ürün listesi, seçili detay ve readiness satırları gerçek domain state'inden gelir.</div>
    </ModernPage>
  );
}
