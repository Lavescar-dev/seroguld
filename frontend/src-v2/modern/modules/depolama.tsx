import { Camera, Eye, FileSpreadsheet, Search, Tag } from 'lucide-react';

import type { ModernDepolamaViewModel } from '@/modern/adapters/depolama';
import { formatDate, formatMoney, formatNumber, labelInventoryCategory, labelInventorySubcategory, labelShopSyncStatus } from '@/lib/format';

import { DataPill, EmptyState, LoadingState, ModernModuleShell, ModernSection, ModernStatGrid, shellButtonClass } from './shared';

export function ModernDepolamaModule({ viewModel }: { viewModel: ModernDepolamaViewModel }) {
  const { state } = viewModel;
  const selected = state.selectedProduct;

  return (
    <ModernModuleShell
      eyebrow="Depolama"
      title="Envanter ve Stok"
      subtitle="Gerçek stok akışı, GDPR lock ve lifecycle durumlarını koruyan modern light yüzey."
      badges={
        <>
          <DataPill label="Kategori" value={labelInventoryCategory(state.activeKat)} />
          <DataPill label="View" value={state.activeView === 'excel' ? 'Office' : 'System'} tone={state.activeView === 'excel' ? 'warning' : 'neutral'} />
          <DataPill label="Fiyat" value={state.savingPrices ? 'Kaydediliyor' : 'Hazır'} tone={state.savingPrices ? 'warning' : 'success'} />
        </>
      }
      actions={
        <>
          <button type="button" onClick={state.startNew} className={shellButtonClass('primary')}>Yeni Ürün</button>
          <button type="button" onClick={state.onOpenWorkbookPreview} className={shellButtonClass('secondary')}>
            <FileSpreadsheet className="h-4 w-4" />
            Office
          </button>
        </>
      }
    >
      <ModernStatGrid items={viewModel.stats} />

      {viewModel.phase === 'loading' ? <LoadingState label="Depolama workspace yükleniyor" /> : null}
      {viewModel.phase === 'empty' ? <EmptyState title="Stok Yok" message="Seçili filtrede ürün bulunmuyor. Yeni ürün akışını başlatabilirsiniz." /> : null}

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <ModernSection title="Stok Listesi" subtitle="Mobil görünüm taşmayı önlemek için kart düzenine geçer.">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs font-semibold text-brand-600">
              Metin Filtre
              <div className="mt-1 flex items-center gap-2 rounded-2xl border border-brand-200 bg-stone-50 px-3 py-2">
                <Search className="h-4 w-4 text-brand-400" />
                <input value={state.filters.q} onChange={(event) => state.setFilters((current) => ({ ...current, q: event.target.value }))} className="w-full bg-transparent text-sm text-brand-900 outline-none" />
              </div>
            </label>
            <label className="text-xs font-semibold text-brand-600">Lokasyon
              <input value={state.filters.location} onChange={(event) => state.setFilters((current) => ({ ...current, location: event.target.value }))} className="mt-1 w-full rounded-2xl border border-brand-200 bg-stone-50 px-3 py-2 text-sm text-brand-900 outline-none" />
            </label>
            <label className="text-xs font-semibold text-brand-600">Gram Min
              <input value={state.filters.weightMin} onChange={(event) => state.setFilters((current) => ({ ...current, weightMin: event.target.value }))} className="mt-1 w-full rounded-2xl border border-brand-200 bg-stone-50 px-3 py-2 text-sm text-brand-900 outline-none" />
            </label>
            <label className="text-xs font-semibold text-brand-600">Gram Max
              <input value={state.filters.weightMax} onChange={(event) => state.setFilters((current) => ({ ...current, weightMax: event.target.value }))} className="mt-1 w-full rounded-2xl border border-brand-200 bg-stone-50 px-3 py-2 text-sm text-brand-900 outline-none" />
            </label>
          </div>

          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-brand-200 text-left text-[11px] font-black uppercase tracking-[0.18em] text-brand-500">
                  <th className="px-3 py-2">Ürün</th>
                  <th className="px-3 py-2">Kategori</th>
                  <th className="px-3 py-2">Gram</th>
                  <th className="px-3 py-2">DKK</th>
                  <th className="px-3 py-2">Shop</th>
                  <th className="px-3 py-2">Aksiyon</th>
                </tr>
              </thead>
              <tbody>
                {state.stokList.map((item) => (
                  <tr key={item.id} className="border-b border-brand-100">
                    <td className="px-3 py-3 font-black text-brand-950">{item.urun}</td>
                    <td className="px-3 py-3 text-brand-700">{labelInventoryCategory(item.mainKat)}{item.gumusAlt ? ` / ${labelInventorySubcategory(item.gumusAlt)}` : item.platinAlt ? ` / ${labelInventorySubcategory(item.platinAlt)}` : ''}</td>
                    <td className="px-3 py-3 text-brand-700">{formatNumber(item.toplamGram || item.birimGram * item.adet, ' g')}</td>
                    <td className="px-3 py-3 text-brand-700">{formatMoney(item.alisFiyati)}</td>
                    <td className="px-3 py-3 text-brand-700">{labelShopSyncStatus(item.shopDurumu || null)}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => state.onOpenDetail(item.id)} className={shellButtonClass('ghost')}>Detay</button>
                        <button type="button" onClick={() => state.onPrintLabel(item.id, item.urun)} className={shellButtonClass('ghost')}>Etiket</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-3 md:hidden">
            {state.stokList.map((item) => (
              <button key={item.id} type="button" onClick={() => state.onOpenDetail(item.id)} className="rounded-[18px] border border-brand-200 bg-stone-50 p-4 text-left">
                <p className="text-sm font-black text-brand-950">{item.urun}</p>
                <dl className="mt-3 grid gap-2 text-sm">
                  <MobileRow label="Kategori" value={labelInventoryCategory(item.mainKat)} />
                  <MobileRow label="Gram" value={formatNumber(item.toplamGram || item.birimGram * item.adet, ' g')} />
                  <MobileRow label="DKK" value={formatMoney(item.alisFiyati)} />
                  <MobileRow label="Shop" value={labelShopSyncStatus(item.shopDurumu || null)} />
                </dl>
              </button>
            ))}
          </div>
        </ModernSection>

        <ModernSection title="Seçili Ürün" subtitle="Tarih, source AFG, foto ve audit özetleri.">
          {!selected ? (
            <EmptyState title="Ürün Seçilmedi" message="Stok listesinden bir ürün seçildiğinde detay paneli burada açılır." />
          ) : (
            <>
              <div className="rounded-[20px] border border-brand-200 bg-stone-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-500">Ürün Kartı</p>
                    <p className="mt-1 text-lg font-black text-brand-950">{selected.display_name || selected.product_number}</p>
                    <p className="mt-1 text-sm text-brand-600">{selected.product_number} · {selected.reference_number || 'Ref yok'}</p>
                  </div>
                  <span className="rounded-full border border-brand-200 bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-brand-600">
                    {selected.status}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[18px] border border-brand-200 bg-white p-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-500">Finans</p>
                    <p className="mt-1 text-sm text-brand-800">{formatMoney(selected.purchase_price_dkk)}</p>
                    <p className="mt-1 text-xs text-brand-500">{formatNumber(selected.total_weight_grams || selected.weight_grams, ' g')}</p>
                  </div>
                  <div className="rounded-[18px] border border-brand-200 bg-white p-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-500">Kaynak</p>
                    <p className="mt-1 text-sm text-brand-800">{state.productSourceAfg?.document_number || 'AFG bağlı değil'}</p>
                    <p className="mt-1 text-xs text-brand-500">{state.productSourceAfg?.issued_at ? formatDate(state.productSourceAfg.issued_at) : '—'}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => state.onOpenWooProduct(selected.id)} className={shellButtonClass('secondary')}>
                  <Eye className="h-4 w-4" />
                  Woo
                </button>
                <button type="button" onClick={() => state.onPrintLabel(selected.id, selected.product_number)} disabled={state.printingLabelForId === selected.id} className={shellButtonClass('secondary')}>
                  <Tag className="h-4 w-4" />
                  Etiket
                </button>
                <button type="button" onClick={() => state.onUploadPhotos(selected.id, [])} disabled className={shellButtonClass('secondary')}>
                  <Camera className="h-4 w-4" />
                  Foto Yükle
                </button>
              </div>
            </>
          )}
        </ModernSection>
      </div>
    </ModernModuleShell>
  );
}

function MobileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="font-semibold text-brand-500">{label}</dt>
      <dd className="text-right text-brand-900">{value}</dd>
    </div>
  );
}
