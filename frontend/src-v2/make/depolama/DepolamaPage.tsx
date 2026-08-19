import { type Dispatch, type FormEvent, type SetStateAction, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Camera,
  ChevronDown,
  ChevronUp,
  Edit2,
  Flame,
  History,
  Loader2,
  Lock,
  PackageCheck,
  Plus,
  Printer,
  Save,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';

import type { ProductHistoryEntry, ProductOut, ProductSourceAfg } from '@/types';

import { useConfirm } from '@/components/ConfirmDialog';
import { CommittedNumericInput } from '@/shared/forms/CommittedNumericInput';
import { EmbeddedWorkbookPanel } from '../embedded/EmbeddedWorkbookPanel';
import { InventoryDataTable } from './InventoryDataTable';
import { InventoryFilters } from './InventoryFilters';
import { InventoryWorkbookImport } from './InventoryWorkbookImport';
import type {
  CategoryTotals,
  InventoryFilterState,
  InventoryLifecycleStatus,
  InventorySortKey,
  InventorySortState,
  InventorySurfaceView,
  MainCategory,
  MarketPrices,
  PlatinumSub,
  SilverSub,
  StokItem,
} from './types';

const GOLD_PURITIES = [
  { label: '24K / Barren', saflik: 0.9999 },
  { label: '22K', saflik: 0.9166 },
  { label: '21.6K', saflik: 0.9 },
  { label: '21K', saflik: 0.875 },
  { label: '18K', saflik: 0.75 },
  { label: '14K', saflik: 0.585 },
  { label: '8K', saflik: 0.3333 },
] as const;

const SILVER_PURITIES = [
  { label: 'Finsølv 999', saflik: 0.999 },
  { label: 'Sterling 925', saflik: 0.925 },
  { label: '3-tårnet 830', saflik: 0.83 },
  { label: 'Plet', saflik: 0.8 },
  { label: 'Sølv 600', saflik: 0.6 },
  { label: 'Sølv 400', saflik: 0.4 },
] as const;

const PLAT_PURITIES = [
  { label: 'Platin 999.5', saflik: 0.9995 },
  { label: 'Palladyum 999.5', saflik: 0.9995 },
] as const;

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;
const sansStyle = { fontFamily: "'IBM Plex Sans', system-ui, sans-serif" } as const;

const cellIn =
  'w-full px-2 py-1 border border-brand-300 bg-white focus:outline-none focus:border-brand-700 focus:bg-brand-50 text-brand-900 text-sm';
const labelCls = 'text-xs font-bold text-brand-500 uppercase tracking-wider block mb-1';

function formatWorkbookStamp(value?: string | null) {
  return value?.trim() ? `Son güncelleme · ${value}` : 'Canlı workbook hazır';
}

function toplamGram(item: StokItem) {
  return item.toplamGram ?? item.birimGram * item.adet;
}

function hasMetalGram(item: StokItem) {
  return item.hasMetalGrams ?? toplamGram(item) * item.saflik;
}

function spotDeger(item: StokItem) {
  return item.spotDegeri ?? 0;
}

function getPurityOptions(kat: MainCategory) {
  if (kat === 'gumus') return SILVER_PURITIES;
  if (kat === 'platin_pd') return PLAT_PURITIES;
  return GOLD_PURITIES;
}

function SummaryCell({
  label,
  value,
  sub,
  color,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  color: 'amber' | 'slate' | 'zinc' | 'brand' | 'emerald';
  highlight?: boolean;
}) {
  const bg = highlight ? 'bg-emerald-800' : 'bg-white';
  const valueColor =
    color === 'amber'
      ? 'text-amber-700'
      : color === 'slate'
        ? 'text-slate-600'
        : color === 'emerald'
          ? 'text-emerald-100'
          : color === 'zinc'
            ? 'text-zinc-600'
            : 'text-brand-800';

  return (
    <div className={`${bg} border-r border-brand-200 last:border-r-0 px-5 py-3`}>
      <p className={`text-xs font-black uppercase tracking-wider ${highlight ? 'text-emerald-400' : 'text-brand-500'}`}>{label}</p>
      <p className={`text-base font-black ${valueColor}`} style={monoStyle}>
        {value}
      </p>
      {sub ? (
        <p className={`text-xs ${highlight ? 'text-emerald-400' : 'text-brand-400'}`} style={monoStyle}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

function CalcCell({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: 'brand' | 'amber' | 'emerald' | 'red';
}) {
  const valueColor =
    color === 'amber'
      ? 'text-amber-800'
      : color === 'emerald'
        ? 'text-emerald-800'
        : color === 'red'
          ? 'text-red-700'
          : 'text-brand-800';
  return (
    <div className="border-r border-emerald-200 px-4 py-3 last:border-r-0">
      <p className="text-xs font-black uppercase tracking-wider text-brand-500">{label}</p>
      <p className={`text-base font-black ${valueColor}`} style={monoStyle}>
        {value}
      </p>
    </div>
  );
}

function StokForm({
  editing,
  upd,
}: {
  editing: StokItem;
  upd: <K extends keyof StokItem>(field: K, value: StokItem[K]) => void;
}) {
  const kat = editing.mainKat;
  const isTaki = kat === 'taki';
  const isGumus = kat === 'gumus';
  const isPlatinPd = kat === 'platin_pd';

  const toplam = toplamGram(editing);
  const has = hasMetalGram(editing);
  const spot = spotDeger(editing);
  const fark = editing.shopFark;
  const purityOptions = getPurityOptions(kat);

  return (
    <div className="p-6">
      <div className="grid grid-cols-4 gap-x-6 gap-y-4 border-2 border-brand-200 bg-brand-50 p-5">
        <div>
          <label className={labelCls}>Kategori</label>
          <select value={kat} onChange={(event) => upd('mainKat', event.target.value as MainCategory)} className={cellIn} disabled>
            <option value="kulce">Guldbarrer</option>
            <option value="sikke">Guldmønter</option>
            <option value="taki">Guldsmykker</option>
            <option value="gumus">Sølv</option>
            <option value="platin_pd">Platin / Palladyum</option>
          </select>
        </div>

        {isGumus ? (
          <div>
            <label className={labelCls}>Sølv Alt Tipi</label>
            <select value={editing.gumusAlt || 'smykker'} onChange={(event) => upd('gumusAlt', event.target.value as SilverSub)} className={cellIn}>
              <option value="smykker">Smykker</option>
              <option value="barrer">Sølvbarrer</option>
              <option value="monter">Sølvmønter</option>
            </select>
          </div>
        ) : null}

        {isPlatinPd ? (
          <div>
            <label className={labelCls}>Metal</label>
            <select value={editing.platinAlt || 'platin'} onChange={(event) => upd('platinAlt', event.target.value as PlatinumSub)} className={cellIn}>
              <option value="platin">Platin</option>
              <option value="palladyum">Palladyum</option>
            </select>
          </div>
        ) : null}

        {isTaki ? (
          <div>
            <label className={labelCls}>Stok No</label>
            <input
              type="text"
              value={editing.stokNo || ''}
              onChange={(event) => upd('stokNo', event.target.value)}
              className={cellIn}
              style={monoStyle}
              placeholder="1460"
            />
          </div>
        ) : null}

        <div>
          <label className={labelCls}>Lager Dato</label>
          <input type="date" value={editing.lagerDato} onChange={(event) => upd('lagerDato', event.target.value)} className={cellIn} />
        </div>

        <div className="col-span-2">
          <label className={labelCls}>Ürün / Vare</label>
          <input
            type="text"
            value={editing.urun}
            onChange={(event) => upd('urun', event.target.value)}
            className={cellIn}
            placeholder={
              kat === 'kulce'
                ? 'Umicore 100g'
                : kat === 'sikke'
                  ? 'Britannia 1oz'
                  : kat === 'taki'
                    ? 'Panzer armlænke 22K'
                    : 'Metalor 1000g'
            }
          />
        </div>

        <div>
          <label className={labelCls}>Saflık / Karat</label>
          <select value={editing.saflik} onChange={(event) => upd('saflik', Number(event.target.value))} className={cellIn}>
            {purityOptions.map((item) => (
              <option key={item.saflik} value={item.saflik}>
                {item.label} ({(item.saflik * 1000).toFixed(0)}‰)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>Birim Gram</label>
          <CommittedNumericInput
            value={editing.birimGram}
            rules={{ kind: 'decimal', required: true, allowNegative: false, min: 0, precision: 3 }}
            onCommit={(value) => { if (value !== null) upd('birimGram', value); }}
            className={cellIn}
            style={monoStyle}
            placeholder="0.000"
          />
        </div>

        <div>
          <label className={labelCls}>Adet / Antal</label>
          <CommittedNumericInput
            value={editing.adet}
            rules={{ kind: 'integer', required: true, allowNegative: false, min: 1 }}
            onCommit={(value) => { if (value !== null) upd('adet', value); }}
            className={cellIn}
            style={monoStyle}
          />
        </div>

        <div>
          <label className={labelCls}>Alış Fiyatı (DKK)</label>
          <CommittedNumericInput
            value={editing.alisFiyati}
            rules={{ kind: 'decimal', required: true, allowNegative: false, min: 0, precision: 2 }}
            onCommit={(value) => { if (value !== null) upd('alisFiyati', value); }}
            className={cellIn}
            style={monoStyle}
            placeholder="0.00"
          />
        </div>

        <div>
          <label className={labelCls}>Üretici / Marka</label>
          <input
            type="text"
            value={editing.uretici || ''}
            onChange={(event) => upd('uretici', event.target.value)}
            className={cellIn}
            placeholder="Umicore, Metalor..."
          />
        </div>

        <div>
          <label className={labelCls}>Depo Lokasyonu</label>
          <input
            type="text"
            value={editing.storageLocation || ''}
            onChange={(event) => upd('storageLocation', event.target.value)}
            className={cellIn}
            placeholder="A-3, Kasa 1..."
          />
        </div>

        {isTaki ? (
          <>
            <div>
              <label className={labelCls}>Shop Fiyatı (DKK)</label>
              <CommittedNumericInput
                value={editing.shopFiyati}
                rules={{ kind: 'decimal', required: false, allowNegative: false, min: 0, precision: 2 }}
                onCommit={(value) => upd('shopFiyati', value ?? undefined)}
                className={cellIn}
                style={monoStyle}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className={labelCls}>Shop Durumu</label>
              <select
                value={editing.shopDurumu || ''}
                onChange={(event) => upd('shopDurumu', (event.target.value || undefined) as StokItem['shopDurumu'])}
                className={cellIn}
              >
                <option value="">— Seçin —</option>
                <option value="hazir">Hazır</option>
                <option value="mangler_foto">Mangler foto</option>
                <option value="listelendi">Listelendi</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Uzunluk / Çap</label>
              <input
                type="text"
                value={editing.olcuUzunluk || ''}
                onChange={(event) => upd('olcuUzunluk', event.target.value)}
                className={cellIn}
                style={monoStyle}
                placeholder="45cm / Dia. Ø63"
              />
            </div>
            <div>
              <label className={labelCls}>Genişlik (mm)</label>
              <CommittedNumericInput
                value={editing.olcuGenislik}
                rules={{ kind: 'decimal', required: false, allowNegative: false, min: 0, precision: 2 }}
                onCommit={(value) => upd('olcuGenislik', value ?? undefined)}
                className={cellIn}
                style={monoStyle}
              />
            </div>
            <div>
              <label className={labelCls}>Kalınlık (mm)</label>
              <CommittedNumericInput
                value={editing.olcuKalinlik}
                rules={{ kind: 'decimal', required: false, allowNegative: false, min: 0, precision: 2 }}
                onCommit={(value) => upd('olcuKalinlik', value ?? undefined)}
                className={cellIn}
                style={monoStyle}
              />
            </div>
          </>
        ) : null}

        <div className="col-span-2">
          <label className={labelCls}>Notlar</label>
          <input
            type="text"
            value={editing.notlar || ''}
            onChange={(event) => upd('notlar', event.target.value)}
            className={cellIn}
            placeholder="Ek bilgi..."
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-5 border-2 border-emerald-200 bg-emerald-50">
        <CalcCell label="Toplam Gram" value={`${toplam.toFixed(3)} g`} color="brand" />
        <CalcCell label={isGumus ? 'Finsølv' : 'Finguld'} value={`${has.toFixed(3)} g`} color="amber" />
        <CalcCell label="Alış Fiyatı" value={`${editing.alisFiyati.toFixed(0)} DKK`} color="brand" />
        <CalcCell label="Spot Değer (I)" value={`${spot.toFixed(0)} DKK`} color="emerald" />
        {isTaki && fark != null ? (
          <CalcCell label="Shop Fark" value={`${fark >= 0 ? '+' : ''}${fark.toFixed(0)} DKK`} color={fark >= 0 ? 'emerald' : 'red'} />
        ) : (
          <div className="border-l border-emerald-200 px-4 py-3" />
        )}
      </div>
    </div>
  );
}

const PRODUCT_STATUS_LABEL: Record<string, string> = {
  purchased: 'Giriş Bekliyor',
  in_inventory: 'Depoda',
  for_sale: 'Satış Hazır',
  undecided: 'Karar Bekliyor',
  sold: 'Satıldı',
  melted: 'Eritildi',
};

const PRODUCT_STATUS_TONE: Record<string, string> = {
  purchased: 'border-brand-300 bg-brand-100 text-brand-700',
  in_inventory: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  for_sale: 'border-sky-300 bg-sky-50 text-sky-700',
  undecided: 'border-amber-300 bg-amber-50 text-amber-800',
  sold: 'border-zinc-300 bg-zinc-100 text-zinc-700',
  melted: 'border-rose-300 bg-rose-50 text-rose-700',
};

// Backend `_allowed_status_transition` ile sync (product_service.py:120-145)
const ALLOWED_TRANSITIONS: Record<string, InventoryLifecycleStatus[]> = {
  purchased: ['in_inventory', 'undecided', 'melted'],
  in_inventory: ['for_sale', 'melted', 'undecided'],
  for_sale: ['in_inventory', 'melted'], // sold ayrı akış (sale_price gerek)
  undecided: ['in_inventory', 'for_sale', 'melted'],
  sold: [],
  melted: [],
};

const HISTORY_ACTION_LABEL: Record<string, string> = {
  created: 'Oluşturuldu',
  updated: 'Güncellendi',
  deleted: 'Silindi',
  status_changed: 'Durum değişti',
  gdpr_lock_updated: 'GDPR durumu',
  photo_uploaded: 'Fotoğraf eklendi',
  photo_deleted: 'Fotoğraf silindi',
};

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="border border-brand-200 bg-white px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">{label}</p>
      <p className={`mt-1 text-sm text-brand-900 ${mono ? 'font-black' : 'font-semibold'}`} style={mono ? monoStyle : undefined}>
        {value || '—'}
      </p>
    </div>
  );
}

function InventorySurfaceTabs({
  activeView,
  setActiveView,
  workbookStatus,
}: {
  activeView: InventorySurfaceView;
  setActiveView: Dispatch<SetStateAction<InventorySurfaceView>>;
  workbookStatus: string;
}) {
  return (
    <div className="border-b-2 border-brand-300 bg-brand-50 px-4 py-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: 'system' as const, label: 'System', shortLabel: 'SYS' },
          { key: 'excel' as const, label: 'Excel', shortLabel: 'XLSX' },
        ].map((tab) => {
          const isActive = activeView === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveView(tab.key)}
              className={`inline-flex items-center gap-2 border px-3 py-2 text-[11px] font-black uppercase tracking-widest transition ${
                isActive
                  ? 'border-brand-900 bg-brand-900 text-white'
                  : 'border-brand-300 bg-white text-brand-700 hover:bg-brand-100'
              }`}
            >
              <span className={`mono px-1.5 py-0.5 text-[10px] ${isActive ? 'bg-brand-700 text-brand-100' : 'bg-brand-100 text-brand-600'}`}>
                {tab.shortLabel}
              </span>
              {tab.label}
            </button>
          );
        })}
        <InventoryWorkbookImport variant="classic" />
        <div className="ml-auto flex min-w-0 items-center gap-2 border border-emerald-200 bg-white px-3 py-2">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Depolama.xlsx</p>
            <p className="truncate text-[11px] text-brand-500">{workbookStatus}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InventoryExcelSurface() {
  return (
    <div className="flex-1 min-h-0 border-b-2 border-brand-300 bg-stone-100">
      <div className="h-[calc(100vh-16rem)] min-h-[760px]">
        <EmbeddedWorkbookPanel kind="depolama" artifactKey="live" layoutMode="workspace" />
      </div>
    </div>
  );
}

function MeltConfirmDialog({
  open,
  onCancel,
  onConfirm,
  pending,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState('');
  if (!open) return null;
  const isValid = reason.trim().length >= 3;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isValid) return;
    onConfirm(reason.trim());
    setReason('');
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
      <form onSubmit={submit} className="w-full max-w-md border-2 border-rose-300 bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <Flame className="h-5 w-5 flex-shrink-0 text-rose-700" />
          <div className="flex-1">
            <h3 className="text-base font-black uppercase tracking-widest text-rose-800">Eritmeye Taşı</h3>
            <p className="mt-1 text-sm text-brand-700">
              Bu işlem geri alınamaz. Lütfen eritme nedenini en az 3 karakterle yazın.
            </p>
            <textarea
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Örn: Hasarlı kilit / takı kırık / stok dışı yönetim kararı"
              className="mt-3 w-full border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-rose-500"
              rows={3}
              minLength={3}
              required
            />
            <p className="mt-1 text-[10px] text-rose-600">Min. 3 karakter.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setReason('');
                  onCancel();
                }}
                className="border border-brand-300 bg-white px-3 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50"
              >
                İptal
              </button>
              <button
                type="submit"
                disabled={!isValid || pending}
                className="flex items-center gap-1 border border-rose-600 bg-rose-700 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Flame className="h-3 w-3" />}
                Eritmeye Taşı
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function ProductHistoryPanel({
  entries,
  loading,
}: {
  entries: ProductHistoryEntry[];
  loading: boolean;
}) {
  if (loading) {
    return <div className="px-4 py-3 text-xs text-brand-500">Geçmiş yükleniyor...</div>;
  }
  if (entries.length === 0) {
    return <div className="px-4 py-3 text-xs text-brand-400">Geçmiş kaydı yok.</div>;
  }
  return (
    <ol className="space-y-1.5">
      {entries.slice(0, 12).map((entry) => (
        <li key={entry.id} className="border border-brand-200 bg-white px-3 py-2 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-black uppercase tracking-widest text-brand-700">
              {HISTORY_ACTION_LABEL[entry.action] || entry.action}
            </span>
            <span className="mono text-[10px] text-brand-400">
              {new Date(entry.created_at).toLocaleString(document.documentElement.lang)}
            </span>
          </div>
          {entry.performed_by_email ? (
            <p className="mt-0.5 text-[10px] text-brand-500">{entry.performed_by_email}</p>
          ) : null}
          {entry.notes ? <p className="mt-1 text-[11px] text-brand-700">{entry.notes}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function ProductPhotoSection({
  product,
  onUpload,
  onDelete,
  uploading,
  deleting,
}: {
  product: ProductOut;
  onUpload: (files: FileList | File[]) => void;
  onDelete: (photoId: string) => void;
  uploading: boolean;
  deleting: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <section>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Fotoğraflar ({product.photos.length})</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 border border-brand-300 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-brand-700 hover:bg-brand-50 disabled:cursor-wait disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
          Yükle
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files && event.target.files.length > 0) {
              onUpload(event.target.files);
              event.target.value = '';
            }
          }}
        />
      </div>

      {product.photos.length > 0 ? (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {product.photos.slice(0, 9).map((photo) => (
            <div key={photo.id || photo.url} className="group relative overflow-hidden border border-brand-200 bg-white">
              <img src={photo.url} alt={photo.filename || product.display_name || 'Ürün'} className="h-24 w-full object-cover" />
              {photo.id ? (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => onDelete(photo.id!)}
                  className="absolute right-1 top-1 hidden border border-red-300 bg-white/95 p-1 text-red-600 hover:bg-red-100 group-hover:block disabled:opacity-50"
                  title="Fotoğrafı sil"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 border border-dashed border-brand-300 bg-white px-4 py-5 text-xs text-brand-500">
          Bu ürün için henüz foto yok. Yükle butonuyla ekleyin.
        </div>
      )}
    </section>
  );
}

function ProductSourceAfgPanel({
  data,
  loading,
}: {
  data: ProductSourceAfg | null;
  loading: boolean;
}) {
  if (loading) {
    return <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">AFG kaynağı yükleniyor...</div>;
  }
  if (!data) {
    return (
      <div className="border border-brand-200 bg-brand-50 px-4 py-3 text-xs text-brand-500">
        Bu ürün AFG kaydından gelmemiş (manuel veya Excel import).
      </div>
    );
  }

  const hasLineDetail =
    data.line_no != null ||
    data.line_weight_grams ||
    data.line_pure_gold_grams ||
    data.line_total_dkk;

  return (
    <div className="border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Kaynak AFG</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-sm font-black text-amber-900" style={monoStyle}>
              {data.document_number || `Seq ${data.sequence_no ?? '—'}`}
            </span>
            {data.line_no != null ? (
              <span className="border border-amber-300 bg-white px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-700" style={monoStyle}>
                Satır #{data.line_no}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-amber-700" style={monoStyle}>
            {data.issued_at ? new Date(data.issued_at).toLocaleDateString(document.documentElement.lang) : '—'}
          </p>
        </div>
        {data.customer_name ? (
          <div className="text-right">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Müşteri</p>
            <p className="mt-0.5 text-xs font-bold text-brand-800">{data.customer_name}</p>
          </div>
        ) : null}
      </div>

      {hasLineDetail ? (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-amber-200 pt-2 sm:grid-cols-4">
          {data.line_weight_grams ? (
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-amber-700">Brüt</p>
              <p className="text-xs font-bold text-amber-900" style={monoStyle}>
                {Number(data.line_weight_grams).toFixed(2)} g
              </p>
            </div>
          ) : null}
          {data.line_pure_gold_grams ? (
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-amber-700">Saf</p>
              <p className="text-xs font-bold text-amber-900" style={monoStyle}>
                {Number(data.line_pure_gold_grams).toFixed(3)} g
              </p>
            </div>
          ) : null}
          {data.rate_dkk ? (
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-amber-700">Oran</p>
              <p className="text-xs font-bold text-amber-900" style={monoStyle}>
                {Number(data.rate_dkk).toFixed(0)} DKK/g
              </p>
            </div>
          ) : null}
          {data.line_total_dkk ? (
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-amber-700">Tutar</p>
              <p className="text-xs font-bold text-amber-900" style={monoStyle}>
                {Number(data.line_total_dkk).toFixed(0)} DKK
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function InventoryDetailDrawer({
  product,
  loading,
  history,
  historyLoading,
  sourceAfg,
  sourceAfgLoading,
  onClose,
  onEdit,
  onOpenWooProduct,
  onUpdateStatus,
  updatingStatus,
  onUploadPhotos,
  onDeletePhoto,
  uploadingPhotos,
  deletingPhoto,
  onPrintLabel,
  printingLabel,
}: {
  product: ProductOut | null;
  loading: boolean;
  history: ProductHistoryEntry[];
  historyLoading: boolean;
  sourceAfg: ProductSourceAfg | null;
  sourceAfgLoading: boolean;
  onClose: () => void;
  onEdit: () => void;
  onOpenWooProduct: () => void;
  onUpdateStatus: (status: InventoryLifecycleStatus, meltReason?: string | null, salePriceDkk?: number | null) => void;
  updatingStatus: boolean;
  onUploadPhotos: (files: FileList | File[]) => void;
  onDeletePhoto: (photoId: string) => void;
  uploadingPhotos: boolean;
  deletingPhoto: boolean;
  onPrintLabel: () => void;
  printingLabel: boolean;
}) {
  const [meltDialogOpen, setMeltDialogOpen] = useState(false);
  const [salePriceInput, setSalePriceInput] = useState('');
  const [saleMode, setSaleMode] = useState(false);

  const statusLabel = product ? PRODUCT_STATUS_LABEL[product.status] || product.status : '—';
  const statusTone = product ? PRODUCT_STATUS_TONE[product.status] || 'border-brand-300 bg-brand-100 text-brand-700' : 'border-brand-300 bg-brand-100 text-brand-700';
  const allowedNext: InventoryLifecycleStatus[] = product ? ALLOWED_TRANSITIONS[product.status] || [] : [];
  const canSell = product?.status === 'for_sale';
  const isLocked = product?.is_gdpr_locked;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-brand-950/20">
      <button type="button" className="flex-1 cursor-default" aria-label="Detay drawer overlay" onClick={onClose} />
      <aside className="relative h-full w-full max-w-[32rem] overflow-y-auto border-l-2 border-brand-300 bg-stone-100 shadow-2xl" style={sansStyle}>
        <div className="sticky top-0 z-10 border-b border-brand-300 bg-white px-5 py-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${statusTone}`}>{statusLabel}</span>
                {isLocked ? (
                  <span className="inline-flex items-center gap-1 border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
                    <Lock className="h-2.5 w-2.5" /> GDPR
                  </span>
                ) : null}
                {product?.operation_destination ? (
                  <span className="inline-flex border border-brand-200 bg-brand-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-brand-600">
                    {product.operation_destination}
                  </span>
                ) : null}
              </div>
              <h3 className="mt-2 text-lg font-black uppercase tracking-[0.08em] text-brand-950">{product?.display_name || product?.product_number || 'Ürün Detayı'}</h3>
              <p className="mt-1 text-xs text-brand-500" style={monoStyle}>
                {product?.product_number || '—'} {product?.reference_number ? `· Ref ${product.reference_number}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center border border-brand-300 bg-white text-brand-700 transition hover:bg-brand-50"
              aria-label="Detayı kapat"
              title="Detayı kapat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-2 border border-brand-900 bg-brand-900 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-white transition hover:bg-black"
            >
              <Edit2 className="h-3.5 w-3.5" />
              Düzenle
            </button>
            <button
              type="button"
              onClick={onPrintLabel}
              disabled={printingLabel}
              className="inline-flex items-center gap-2 border border-blue-300 bg-blue-50 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-blue-800 transition hover:bg-blue-100 disabled:cursor-wait disabled:opacity-50"
            >
              {printingLabel ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
              Etiket
            </button>
            <button
              type="button"
              onClick={onOpenWooProduct}
              className="inline-flex items-center gap-2 border border-sky-300 bg-sky-50 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-sky-800 transition hover:bg-sky-100"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              WooCommerce
            </button>
          </div>

          {allowedNext.length > 0 ? (
            <div className="mt-3 border border-brand-200 bg-brand-50 p-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Sonraki durum</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {allowedNext.includes('in_inventory') ? (
                  <button
                    type="button"
                    disabled={updatingStatus || isLocked}
                    onClick={() => onUpdateStatus('in_inventory')}
                    className="inline-flex items-center gap-1 border border-emerald-300 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                    title={isLocked ? '14 gün GDPR kilidi dolmadan değiştirilemez' : 'Depoda tut'}
                  >
                    <PackageCheck className="h-3 w-3" /> Depoda
                  </button>
                ) : null}
                {allowedNext.includes('for_sale') ? (
                  <button
                    type="button"
                    disabled={updatingStatus || isLocked}
                    onClick={() => onUpdateStatus('for_sale')}
                    className="inline-flex items-center gap-1 border border-sky-300 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                    title={isLocked ? '14 gün GDPR kilidi dolmadan değiştirilemez' : 'Satışa hazırla'}
                  >
                    <ShoppingBag className="h-3 w-3" /> Satışa Hazırla
                  </button>
                ) : null}
                {allowedNext.includes('undecided') ? (
                  <button
                    type="button"
                    disabled={updatingStatus}
                    onClick={() => onUpdateStatus('undecided')}
                    className="inline-flex items-center gap-1 border border-amber-300 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Karar Bekliyor
                  </button>
                ) : null}
                {allowedNext.includes('melted') ? (
                  <button
                    type="button"
                    disabled={updatingStatus || isLocked}
                    onClick={() => setMeltDialogOpen(true)}
                    className="inline-flex items-center gap-1 border border-rose-300 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                    title={isLocked ? '14 gün GDPR kilidi dolmadan eritilemez' : 'Eritmeye Taşı'}
                  >
                    <Flame className="h-3 w-3" /> Erit
                  </button>
                ) : null}
                {canSell ? (
                  <div className="flex w-full items-center gap-1">
                    {saleMode ? (
                      <>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={salePriceInput}
                          onChange={(event) => setSalePriceInput(event.target.value)}
                          className="mono w-24 border border-emerald-300 bg-white px-1.5 py-1 text-xs"
                          placeholder="DKK"
                          autoFocus
                        />
                        <button
                          type="button"
                          disabled={updatingStatus || !Number(salePriceInput)}
                          onClick={() => {
                            const price = Number(salePriceInput);
                            if (!Number.isFinite(price) || price <= 0) return;
                            onUpdateStatus('sold' as InventoryLifecycleStatus, null, price);
                            setSaleMode(false);
                            setSalePriceInput('');
                          }}
                          className="border border-emerald-500 bg-emerald-600 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Sat
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSaleMode(false);
                            setSalePriceInput('');
                          }}
                          className="border border-brand-300 bg-white px-2 py-1 text-[10px] font-bold text-brand-600 hover:bg-brand-50"
                        >
                          İptal
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSaleMode(true)}
                        className="inline-flex items-center gap-1 border border-emerald-500 bg-emerald-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white hover:bg-emerald-700"
                      >
                        Satıldı olarak işaretle
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="px-5 py-10 text-sm text-brand-500">Ürün detayı yükleniyor...</div>
        ) : !product ? (
          <div className="px-5 py-10 text-sm text-brand-500">Ürün detayı bulunamadı.</div>
        ) : (
          <div className="space-y-5 px-5 py-5">
            <ProductSourceAfgPanel data={sourceAfg} loading={sourceAfgLoading} />

            <section className="grid grid-cols-2 gap-3">
              <DetailField label="Kategori" value={product.inventory_category || '—'} />
              <DetailField label="Alt kategori" value={product.inventory_subcategory || '—'} />
              <DetailField label="Ürün tipi" value={product.product_type} />
              <DetailField label="Metal" value={product.metal_type} />
              <DetailField label="Toplam gram" value={`${product.total_weight_grams || product.weight_grams || '0'} g`} mono />
              <DetailField label="Saf metal" value={`${product.pure_gold_grams || '—'} g`} mono />
              <DetailField label="Alış" value={`${product.purchase_price_dkk} DKK`} mono />
              <DetailField label="Shop" value={product.shop_price_dkk ? `${product.shop_price_dkk} DKK` : '—'} mono />
            </section>

            <ProductPhotoSection
              product={product}
              onUpload={onUploadPhotos}
              onDelete={onDeletePhoto}
              uploading={uploadingPhotos}
              deleting={deletingPhoto}
            />

            <section className="grid grid-cols-2 gap-3">
              <DetailField label="Woo ID" value={product.woocommerce_product_id ? String(product.woocommerce_product_id) : '—'} mono />
              <DetailField label="Woo durumu" value={product.is_published_to_site ? 'Yayında' : product.shop_sync_status || 'Hazırlanmadı'} />
              <DetailField label="Lokasyon" value={product.storage_location || '—'} />
              <DetailField label="Üretici" value={product.producer || '—'} />
              <DetailField label="Uzunluk" value={product.length_cm || '—'} mono />
              <DetailField label="Genişlik / Kalınlık" value={[product.width_mm ? `${product.width_mm} mm` : null, product.thickness_mm ? `${product.thickness_mm} mm` : null].filter(Boolean).join(' · ') || '—'} mono />
              <DetailField label="Temizlik" value={product.needs_cleaning ? 'Gerekli' : 'Temiz'} />
              <DetailField label="Operasyon sınıfı" value={product.operation_classification || '—'} />
            </section>

            <section className="border border-brand-200 bg-white px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Notlar</p>
              <p className="mt-2 text-sm leading-6 text-brand-800">{product.notes || 'Not yok.'}</p>
            </section>

            <section>
              <div className="flex items-center gap-2">
                <History className="h-3.5 w-3.5 text-brand-500" />
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Geçmiş</p>
              </div>
              <div className="mt-2">
                <ProductHistoryPanel entries={history} loading={historyLoading} />
              </div>
            </section>
          </div>
        )}

        <MeltConfirmDialog
          open={meltDialogOpen}
          pending={updatingStatus}
          onCancel={() => setMeltDialogOpen(false)}
          onConfirm={(reason) => {
            onUpdateStatus('melted', reason);
            setMeltDialogOpen(false);
          }}
        />
      </aside>
    </div>
  );
}

export interface DepolamaPageProps {
  loading: boolean;
  activeView: InventorySurfaceView;
  setActiveView: Dispatch<SetStateAction<InventorySurfaceView>>;
  stokList: StokItem[];
  prices: MarketPrices;
  setPrices: Dispatch<SetStateAction<MarketPrices>>;
  priceOpen: boolean;
  setPriceOpen: (value: boolean) => void;
  activeKat: MainCategory;
  setActiveKat: (value: MainCategory) => void;
  categoryScope?: MainCategory | 'all';
  setCategoryScope?: (value: MainCategory | 'all') => void;
  gumusAlt: SilverSub;
  setGumusAlt: (value: SilverSub) => void;
  platinAlt: PlatinumSub;
  setPlatinAlt: (value: PlatinumSub) => void;
  editing: StokItem | null;
  setEditing: Dispatch<SetStateAction<StokItem | null>>;
  selectedProductId: string | null;
  selectedProduct: ProductOut | null;
  loadingSelectedProduct: boolean;
  productHistory: ProductHistoryEntry[];
  productHistoryLoading: boolean;
  productSourceAfg: ProductSourceAfg | null;
  productSourceAfgLoading: boolean;
  opdateret: string;
  startNew: () => void;
  saveItem: () => void;
  deleteItem: (productId: string) => void;
  onOpenWorkbookPreview: () => void;
  onOpenDetail: (productId: string) => void;
  onCloseDetail: () => void;
  onOpenWooProduct: (productId: string) => void;
  onUpdateProductStatus: (
    productId: string,
    status: InventoryLifecycleStatus,
    meltReason?: string | null,
    salePriceDkk?: number | null,
  ) => void;
  savingItem: boolean;
  deletingItem: boolean;
  savingPrices: boolean;
  updatingStatus: boolean;
  savePrices: () => void;
  filters: InventoryFilterState;
  setFilters: Dispatch<SetStateAction<InventoryFilterState>>;
  resetFilters: () => void;
  sort: InventorySortState;
  setSort: Dispatch<SetStateAction<InventorySortState>>;
  onPrintLabel: (productId: string, label: string) => void;
  printingLabelForId: string | null;
  onUploadPhotos: (productId: string, files: FileList | File[]) => void;
  uploadingPhotos: boolean;
  onDeletePhoto: (productId: string, photoId: string) => void;
  deletingPhoto: boolean;
}

export function DepolamaPage({
  loading,
  activeView,
  setActiveView,
  stokList,
  prices,
  setPrices,
  priceOpen,
  setPriceOpen,
  activeKat,
  setActiveKat,
  categoryScope,
  setCategoryScope,
  gumusAlt,
  setGumusAlt,
  platinAlt,
  setPlatinAlt,
  editing,
  setEditing,
  selectedProductId,
  selectedProduct,
  loadingSelectedProduct,
  productHistory,
  productHistoryLoading,
  productSourceAfg,
  productSourceAfgLoading,
  opdateret,
  startNew,
  saveItem,
  deleteItem,
  onOpenWorkbookPreview,
  onOpenDetail,
  onCloseDetail,
  onOpenWooProduct,
  onUpdateProductStatus,
  savingItem,
  savePrices,
  savingPrices,
  updatingStatus,
  filters,
  setFilters,
  resetFilters,
  sort,
  setSort,
  onPrintLabel,
  printingLabelForId,
  onUploadPhotos,
  uploadingPhotos,
  onDeletePhoto,
  deletingPhoto,
}: DepolamaPageProps) {
  const confirm = useConfirm();
  const totals = useMemo(
    () => ({
      finguld: stokList
        .filter((item) => item.mainKat !== 'gumus' && item.mainKat !== 'platin_pd')
        .reduce((sum, item) => sum + hasMetalGram(item), 0),
      finsolv: stokList.filter((item) => item.mainKat === 'gumus').reduce((sum, item) => sum + hasMetalGram(item), 0),
      goldVal: stokList
        .filter((item) => item.mainKat !== 'gumus' && item.mainKat !== 'platin_pd')
        .reduce((sum, item) => sum + spotDeger(item), 0),
      silverVal: stokList.filter((item) => item.mainKat === 'gumus').reduce((sum, item) => sum + spotDeger(item), 0),
      platinVal: stokList.filter((item) => item.mainKat === 'platin_pd').reduce((sum, item) => sum + spotDeger(item), 0),
      alisToplam: stokList.reduce((sum, item) => sum + item.alisFiyati, 0),
      total: stokList.reduce((sum, item) => sum + spotDeger(item), 0),
      items: stokList.length,
    }),
    [stokList],
  );

  // Backend zaten kategoriye göre filtreliyor (workspace query param `category`).
  // Client tarafı sadece görselleştirme amaçlı sub-tab filtresi uygular (gumus/platin alt-kategori).
  const filteredItems = useMemo(
    () =>
      stokList.filter((item) => {
        if (categoryScope === 'all') return true;
        if (activeKat === 'gumus') return item.gumusAlt === gumusAlt;
        if (activeKat === 'platin_pd') return item.platinAlt === platinAlt;
        return true;
      }),
    [activeKat, categoryScope, gumusAlt, platinAlt, stokList],
  );

  const catTotal = useMemo<CategoryTotals>(
    () => ({
      toplamGramSum: filteredItems.reduce((sum, item) => sum + toplamGram(item), 0),
      hasMetalSum: filteredItems.reduce((sum, item) => sum + hasMetalGram(item), 0),
      alisSum: filteredItems.reduce((sum, item) => sum + item.alisFiyati, 0),
      spotSum: filteredItems.reduce((sum, item) => sum + spotDeger(item), 0),
      shopSum: filteredItems.reduce((sum, item) => sum + (item.shopFiyati || 0), 0),
    }),
    [filteredItems],
  );

  function upd<K extends keyof StokItem>(field: K, value: StokItem[K]) {
    setEditing((current) => (current ? { ...current, [field]: value } : current));
  }

  async function confirmDelete(id: string) {
    const ok = await confirm({
      title: 'Stok kaydını sil',
      message: 'Bu stok kaydını silmek istiyor musunuz?',
      confirmText: 'Sil',
      variant: 'danger',
    });
    if (!ok) return;
    if (selectedProductId === id) {
      onCloseDetail();
    }
    deleteItem(id);
  }

  function handleSort(key: InventorySortKey) {
    setSort((current) => {
      if (current.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: key === 'lager_dato' || key === 'alis_fiyati' || key === 'spot_degeri' ? 'desc' : 'asc' };
    });
  }

  const countFor = (key: MainCategory | 'all') => (key === 'all' ? stokList.length : stokList.filter((item) => item.mainKat === key).length);
  const workbookStatus = formatWorkbookStamp(opdateret);
  const selectedDraft = selectedProductId ? stokList.find((item) => item.id === selectedProductId) ?? null : null;
  const isInitialLoading = loading && stokList.length === 0;

  const systemContent = (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 border-b-2 border-brand-300 flex-shrink-0">
        <SummaryCell label="Finguld i alt" value={`${totals.finguld.toFixed(2)} g`} sub={`${totals.goldVal.toFixed(0)} DKK`} color="amber" />
        <SummaryCell label="Finsølv i alt" value={`${totals.finsolv.toFixed(2)} g`} sub={`${totals.silverVal.toFixed(0)} DKK`} color="slate" />
        <SummaryCell label="Pt & Pd Spot" value={`${totals.platinVal.toFixed(0)} DKK`} color="zinc" />
        <SummaryCell label="Toplam Alış" value={`${totals.alisToplam.toFixed(0)} DKK`} color="brand" />
        <SummaryCell label="Spot Metal Değeri" value={`${totals.total.toFixed(0)} DKK`} sub={`${totals.items} ürün`} color="emerald" highlight />
      </div>

      {!editing ? (
        <InventoryFilters
          filters={filters}
          setFilters={setFilters}
          onReset={resetFilters}
          totalCount={stokList.length}
          filteredCount={filteredItems.length}
        />
      ) : null}

      {!editing ? (
        <div className="flex border-b-2 border-brand-300 flex-shrink-0 bg-brand-50 overflow-x-auto">
          {(
            [
              { key: 'all', label: 'Tümü', sub: 'Alle varer', badge: '∑', color: 'slate' },
              { key: 'kulce', label: 'Guldbarrer', sub: 'Külçeler', badge: 'Au', color: 'amber' },
              { key: 'sikke', label: 'Guldmønter', sub: 'Sikkeler', badge: 'Au', color: 'amber' },
              { key: 'taki', label: 'Guldsmykker', sub: 'Takılar', badge: 'Au', color: 'amber' },
              { key: 'gumus', label: 'Sølv varer', sub: 'Gümüş', badge: 'Ag', color: 'slate' },
              { key: 'platin_pd', label: 'Platin & Pd', sub: 'Diğer Metaller', badge: 'Pt', color: 'zinc' },
            ] as const
          ).map(({ key, label, sub, badge, color }) => {
            const scope = categoryScope ?? activeKat;
            const isActive = key === 'all' ? scope === 'all' : scope === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  if (key === 'all') setCategoryScope?.('all');
                  else setActiveKat(key);
                  setEditing(null);
                  onCloseDetail();
                }}
                className={`flex-1 px-4 py-3 text-left border-r border-brand-200 last:border-r-0 transition-colors relative ${
                  isActive ? 'bg-white border-b-2 border-b-brand-900 -mb-0.5' : 'hover:bg-brand-100'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-xs font-black px-1.5 py-0.5 ${
                      color === 'amber'
                        ? 'bg-amber-100 text-amber-700'
                        : color === 'slate'
                          ? 'bg-slate-100 text-slate-600'
                          : 'bg-zinc-100 text-zinc-600'
                    }`}
                    style={monoStyle}
                  >
                    {badge}
                  </span>
                  <span className="text-xs font-black text-brand-900 uppercase tracking-wide">{label}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-brand-500">{sub}</span>
                  <span className="text-xs font-semibold text-brand-400" style={monoStyle}>
                    {countFor(key)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}

      {!editing && categoryScope !== 'all' && activeKat === 'gumus' ? (
        <div className="flex border-b border-brand-200 bg-slate-50 flex-shrink-0">
          {(
            [
              { key: 'smykker', label: 'Smykker / Takılar' },
              { key: 'barrer', label: 'Sølvbarrer / Külçe' },
              { key: 'monter', label: 'Sølvmønter / Sikke' },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setGumusAlt(key)}
              className={`px-5 py-2 text-xs font-bold uppercase tracking-wider border-r border-brand-200 transition-colors ${
                gumusAlt === key ? 'bg-white text-slate-700 border-b-2 border-b-slate-500 -mb-px' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {label}
              <span className="ml-2 text-slate-400" style={monoStyle}>
                {stokList.filter((item) => item.mainKat === 'gumus' && item.gumusAlt === key).length}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {!editing && categoryScope !== 'all' && activeKat === 'platin_pd' ? (
        <div className="flex border-b border-brand-200 bg-zinc-50 flex-shrink-0">
          {(
            [
              { key: 'platin', label: 'Platin' },
              { key: 'palladyum', label: 'Palladyum' },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setPlatinAlt(key)}
              className={`px-5 py-2 text-xs font-bold uppercase tracking-wider border-r border-brand-200 transition-colors ${
                platinAlt === key ? 'bg-white text-zinc-700 border-b-2 border-b-zinc-500 -mb-px' : 'text-zinc-500 hover:bg-zinc-100'
              }`}
            >
              {label}
              <span className="ml-2 text-zinc-400" style={monoStyle}>
                {stokList.filter((item) => item.mainKat === 'platin_pd' && item.platinAlt === key).length}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {editing ? (
        <div className="flex-1 overflow-auto">
          <div className="bg-brand-900 px-6 py-3 flex items-center justify-between border-b-4 border-amber-600">
            <div>
              <span className="text-xs text-brand-500 uppercase tracking-widest block">
                {stokList.find((item) => item.id === editing.id) ? 'Ürün Düzenle' : 'Yeni Ürün Ekle'}
              </span>
              <span className="text-lg font-black text-white">{editing.urun || '—'}</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-4 py-2 text-brand-300 text-sm font-semibold border border-brand-700 hover:border-brand-400 hover:text-white transition-colors flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" /> İptal
              </button>
              <button
                type="button"
                onClick={() => {
                  if (savingItem) return;
                  saveItem();
                }}
                disabled={savingItem}
                className="flex items-center px-5 py-2 bg-green-700 text-white text-sm font-bold border border-green-600 hover:bg-green-800 transition-colors disabled:opacity-60"
              >
                {savingItem ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Kaydet
              </button>
            </div>
          </div>
          <StokForm editing={editing} upd={upd} />
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {isInitialLoading ? (
            <div className="px-6 py-12 text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-brand-400" />
              <p className="mt-3 text-sm text-brand-500">Stok yükleniyor...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Plus className="mx-auto h-8 w-8 text-brand-300" />
              <p className="mt-3 text-sm font-bold text-brand-500">
                {stokList.length > 0 ? 'Filtre eşleşmesi yok' : 'Bu kategoride henüz ürün yok'}
              </p>
              <p className="mt-1 text-xs text-brand-400">
                {stokList.length > 0
                  ? 'Filtreyi temizleyin veya farklı kriterler deneyin.'
                  : 'Yukarıdan "Yeni Ürün" ekleyebilirsiniz.'}
              </p>
              {stokList.length > 0 ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-4 inline-flex items-center gap-2 border border-brand-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-brand-700 hover:bg-brand-50"
                >
                  <X className="h-3.5 w-3.5" /> Filtreleri Sıfırla
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startNew}
                  className="mt-4 inline-flex items-center gap-2 border border-brand-900 bg-brand-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-black"
                >
                  <Plus className="h-3.5 w-3.5" /> Yeni Ürün Ekle
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <InventoryDataTable
                items={filteredItems}
                catTotal={catTotal}
                kat={activeKat}
                platinAlt={platinAlt}
                marketPrices={prices}
                sort={sort}
                onSort={handleSort}
                onView={(item) => onOpenDetail(item.id)}
                onEdit={(item) => setEditing(item)}
                onDelete={confirmDelete}
                onPrintLabel={(item) => onPrintLabel(item.id, item.productNumber || item.stokNo || item.id)}
                printingLabelForId={printingLabelForId}
              />
            </div>
          )}

          <div className="border-t-4 border-brand-400 bg-brand-900 px-4 py-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:px-6">
            <div className="flex items-center gap-4 flex-wrap sm:gap-6">
              <div>
                <span className="text-xs text-brand-500 uppercase tracking-widest block">Finguld i alt</span>
                <span className="text-lg font-black text-amber-300" style={monoStyle}>
                  {totals.finguld.toFixed(2)} g
                </span>
              </div>
              <div className="w-px h-10 bg-brand-700" />
              <div>
                <span className="text-xs text-brand-500 uppercase tracking-widest block">Finsølv i alt</span>
                <span className="text-lg font-black text-slate-300" style={monoStyle}>
                  {totals.finsolv.toFixed(2)} g
                </span>
              </div>
              <div className="w-px h-10 bg-brand-700" />
              <div>
                <span className="text-xs text-brand-500 uppercase tracking-widest block">Toplam Alış</span>
                <span className="text-lg font-black text-brand-200" style={monoStyle}>
                  {totals.alisToplam.toFixed(0)} DKK
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs text-brand-500 uppercase tracking-widest block">I alt — Spot Metal Değeri</span>
              <span className="text-2xl font-black text-emerald-300" style={monoStyle}>
                {totals.total.toFixed(0)}
              </span>
              <span className="text-sm font-bold text-emerald-500 ml-1">DKK</span>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div style={sansStyle} className="relative min-h-full bg-white flex flex-col">
      <div className="border-b-2 border-brand-300 bg-brand-50 px-4 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 flex-shrink-0">
        <div>
          <h2 className="text-lg font-black text-brand-900 uppercase tracking-wider">Lager — Depo Envanteri</h2>
          <p className="text-xs text-brand-500 mt-0.5">
            Metal bazlı stok değerleme · {opdateret ? <><span className="font-semibold">Opdateret:</span> {opdateret}</> : 'Henüz kaydedilmedi'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (activeView !== 'excel') {
                onOpenWorkbookPreview();
              }
            }}
            className={`flex items-center gap-3 border px-4 py-2.5 text-left transition ${
              activeView === 'excel' ? 'border-brand-900 bg-brand-900 text-white' : 'border-emerald-300 bg-white text-brand-900 hover:bg-emerald-50'
            }`}
          >
            <span
              className={`px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${
                activeView === 'excel' ? 'bg-brand-700 text-brand-100' : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              XLSX
            </span>
            <span className="flex flex-col">
              <span
                className={`text-[10px] font-black uppercase tracking-widest ${
                  activeView === 'excel' ? 'text-brand-200' : 'text-emerald-700'
                }`}
              >
                Canlı Workbook
              </span>
              <span className={`text-xs font-black uppercase tracking-wider ${activeView === 'excel' ? 'text-white' : 'text-brand-900'}`}>
                Depolama.xlsx
              </span>
            </span>
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setPriceOpen(!priceOpen)}
              className="flex items-center gap-2 border border-brand-300 bg-white px-3 py-2 text-xs font-semibold transition-colors hover:bg-brand-50"
            >
              <span className="inline-flex items-center gap-1 border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-800">
                Au
                <span style={monoStyle}>{prices.gold}</span>
              </span>
              <span className="inline-flex items-center gap-1 border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-700">
                Ag
                <span style={monoStyle}>{prices.silver}</span>
              </span>
              <span className="inline-flex items-center gap-1 border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-zinc-700">
                Pt
                <span style={monoStyle}>{prices.platin}</span>
              </span>
              {priceOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {priceOpen ? (
              <div className="absolute right-0 top-full mt-1 z-50 bg-white border-2 border-brand-300 shadow-lg p-4 w-72">
                <p className="text-xs font-black text-brand-700 uppercase tracking-wider mb-3">Günlük Piyasa Fiyatları (DKK/g)</p>
                <div className="space-y-2">
                  {(
                    [
                      { key: 'gold', label: 'Altın 24K' },
                      { key: 'silver', label: 'Gümüş' },
                      { key: 'platin', label: 'Platin' },
                      { key: 'palladyum', label: 'Palladyum' },
                    ] as const
                  ).map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2">
                      <span className="text-xs font-black text-brand-600 w-24 uppercase tracking-wider">{label}</span>
                      <CommittedNumericInput
                        value={prices[key]}
                        rules={{ kind: 'decimal', required: true, allowNegative: false, min: 0, precision: 2 }}
                        onCommit={(value) => { if (value !== null) setPrices((current) => ({ ...current, [key]: value })); }}
                        className={`${cellIn} w-28`}
                        style={monoStyle}
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      if (savingPrices) return;
                      savePrices();
                    }}
                    disabled={savingPrices}
                    className="w-full py-1.5 bg-brand-800 text-white text-xs font-bold hover:bg-brand-900 mt-1 disabled:opacity-60"
                  >
                    {savingPrices ? 'Kaydediliyor...' : 'Kaydet'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          {activeView === 'system' && !editing ? (
            <button
              type="button"
              onClick={startNew}
              className="flex items-center px-5 py-2 bg-brand-800 text-white text-sm font-bold hover:bg-brand-900 transition-colors border border-brand-900"
            >
              <Plus className="w-4 h-4 mr-2" />
              Yeni Ürün
            </button>
          ) : null}
        </div>
      </div>
      <InventorySurfaceTabs activeView={activeView} setActiveView={setActiveView} workbookStatus={workbookStatus} />
      {activeView === 'excel' ? <InventoryExcelSurface /> : systemContent}
      {activeView === 'system' && (selectedProductId || loadingSelectedProduct) ? (
        <InventoryDetailDrawer
          product={selectedProduct}
          loading={loadingSelectedProduct}
          history={productHistory}
          historyLoading={productHistoryLoading}
          sourceAfg={productSourceAfg}
          sourceAfgLoading={productSourceAfgLoading}
          onClose={onCloseDetail}
          onEdit={() => {
            if (selectedDraft) {
              setEditing(selectedDraft);
              onCloseDetail();
            }
          }}
          onOpenWooProduct={() => {
            if (selectedProductId) {
              onOpenWooProduct(selectedProductId);
            }
          }}
          onUpdateStatus={(status, meltReason, salePriceDkk) => {
            if (selectedProductId) {
              onUpdateProductStatus(selectedProductId, status, meltReason, salePriceDkk);
            }
          }}
          updatingStatus={updatingStatus}
          onUploadPhotos={(files) => {
            if (selectedProductId) {
              onUploadPhotos(selectedProductId, files);
            }
          }}
          uploadingPhotos={uploadingPhotos}
          onDeletePhoto={(photoId) => {
            if (selectedProductId) {
              onDeletePhoto(selectedProductId, photoId);
            }
          }}
          deletingPhoto={deletingPhoto}
          onPrintLabel={() => {
            if (selectedProductId) {
              onPrintLabel(selectedProductId, selectedProduct?.product_number || selectedProductId);
            }
          }}
          printingLabel={printingLabelForId === selectedProductId}
        />
      ) : null}
    </div>
  );
}
