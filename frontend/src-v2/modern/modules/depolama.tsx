import { Camera, Check, Eye, FileSpreadsheet, Search, Tag, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { ModernDepolamaViewModel } from '@/modern/adapters/depolama';
import { formatDate, formatMoney, formatNumber, labelInventoryCategory, labelInventorySubcategory, labelShopSyncStatus } from '@/lib/format';
import { EmbeddedWorkbookPanel } from '@/make/embedded/EmbeddedWorkbookPanel';
import { describeActiveInventoryFilters, type MainCategory, type PlatinumSub, type SilverSub, type StokItem } from '@/make/depolama/types';
import { InventoryWorkbookImport } from '@/make/depolama/InventoryWorkbookImport';
import { LegacyMigrationCenter } from '@/components/LegacyMigrationCenter';

import { DataPill, EmptyState, LoadingState, ModernModuleShell, ModernSection, ModernStatGrid, shellButtonClass } from './shared';
import { ModernOfficeSurface } from './ModernOfficeSurface';

const editorInputClass = 'mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/15';

function NumericDraftInput({ value, onCommit, id, label }: { value: number | undefined; onCommit: (value: number) => void; id: string; label: string }) {
  const [raw, setRaw] = useState(value === undefined || value === null || value === 0 ? '' : String(value));
  useEffect(() => setRaw(value === undefined || value === null || value === 0 ? '' : String(value)), [value]);
  return <label htmlFor={id} className="text-xs font-semibold text-sg-text-soft">{label}<input id={id} name={id} inputMode="decimal" value={raw} onChange={(event) => setRaw(event.target.value)} onBlur={() => { const parsed = Number(raw.replace(',', '.')); if (Number.isFinite(parsed)) onCommit(parsed); }} className={editorInputClass} /></label>;
}

function ModernInventoryEditor({ state }: { state: ModernDepolamaViewModel['state'] }) {
  const editing = state.editing;
  if (!editing) return null;
  const update = (patch: Partial<StokItem>) => state.setEditing({ ...editing, ...patch });
  const existing = state.stokList.some((item) => item.id === editing.id);
  const updateCategory = (mainKat: MainCategory) => update({
    mainKat,
    gumusAlt: mainKat === 'gumus' ? editing.gumusAlt || 'smykker' : undefined,
    platinAlt: mainKat === 'platin_pd' ? editing.platinAlt || 'platin' : undefined,
  });
  return (
    <ModernModuleShell eyebrow="Depolama" title={existing ? 'Ürünü düzenle' : 'Yeni ürün'} subtitle="Kaydetmeden önce tüm değişiklikler yalnızca bu formda tutulur."
      actions={<button type="button" onClick={() => state.setEditing(null)} className={shellButtonClass('secondary')}><X className="h-4 w-4" />Kapat</button>}
    >
      <ModernSection title="Ürün bilgileri" subtitle="Zorunlu alanlar ürün adı, gram ve alış fiyatıdır.">
        <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); state.saveItem(); }}>
          <label htmlFor="inventory-name" className="text-xs font-semibold text-sg-text-soft">Ürün adı<input id="inventory-name" name="display_name" required value={editing.urun} onChange={(event) => update({ urun: event.target.value })} className={editorInputClass} /></label>
          <label htmlFor="inventory-category" className="text-xs font-semibold text-sg-text-soft">Kategori<select id="inventory-category" name="category" value={editing.mainKat} onChange={(event) => updateCategory(event.target.value as MainCategory)} className={editorInputClass}><option value="kulce">Külçe</option><option value="sikke">Sikke</option><option value="taki">Takı</option><option value="gumus">Gümüş</option><option value="platin_pd">Platin / Palladyum</option></select></label>
          {editing.mainKat === 'gumus' ? <label htmlFor="inventory-silver-subcategory" className="text-xs font-semibold text-sg-text-soft">Gümüş türü<select id="inventory-silver-subcategory" name="silver_subcategory" value={editing.gumusAlt || 'smykker'} onChange={(event) => update({ gumusAlt: event.target.value as SilverSub })} className={editorInputClass}><option value="smykker">Takı</option><option value="barrer">Külçe</option></select></label> : null}
          {editing.mainKat === 'platin_pd' ? <label htmlFor="inventory-platinum-subcategory" className="text-xs font-semibold text-sg-text-soft">Metal<select id="inventory-platinum-subcategory" name="platinum_subcategory" value={editing.platinAlt || 'platin'} onChange={(event) => update({ platinAlt: event.target.value as PlatinumSub })} className={editorInputClass}><option value="platin">Platin</option><option value="palladyum">Palladyum</option></select></label> : null}
          <label htmlFor="inventory-reference" className="text-xs font-semibold text-sg-text-soft">Stok / referans no<input id="inventory-reference" name="reference_number" value={editing.stokNo || editing.referenceNumber || ''} onChange={(event) => update({ stokNo: event.target.value, referenceNumber: event.target.value || null })} className={editorInputClass} /></label>
          <label htmlFor="inventory-date" className="text-xs font-semibold text-sg-text-soft">Alış tarihi<input id="inventory-date" name="purchase_date" type="date" value={editing.lagerDato} onChange={(event) => update({ lagerDato: event.target.value })} className={editorInputClass} /></label>
          <NumericDraftInput id="inventory-purity" label="Saflık (ör. 0.875)" value={editing.saflik} onCommit={(saflik) => update({ saflik })} />
          <NumericDraftInput id="inventory-grams" label="Birim gram" value={editing.birimGram} onCommit={(birimGram) => update({ birimGram })} />
          <NumericDraftInput id="inventory-count" label="Adet" value={editing.adet} onCommit={(adet) => update({ adet: Math.max(1, Math.round(adet)) })} />
          <NumericDraftInput id="inventory-price" label="Alış fiyatı (DKK)" value={editing.alisFiyati} onCommit={(alisFiyati) => update({ alisFiyati })} />
          {editing.mainKat === 'taki' ? <NumericDraftInput id="inventory-shop-price" label="Shop fiyatı (DKK)" value={editing.shopFiyati} onCommit={(shopFiyati) => update({ shopFiyati })} /> : null}
          <label htmlFor="inventory-length" className="text-xs font-semibold text-sg-text-soft">Uzunluk<input id="inventory-length" name="length_cm" value={editing.olcuUzunluk || ''} onChange={(event) => update({ olcuUzunluk: event.target.value || undefined })} placeholder="45cm / 18-19cm" className={editorInputClass} /></label>
          <NumericDraftInput id="inventory-width" label="Genişlik (mm)" value={editing.olcuGenislik} onCommit={(value) => update({ olcuGenislik: value || undefined })} />
          <NumericDraftInput id="inventory-thickness" label="Kalınlık (mm)" value={editing.olcuKalinlik} onCommit={(value) => update({ olcuKalinlik: value || undefined })} />
          <NumericDraftInput id="inventory-diameter" label="Çap (mm)" value={editing.olcuCap} onCommit={(value) => update({ olcuCap: value || undefined })} />
          <label htmlFor="inventory-producer" className="text-xs font-semibold text-sg-text-soft">Üretici / Marka<input id="inventory-producer" name="producer" value={editing.uretici || ''} onChange={(event) => update({ uretici: event.target.value || undefined })} placeholder="Umicore, AUR..." className={editorInputClass} /></label>
          <label htmlFor="inventory-location" className="text-xs font-semibold text-sg-text-soft">Depo lokasyonu<input id="inventory-location" name="storage_location" value={editing.storageLocation || ''} onChange={(event) => update({ storageLocation: event.target.value })} className={editorInputClass} /></label>
          <label htmlFor="inventory-notes" className="text-xs font-semibold text-sg-text-soft md:col-span-2">Notlar<textarea id="inventory-notes" name="notes" value={editing.notlar || ''} onChange={(event) => update({ notlar: event.target.value })} className={`${editorInputClass} min-h-24`} /></label>
          <div className="flex flex-wrap justify-end gap-2 border-t border-sg-border pt-4 md:col-span-2">
            {existing ? <button type="button" onClick={() => { if (window.confirm('Bu ürün silinsin mi?')) state.deleteItem(editing.id); }} className={shellButtonClass('secondary')}><Trash2 className="h-4 w-4" />Sil</button> : null}
            <button type="button" onClick={() => state.setEditing(null)} className={shellButtonClass('secondary')}>Vazgeç</button>
            <button type="submit" disabled={state.savingItem} className={shellButtonClass('primary')}><Check className="h-4 w-4" />{state.savingItem ? 'Kaydediliyor' : 'Kaydet'}</button>
          </div>
        </form>
      </ModernSection>
    </ModernModuleShell>
  );
}

export function ModernDepolamaModule({ viewModel }: { viewModel: ModernDepolamaViewModel }) {
  const { state } = viewModel;
  const selected = state.selectedProduct;
  const [migrationOpen, setMigrationOpen] = useState(false);
  const categoryScope = state.categoryScope || state.activeKat;
  const categoryOptions: Array<{ key: MainCategory | 'all'; label: string }> = [
    { key: 'all', label: 'Tüm ürünler' },
    { key: 'kulce', label: 'Külçe' },
    { key: 'sikke', label: 'Sikke' },
    { key: 'taki', label: 'Takı' },
    { key: 'gumus', label: 'Gümüş' },
    { key: 'platin_pd', label: 'Platin / Pd' },
  ];

  if (state.editing) {
    return <ModernInventoryEditor state={state} />;
  }

  return (
    <ModernModuleShell
      eyebrow="Depolama"
      title="Envanter ve Stok"
      subtitle="Gerçek stok akışı, GDPR lock ve lifecycle durumlarını koruyan modern light yüzey."
      badges={
        <>
          <DataPill label="Kategori" value={categoryScope === 'all' ? 'Tüm ürünler' : labelInventoryCategory(categoryScope)} />
          <DataPill label="Görünüm" value={state.activeView === 'excel' ? 'Office' : 'Sistem'} tone={state.activeView === 'excel' ? 'warning' : 'neutral'} />
          <DataPill label="Fiyat" value={state.savingPrices ? 'Kaydediliyor' : 'Hazır'} tone={state.savingPrices ? 'warning' : 'success'} />
        </>
      }
      actions={
        <>
          <button type="button" onClick={() => setMigrationOpen(true)} className={shellButtonClass('secondary')}>Eski sistemi taşı</button>
          <button type="button" onClick={state.startNew} className={shellButtonClass('primary')}>Yeni Ürün</button>
          <InventoryWorkbookImport variant="modern" />
          <button type="button" onClick={state.onOpenWorkbookPreview} className={shellButtonClass('secondary')}>
            <FileSpreadsheet className="h-4 w-4" />
            Office
          </button>
        </>
      }
    >
      <LegacyMigrationCenter open={migrationOpen} onClose={() => setMigrationOpen(false)} initialPhase="inventory" />
      {state.activeView === 'excel' ? (
        <ModernDepolamaOfficeSurface onClose={() => state.setActiveView('system')} />
      ) : (
        <>
      <div className="flex flex-wrap gap-2 rounded-sg-xl border border-sg-border bg-sg-surface p-2" role="group" aria-label="Depolama kategorisi">
        {categoryOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => state.setCategoryScope?.(option.key)}
            aria-pressed={categoryScope === option.key}
            className={categoryScope === option.key ? shellButtonClass('primary') : shellButtonClass('secondary')}
          >
            {option.label}
          </button>
        ))}
      </div>
      <ModernStatGrid items={viewModel.stats} />

      {viewModel.phase === 'loading' ? <LoadingState label="Depolama workspace yükleniyor" /> : null}
      {viewModel.phase === 'empty' ? (() => {
        const activeFilters = describeActiveInventoryFilters(state.filters, categoryScope);
        return (
          <EmptyState
            title="Bu görünümde ürün yok"
            message={activeFilters.length
              ? `Kayıtlar şu aktif filtreler nedeniyle gizleniyor olabilir: ${activeFilters.join(', ')}.`
              : 'Henüz kayıtlı ürün yok. Yeni ürün akışını başlatabilirsiniz.'}
            action={activeFilters.length ? (
              <button
                type="button"
                onClick={() => { state.resetFilters(); state.setCategoryScope?.('all'); }}
                className={shellButtonClass('primary')}
              >
                <X className="h-4 w-4" />Filtreleri sıfırla ve tümünü göster
              </button>
            ) : undefined}
          />
        );
      })() : null}

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <ModernSection title="Stok Listesi" subtitle="Mobil görünüm taşmayı önlemek için kart düzenine geçer.">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs font-semibold text-sg-text-soft">
              Metin Filtre
              <div className="mt-1 flex items-center gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2">
                <Search className="h-4 w-4 text-sg-text-soft" />
                <input value={state.filters.q} onChange={(event) => state.setFilters((current) => ({ ...current, q: event.target.value }))} className="w-full bg-transparent text-sm text-sg-text outline-none" />
              </div>
            </label>
            <label className="text-xs font-semibold text-sg-text-soft">Lokasyon
              <input value={state.filters.location} onChange={(event) => state.setFilters((current) => ({ ...current, location: event.target.value }))} className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none" />
            </label>
            <label className="text-xs font-semibold text-sg-text-soft">Gram Min
              <input value={state.filters.weightMin} onChange={(event) => state.setFilters((current) => ({ ...current, weightMin: event.target.value }))} className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none" />
            </label>
            <label className="text-xs font-semibold text-sg-text-soft">Gram Max
              <input value={state.filters.weightMax} onChange={(event) => state.setFilters((current) => ({ ...current, weightMax: event.target.value }))} className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none" />
            </label>
          </div>

          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-sg-border text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">
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
                  <tr key={item.id} className="border-b border-sg-border-soft">
                    <td className="px-3 py-3 font-medium text-sg-text">{item.urun}</td>
                    <td className="px-3 py-3 text-sg-text-soft">{labelInventoryCategory(item.mainKat)}{item.gumusAlt ? ` / ${labelInventorySubcategory(item.gumusAlt)}` : item.platinAlt ? ` / ${labelInventorySubcategory(item.platinAlt)}` : ''}</td>
                    <td className="px-3 py-3 text-sg-text-soft">{formatNumber(item.toplamGram || item.birimGram * item.adet, ' g')}</td>
                    <td className="px-3 py-3 text-sg-text-soft">{formatMoney(item.alisFiyati)}</td>
                    <td className="px-3 py-3 text-sg-text-soft">{labelShopSyncStatus(item.shopDurumu || null)}</td>
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
              <button key={item.id} type="button" onClick={() => state.onOpenDetail(item.id)} className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-4 text-left">
                <p className="text-sm font-semibold text-sg-text">{item.urun}</p>
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

        <ModernSection title="Seçili Ürün" subtitle="Tarih, kaynak AFG, fotoğraf ve denetim özetleri.">
          {!selected ? (
            <EmptyState title="Ürün Seçilmedi" message="Stok listesinden bir ürün seçildiğinde detay paneli burada açılır." />
          ) : (
            <>
              <div className="rounded-sg-xl border border-sg-border bg-sg-surface-soft p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Ürün Kartı</p>
                    <p className="mt-1 text-lg font-semibold text-sg-text">{selected.display_name || selected.product_number}</p>
                    <p className="mt-1 text-sm text-sg-text-soft">{selected.product_number} · {selected.reference_number || 'Ref yok'}</p>
                  </div>
                  <span className="rounded-full border border-sg-border bg-sg-surface px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">
                    {selected.status}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-sg-lg border border-sg-border bg-sg-surface p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Finans</p>
                    <p className="mt-1 text-sm text-sg-text">{formatMoney(selected.purchase_price_dkk)}</p>
                    <p className="mt-1 text-xs text-sg-text-soft">{formatNumber(selected.total_weight_grams || selected.weight_grams, ' g')}</p>
                  </div>
                  <div className="rounded-sg-lg border border-sg-border bg-sg-surface p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Kaynak</p>
                    <p className="mt-1 text-sm text-sg-text">{state.productSourceAfg?.document_number || 'AFG bağlı değil'}</p>
                    <p className="mt-1 text-xs text-sg-text-soft">{state.productSourceAfg?.issued_at ? formatDate(state.productSourceAfg.issued_at) : '—'}</p>
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
        </>
      )}
    </ModernModuleShell>
  );
}

function ModernDepolamaOfficeSurface({ onClose }: { onClose: () => void | Promise<void> }) {
  return (
    <div className="flex min-h-0 h-full flex-1 flex-col overflow-hidden rounded-sg-xl border border-sg-border bg-sg-surface shadow-sg-md">
      <EmbeddedWorkbookPanel kind="depolama" artifactKey="live" layoutMode="workspace" onClose={onClose} variant="modern" />
    </div>
  );
}

function MobileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="font-semibold text-sg-text-soft">{label}</dt>
      <dd className="text-right text-sg-text">{value}</dd>
    </div>
  );
}
