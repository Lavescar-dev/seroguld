import { Camera, Check, Eye, FileSpreadsheet, Flame, Images, Loader2, Search, Tag, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { ModernDepolamaViewModel } from '@/modern/adapters/depolama';
import { formatDate, formatMoney, formatNumber, labelInventoryCategory, labelInventorySubcategory, labelShopSyncStatus } from '@/lib/format';
import { LABEL_PRINTING_ENABLED } from '@/lib/featureFlags';
import { buildMediaUrl } from '@/lib/media';
import { EmbeddedWorkbookPanel } from '@/make/embedded/EmbeddedWorkbookPanel';
import { ALLOWED_STATUS_TRANSITIONS, PRODUCT_STATUS_LABEL, PRODUCT_STATUS_TONE, STATUS_FILTER_OPTIONS, describeActiveInventoryFilters, type InventoryLifecycleStatus, type MainCategory, type PlatinumSub, type SilverSub, type StokItem } from '@/make/depolama/types';
import { InventoryWorkbookImport } from '@/make/depolama/InventoryWorkbookImport';
import { DepolamaPhotoLibraryDrawer } from '@/make/depolama/DepolamaPhotoLibraryDrawer';
import { LegacyMigrationCenter } from '@/components/LegacyMigrationCenter';

import { DataPill, EmptyState, LoadingState, ModernModuleShell, ModernSection, ModernStatGrid, shellButtonClass } from './shared';
import { ModernOfficeSurface } from './ModernOfficeSurface';

const MODERN_STATUS_TONE_CLASS: Record<string, string> = {
  success: 'bg-sg-green-soft text-sg-green-strong border border-sg-green/30',
  warning: 'bg-sg-amber-soft text-sg-amber border border-sg-amber/30',
  danger: 'bg-sg-red-soft text-sg-red border border-sg-red/30',
  neutral: 'bg-sg-surface text-sg-text-soft border border-sg-border',
};

function ModernStatusBadge({ status }: { status?: string }) {
  // Aktif stok varsayılan görünüm — yalnız ayırt edici durumlarda rozet göster.
  if (!status || status === 'in_inventory') return null;
  const tone = PRODUCT_STATUS_TONE[status] ?? 'neutral';
  return (
    <span className={`ml-2 inline-block whitespace-nowrap rounded-sg-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${MODERN_STATUS_TONE_CLASS[tone]}`}>
      {PRODUCT_STATUS_LABEL[status] ?? status}
    </span>
  );
}

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
          {editing.mainKat === 'gumus' ? <label htmlFor="inventory-silver-subcategory" className="text-xs font-semibold text-sg-text-soft">Gümüş türü<select id="inventory-silver-subcategory" name="silver_subcategory" value={editing.gumusAlt || 'smykker'} onChange={(event) => update({ gumusAlt: event.target.value as SilverSub })} className={editorInputClass}><option value="smykker">Takı</option><option value="barrer">Külçe</option><option value="monter">Sikke (Mønter)</option></select></label> : null}
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
          <label htmlFor="inventory-producer" className="text-xs font-semibold text-sg-text-soft">Üretici / Marka<input id="inventory-producer" name="producer" value={editing.uretici || ''} onChange={(event) => update({ uretici: event.target.value || undefined })} className={editorInputClass} /></label>
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
  // Seçili ürünü düzenlemek için listedeki StokItem karşılığı gerekir
  // (klasik drawer'daki selectedDraft deseniyle aynı).
  const selectedDraft = selected ? state.stokList.find((item) => item.id === selected.id) ?? null : null;
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
      subtitle="Stok, GDPR bekleme süresi ve ürün yaşam döngüsü tek ekranda."
      badges={
        <>
          <DataPill label="Kategori" value={categoryScope === 'all' ? 'Tüm ürünler' : labelInventoryCategory(categoryScope)} />
          <DataPill label="Görünüm" value={state.activeView === 'excel' ? 'Office' : 'Sistem'} tone={state.activeView === 'excel' ? 'warning' : 'neutral'} />
          <DataPill label="Fiyat" value={state.savingPrices ? 'Kaydediliyor' : 'Hazır'} tone={state.savingPrices ? 'warning' : 'success'} />
        </>
      }
      actions={
        <>
          <button type="button" onClick={() => state.setPriceOpen(!state.priceOpen)} className={shellButtonClass(state.priceOpen ? 'primary' : 'secondary')}>
            Fiyatlar · Au {state.prices.gold} / Ag {state.prices.silver}
          </button>
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

      {categoryScope === 'gumus' ? (
        <div className="flex flex-wrap gap-2 rounded-sg-xl border border-sg-border bg-sg-surface p-2" role="group" aria-label="Gümüş alt tipi">
          {([['smykker', 'Takı'], ['barrer', 'Külçe'], ['monter', 'Sikke']] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => state.setGumusAlt(key)} aria-pressed={state.gumusAlt === key} className={state.gumusAlt === key ? shellButtonClass('primary') : shellButtonClass('ghost')}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {categoryScope === 'platin_pd' ? (
        <div className="flex flex-wrap gap-2 rounded-sg-xl border border-sg-border bg-sg-surface p-2" role="group" aria-label="Platin alt tipi">
          {([['platin', 'Platin'], ['palladyum', 'Palladyum']] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => state.setPlatinAlt(key)} aria-pressed={state.platinAlt === key} className={state.platinAlt === key ? shellButtonClass('primary') : shellButtonClass('ghost')}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {state.priceOpen ? (
        <ModernSection title="Günlük piyasa fiyatları (DKK/g)" subtitle="Spot değerleme bu fiyatlarla hesaplanır; Kaydet tüm cihazlara uygular.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ['gold', 'Altın 24K'],
              ['silver', 'Gümüş'],
              ['platin', 'Platin'],
              ['palladyum', 'Palladyum'],
            ] as const).map(([key, label]) => (
              <NumericDraftInput
                key={key}
                id={`market-price-${key}`}
                label={label}
                value={state.prices[key]}
                onCommit={(value) => state.setPrices((current) => ({ ...current, [key]: value }))}
              />
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => state.setPriceOpen(false)} className={shellButtonClass('secondary')}>Kapat</button>
            <button type="button" onClick={state.savePrices} disabled={state.savingPrices} className={shellButtonClass('primary')}>
              {state.savingPrices ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </ModernSection>
      ) : null}

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
            <label className="text-xs font-semibold text-sg-text-soft">Durum
              <select
                value={state.filters.status}
                onChange={(event) => state.setFilters((current) => ({ ...current, status: event.target.value }))}
                className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none"
                title="Ürün durumu (satılmış/eritilmiş dahil görüntüle)"
              >
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <option key={option.value || 'default'} value={option.value}>
                    {option.value ? `Durum: ${option.label}` : option.label}
                  </option>
                ))}
              </select>
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
                    <td className="px-3 py-3 font-medium text-sg-text">{item.urun}<ModernStatusBadge status={item.productStatus} /></td>
                    <td className="px-3 py-3 text-sg-text-soft">{labelInventoryCategory(item.mainKat)}{item.gumusAlt ? ` / ${labelInventorySubcategory(item.gumusAlt)}` : item.platinAlt ? ` / ${labelInventorySubcategory(item.platinAlt)}` : ''}</td>
                    <td className="px-3 py-3 text-sg-text-soft">{formatNumber(item.toplamGram || item.birimGram * item.adet, ' g')}</td>
                    <td className="px-3 py-3 text-sg-text-soft">{formatMoney(item.alisFiyati)}</td>
                    <td className="px-3 py-3 text-sg-text-soft">{labelShopSyncStatus(item.shopDurumu || null)}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => state.onOpenDetail(item.id)} className={shellButtonClass('ghost')}>Detay</button>
                        <button type="button" onClick={() => state.setEditing(item)} className={shellButtonClass('ghost')}>Düzenle</button>
                        <button
                          type="button"
                          disabled={state.deletingItem}
                          onClick={() => { if (window.confirm(`"${item.urun}" silinsin mi?`)) state.deleteItem(item.id); }}
                          className={shellButtonClass('ghost')}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-sg-red" />
                        </button>
                        {LABEL_PRINTING_ENABLED ? <button type="button" onClick={() => state.onPrintLabel(item.id, item.urun)} className={shellButtonClass('ghost')}>Etiket</button> : null}
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
                <p className="text-sm font-semibold text-sg-text">{item.urun}<ModernStatusBadge status={item.productStatus} /></p>
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
                    {PRODUCT_STATUS_LABEL[selected.status] || selected.status}
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
                {selectedDraft ? (
                  <button type="button" onClick={() => state.setEditing(selectedDraft)} className={shellButtonClass('primary')}>
                    Düzenle
                  </button>
                ) : null}
                <button type="button" onClick={() => state.onOpenWooProduct(selected.id)} className={shellButtonClass('secondary')}>
                  <Eye className="h-4 w-4" />
                  Woo
                </button>
                {LABEL_PRINTING_ENABLED ? (
                  <button type="button" onClick={() => state.onPrintLabel(selected.id, selected.product_number)} disabled={state.printingLabelForId === selected.id} className={shellButtonClass('secondary')}>
                    <Tag className="h-4 w-4" />
                    Etiket
                  </button>
                ) : null}
              </div>

              <ModernLifecycleControls state={state} product={selected} />
              <ModernPhotoSection state={state} product={selected} />
            </>
          )}
        </ModernSection>
      </div>
        </>
      )}
    </ModernModuleShell>
  );
}

function ModernLifecycleControls({
  state,
  product,
}: {
  state: ModernDepolamaViewModel['state'];
  product: NonNullable<ModernDepolamaViewModel['state']['selectedProduct']>;
}) {
  const [meltMode, setMeltMode] = useState(false);
  const [meltReason, setMeltReason] = useState('');
  const [saleMode, setSaleMode] = useState(false);
  const [salePriceInput, setSalePriceInput] = useState('');
  useEffect(() => {
    setMeltMode(false);
    setMeltReason('');
    setSaleMode(false);
    setSalePriceInput('');
  }, [product.id]);

  const allowedNext: InventoryLifecycleStatus[] = ALLOWED_STATUS_TRANSITIONS[product.status] || [];
  const canSell = product.status === 'for_sale';
  if (allowedNext.length === 0 && !canSell) return null;
  const busy = state.updatingStatus;
  const meltReasonValid = meltReason.trim().length >= 3;
  const salePrice = Number(salePriceInput.replace(',', '.'));
  const salePriceValid = Number.isFinite(salePrice) && salePrice > 0;

  return (
    <div className="mt-4 rounded-sg-xl border border-sg-border bg-sg-surface-soft p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Sonraki durum</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {allowedNext.includes('in_inventory') ? (
          <button type="button" disabled={busy} onClick={() => state.onUpdateProductStatus(product.id, 'in_inventory')} className={shellButtonClass('secondary')}>Depoda tut</button>
        ) : null}
        {allowedNext.includes('for_sale') ? (
          <button type="button" disabled={busy} onClick={() => state.onUpdateProductStatus(product.id, 'for_sale')} className={shellButtonClass('secondary')}>Satışa hazırla</button>
        ) : null}
        {allowedNext.includes('undecided') ? (
          <button type="button" disabled={busy} onClick={() => state.onUpdateProductStatus(product.id, 'undecided')} className={shellButtonClass('secondary')}>Karar bekliyor</button>
        ) : null}
        {allowedNext.includes('melted') ? (
          <button type="button" disabled={busy} onClick={() => { setMeltMode((current) => !current); setSaleMode(false); }} className={shellButtonClass('danger')}>
            <Flame className="h-4 w-4" />
            Erit
          </button>
        ) : null}
        {canSell ? (
          <button type="button" disabled={busy} onClick={() => { setSaleMode((current) => !current); setMeltMode(false); }} className={shellButtonClass('primary')}>Satıldı olarak işaretle</button>
        ) : null}
      </div>

      {meltMode ? (
        <div className="mt-3 grid gap-2">
          <label htmlFor="modern-melt-reason" className="text-xs font-semibold text-sg-text-soft">
            Eritme gerekçesi (en az 3 karakter)
            <input id="modern-melt-reason" value={meltReason} onChange={(event) => setMeltReason(event.target.value)} className={editorInputClass} placeholder="Örn. hurda, hasarlı" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setMeltMode(false); setMeltReason(''); }} className={shellButtonClass('secondary')}>Vazgeç</button>
            <button
              type="button"
              disabled={busy || !meltReasonValid}
              onClick={() => { state.onUpdateProductStatus(product.id, 'melted', meltReason.trim()); setMeltMode(false); setMeltReason(''); }}
              className={shellButtonClass('danger')}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flame className="h-4 w-4" />}
              Eritmeye taşı
            </button>
          </div>
        </div>
      ) : null}

      {saleMode ? (
        <div className="mt-3 grid gap-2">
          <label htmlFor="modern-sale-price" className="text-xs font-semibold text-sg-text-soft">
            Satış fiyatı (DKK)
            <input id="modern-sale-price" inputMode="decimal" value={salePriceInput} onChange={(event) => setSalePriceInput(event.target.value)} className={editorInputClass} placeholder="0,00" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setSaleMode(false); setSalePriceInput(''); }} className={shellButtonClass('secondary')}>Vazgeç</button>
            <button
              type="button"
              disabled={busy || !salePriceValid}
              onClick={() => { state.onUpdateProductStatus(product.id, 'sold' as InventoryLifecycleStatus, null, salePrice); setSaleMode(false); setSalePriceInput(''); }}
              className={shellButtonClass('primary')}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Sat
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModernPhotoSection({
  state,
  product,
}: {
  state: ModernDepolamaViewModel['state'];
  product: NonNullable<ModernDepolamaViewModel['state']['selectedProduct']>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const photos = product.photos || [];
  const attachedUrls = photos.map((photo) => photo.url);
  return (
    <div className="mt-4 rounded-sg-xl border border-sg-border bg-sg-surface-soft p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Fotoğraflar ({photos.length})</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setLibraryOpen(true)} disabled={state.attachingLibraryPhoto} className={shellButtonClass('secondary')} title="Depolama foto havuzundan iliştir">
            {state.attachingLibraryPhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />}
            Havuz
          </button>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="image/*"
            multiple
            aria-label="Ürün fotoğrafı seç"
            onChange={(event) => {
              const files = event.currentTarget.files;
              if (files && files.length > 0) state.onUploadPhotos(product.id, files);
              event.currentTarget.value = '';
            }}
          />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={state.uploadingPhotos} className={shellButtonClass('secondary')}>
            {state.uploadingPhotos ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {state.uploadingPhotos ? 'Yükleniyor' : 'Foto yükle'}
          </button>
        </div>
      </div>
      <DepolamaPhotoLibraryDrawer
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onSelect={(file) => state.onAttachLibraryPhoto(product.id, file)}
        attaching={state.attachingLibraryPhoto}
        attachedUrls={attachedUrls}
      />
      <div
        onDragOver={(event) => { event.preventDefault(); if (!state.uploadingPhotos) setDragActive(true); }}
        onDragLeave={(event) => { if (event.currentTarget === event.target || !event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          if (state.uploadingPhotos) return;
          const images = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith('image/'));
          if (images.length) state.onUploadPhotos(product.id, images);
        }}
        className={`mt-3 rounded-sg-md transition ${dragActive ? 'ring-2 ring-sg-accent bg-sg-accent-soft/40' : ''}`}
      >
        {photos.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {photos.slice(0, 9).map((photo) => (
              <div key={photo.id || photo.url} className="group relative overflow-hidden rounded-sg-md border border-sg-border bg-sg-surface">
                <img src={buildMediaUrl(photo.url)} alt={photo.filename || product.display_name || 'Ürün'} className="h-24 w-full object-cover" />
                {photo.id ? (
                  <button
                    type="button"
                    disabled={state.deletingPhoto}
                    onClick={() => { if (window.confirm('Bu fotoğraf silinsin mi?')) state.onDeletePhoto(product.id, photo.id!); }}
                    aria-label="Fotoğrafı sil"
                    className="absolute right-1 top-1 hidden rounded-sg-md border border-sg-red/30 bg-sg-surface/95 p-1 text-sg-red hover:bg-sg-red-soft group-hover:block disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className={`rounded-sg-md border border-dashed px-4 py-5 text-sm ${dragActive ? 'border-sg-accent text-sg-accent-dark' : 'border-sg-border text-sg-text-soft'}`}>
            {dragActive ? 'Fotoğrafları buraya bırakın' : 'Henüz fotoğraf yok. "Foto yükle" ile ekleyin veya görselleri buraya sürükleyip bırakın.'}
          </p>
        )}
      </div>
    </div>
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
