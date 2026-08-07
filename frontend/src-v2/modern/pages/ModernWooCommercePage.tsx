import { Globe, Link2, Package2, RefreshCw } from 'lucide-react';

import { ModernBadge, ModernButton, ModernCard, ModernDataTable, ModernPage, ModernSection, ModernSectionHeader } from '@/modern/design-system';

import { AvailabilityBanner, DetailGrid, TimelineList, formatMoney, formatNumber, labelMetalType, labelProductType, toneForText } from './shared';
import type { ModernWooPageProps } from './types';

export function ModernWooCommercePage({
  availability,
  items,
  selectedProduct,
  readiness,
  syncTimeline = [],
  onSync,
}: ModernWooPageProps) {
  return (
    <ModernPage>
      <ModernSection>
        <ModernSectionHeader
          eyebrow="WooCommerce ve WordPress"
          title="Yayın hazırlığı ve köprü görünümü"
          description="Yüzey gerçek publish başarısı taklidi yapmaz; yalnız doğrulanmış ürün, içerik ve sync durumlarını gösterir."
          action={
            <ModernButton tone="ghost" icon={RefreshCw} onClick={onSync} disabled={!onSync || availability.state !== 'available'}>
              Senkron görünümü
            </ModernButton>
          }
        />
        <div className="mt-4">
          <AvailabilityBanner availability={availability} />
        </div>
      </ModernSection>

      <div className="grid gap-5 2xl:grid-cols-[1.1fr_0.9fr]">
        <ModernSection>
          <ModernSectionHeader title="Ürün kuyruğu" description="CRM envanteri ile yayın görünümü arasındaki hazır satırlar." />
          <div className="mt-4">
            <ModernDataTable
              items={items}
              getRowKey={(item) => item.id}
              columns={[
                {
                  key: 'product',
                  header: 'Ürün',
                  cell: (item) => (
                    <div>
                      <p className="font-medium text-slate-900">{item.title}</p>
                      <p className="text-xs text-slate-500">{item.sku || item.id}</p>
                    </div>
                  ),
                },
                {
                  key: 'spec',
                  header: 'Metal',
                  cell: (item) => (
                    <div>
                      <p>{item.metal}</p>
                      <p className="text-xs text-slate-500">{item.weightLabel}</p>
                    </div>
                  ),
                },
                {
                  key: 'price',
                  header: 'Fiyat',
                  align: 'right',
                  cell: (item) => item.priceLabel,
                },
                {
                  key: 'state',
                  header: 'Yayın',
                  align: 'right',
                  cell: (item) => <ModernBadge tone={item.tone || toneForText(item.publishState)}>{item.publishState}</ModernBadge>,
                },
              ]}
            />
          </div>
        </ModernSection>

        <div className="space-y-5">
          <DetailGrid
            title="Seçili ürün özeti"
            description="Ürün detay paneli gerçek mutation olmadan yalnız okunur halde taşınır."
            items={
              selectedProduct
                ? [
                    { label: 'Ürün adı', value: selectedProduct.display_name || selectedProduct.product_number, accent: true },
                    { label: 'Metal', value: labelMetalType(selectedProduct.metal_type), accent: true },
                    { label: 'Tip', value: labelProductType(selectedProduct.product_type) },
                    { label: 'Ağırlık', value: formatNumber(selectedProduct.weight_grams, ' g') },
                    { label: 'Alış fiyatı', value: formatMoney(selectedProduct.purchase_price_dkk) },
                    { label: 'Mağaza fiyatı', value: formatMoney(selectedProduct.shop_price_dkk) },
                    { label: 'Fotoğraf', value: `${selectedProduct.photos.length} görsel` },
                    { label: 'Woo durumu', value: selectedProduct.shop_sync_status || 'Hazırlanıyor' },
                  ]
                : [{ label: 'Durum', value: 'Henüz ürün seçilmedi', accent: true }]
            }
          />

          <ModernSection>
            <ModernSectionHeader title="Hazırlık alanları" description="Yalnız doğrulanmış hazırlık bilgileri." />
            <div className="mt-4 grid gap-3">
              {readiness.map((item) => (
                <ModernCard key={`${item.label}-${item.value}`} className="bg-white">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{item.label}</p>
                      {item.detail ? <p className="mt-1 text-sm text-slate-500">{item.detail}</p> : null}
                    </div>
                    <ModernBadge tone={item.tone || toneForText(item.value)}>{item.value}</ModernBadge>
                  </div>
                </ModernCard>
              ))}
            </div>
          </ModernSection>

          {syncTimeline.length > 0 ? <TimelineList items={syncTimeline} title="WordPress / Woo köprüsü" description="Gerçek sync günlüğüne bağlanacak görünüm alanı." /> : null}
        </div>
      </div>
    </ModernPage>
  );
}
