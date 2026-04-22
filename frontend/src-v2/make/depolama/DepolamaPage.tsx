import { type Dispatch, type SetStateAction, useMemo } from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Edit2,
  Eye,
  Flame,
  PackageCheck,
  Plus,
  Save,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';

import type { ProductOut } from '@/types';

import { MakeOfficeDocumentPage } from '../office/OfficeDocumentPage';
import { useOfficeDocumentState } from '../office/useOfficeDocumentState';
import type {
  CategoryTotals,
  InventoryLifecycleStatus,
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
  { label: 'Sølv 800', saflik: 0.8 },
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

const TH =
  'border border-brand-300 px-3 py-2.5 text-xs font-black text-brand-600 uppercase tracking-wider bg-brand-100 whitespace-nowrap';
const TD = 'border border-brand-200 px-3 py-2.5 text-sm';
const TF = 'border border-brand-300 px-3 py-2.5 text-sm font-black bg-brand-100';

const DURUM_STYLE: Record<string, string> = {
  listelendi: 'bg-emerald-100 border-emerald-300 text-emerald-700',
  mangler_foto: 'bg-orange-100 border-orange-300 text-orange-700',
  hazir: 'bg-blue-100 border-blue-300 text-blue-700',
};

const DURUM_LABEL: Record<string, string> = {
  listelendi: 'Listelendi',
  mangler_foto: 'Mangler foto',
  hazir: 'Hazır',
};

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
  gumusAlt: SilverSub;
  setGumusAlt: (value: SilverSub) => void;
  platinAlt: PlatinumSub;
  setPlatinAlt: (value: PlatinumSub) => void;
  editing: StokItem | null;
  setEditing: Dispatch<SetStateAction<StokItem | null>>;
  selectedProductId: string | null;
  selectedProduct: ProductOut | null;
  loadingSelectedProduct: boolean;
  opdateret: string;
  startNew: () => void;
  saveItem: () => void;
  deleteItem: (productId: string) => void;
  onOpenWorkbookPreview: () => void;
  onOpenDetail: (productId: string) => void;
  onCloseDetail: () => void;
  onOpenWooProduct: (productId: string) => void;
  onUpdateProductStatus: (productId: string, status: InventoryLifecycleStatus, meltReason?: string | null) => void;
  savingItem: boolean;
  deletingItem: boolean;
  savePrices: () => void;
  savingPrices: boolean;
  updatingStatus: boolean;
}

function formatWorkbookStamp(value?: string | null) {
  return value?.trim() ? `Son güncelleme · ${value}` : 'Canlı workbook hazır';
}

interface TableProps {
  items: StokItem[];
  prices: MarketPrices;
  catTotal: CategoryTotals;
  onView: (item: StokItem) => void;
  onEdit: (item: StokItem) => void;
  onDelete: (id: string) => void;
}

function toplamGram(item: StokItem) {
  return item.birimGram * item.adet;
}

function hasMetalGram(item: StokItem) {
  return toplamGram(item) * item.saflik;
}

function getPrice(item: StokItem, prices: MarketPrices) {
  if (item.mainKat === 'gumus') return prices.silver;
  if (item.mainKat === 'platin_pd') return item.platinAlt === 'palladyum' ? prices.palladyum : prices.platin;
  return prices.gold;
}

function spotDeger(item: StokItem, prices: MarketPrices) {
  return hasMetalGram(item) * getPrice(item, prices);
}

function shopFark(item: StokItem, prices: MarketPrices) {
  return (item.shopFiyati || 0) - spotDeger(item, prices);
}

function getPurityOptions(kat: MainCategory) {
  if (kat === 'gumus') return SILVER_PURITIES;
  if (kat === 'platin_pd') return PLAT_PURITIES;
  return GOLD_PURITIES;
}

function saflikLabel(saflik: number, kat: MainCategory) {
  return getPurityOptions(kat).find((item) => Math.abs(item.saflik - saflik) < 0.0001)?.label ?? `${(saflik * 1000).toFixed(0)}‰`;
}

function shortDate(value: string) {
  return new Date(value).toLocaleDateString('da-DK');
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

function ActionCell({
  item,
  onView,
  onEdit,
  onDelete,
}: {
  item: StokItem;
  onView: (item: StokItem) => void;
  onEdit: (item: StokItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <td className={`${TD} text-center`}>
      <div className="flex items-center justify-center gap-1">
        <button
          type="button"
          onClick={() => onView(item)}
          className="border border-brand-300 bg-white px-2 py-1 text-brand-600 transition-colors hover:border-brand-500 hover:bg-brand-50 hover:text-brand-900"
          title="Detay"
          aria-label="Detay"
        >
          <Eye className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => onEdit(item)}
          className="flex items-center gap-1 bg-brand-700 px-2.5 py-1 text-xs font-bold text-white transition-colors hover:bg-brand-900"
        >
          <Edit2 className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          className="border border-red-200 px-2 py-1 text-red-400 transition-colors hover:border-red-400 hover:text-red-700"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </td>
  );
}

function KulceTable({ items, prices, catTotal, onView, onEdit, onDelete }: TableProps) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b-2 border-brand-400">
          <th className={`${TH} w-8`}>#</th>
          <th className={TH}>Lager Dato</th>
          <th className={`${TH} text-left`}>Marka / Ürün</th>
          <th className={TH}>Saflık</th>
          <th className={`${TH} border-amber-300 bg-amber-50 text-amber-800`}>g/adet</th>
          <th className={`${TH} border-amber-300 bg-amber-50 text-amber-800`}>Adet</th>
          <th className={`${TH} border-amber-300 bg-amber-100 text-amber-900`}>Toplam (g)</th>
          <th className={`${TH} border-amber-400 bg-amber-200 text-amber-900`}>Finguld (g)</th>
          <th className={`${TH} text-right`}>Alış (DKK)</th>
          <th className={`${TH} border-emerald-300 bg-emerald-50 text-right text-emerald-800`}>Spot (DKK)</th>
          <th className={`${TH} w-16`}>İşlem</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => {
          const toplam = toplamGram(item);
          const has = hasMetalGram(item);
          const spot = spotDeger(item, prices);
          return (
            <tr key={item.id} className={`border-b border-brand-100 transition-colors hover:bg-amber-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-brand-50'}`}>
              <td className={`${TD} text-center font-bold text-brand-400`} style={monoStyle}>
                {idx + 1}
              </td>
              <td className={TD} style={monoStyle}>
                {shortDate(item.lagerDato)}
              </td>
              <td className={`${TD} font-semibold text-brand-900`}>
                {item.urun}
                {item.uretici ? <span className="ml-2 text-xs font-normal text-brand-400">{item.uretici}</span> : null}
              </td>
              <td className={`${TD} text-center`}>
                <span className="border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-xs font-black text-amber-700" style={monoStyle}>
                  {saflikLabel(item.saflik, item.mainKat)}
                </span>
              </td>
              <td className={`${TD} border-amber-200 bg-amber-50 text-center`} style={monoStyle}>
                {item.birimGram.toFixed(2)}
              </td>
              <td className={`${TD} border-amber-200 bg-amber-50 text-center font-bold`} style={monoStyle}>
                {item.adet}
              </td>
              <td className={`${TD} border-amber-300 bg-amber-50 text-center font-bold text-amber-900`} style={monoStyle}>
                {toplam.toFixed(2)}
              </td>
              <td className={`${TD} border-amber-400 bg-amber-100 text-center font-black text-amber-900`} style={monoStyle}>
                {has.toFixed(3)}
              </td>
              <td className={`${TD} text-right`} style={monoStyle}>
                {item.alisFiyati.toFixed(0)}
              </td>
              <td className={`${TD} border-emerald-200 bg-emerald-50 text-right font-semibold text-emerald-800`} style={monoStyle}>
                {spot.toFixed(0)}
              </td>
              <ActionCell item={item} onView={onView} onEdit={onEdit} onDelete={onDelete} />
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-brand-400">
          <td colSpan={6} className={`${TF} text-brand-500`}>
            I alt — {items.length} kalem
          </td>
          <td className={`${TF} border-amber-300 text-center text-amber-900`} style={monoStyle}>
            {catTotal.toplamGramSum.toFixed(2)} g
          </td>
          <td className={`${TF} border-amber-400 text-center text-amber-900`} style={monoStyle}>
            {catTotal.hasMetalSum.toFixed(3)} g
          </td>
          <td className={`${TF} text-right`} style={monoStyle}>
            {catTotal.alisSum.toFixed(0)}
          </td>
          <td className={`${TF} border-emerald-300 bg-emerald-100 text-right text-emerald-900`} style={monoStyle}>
            {catTotal.spotSum.toFixed(0)}
          </td>
          <td className={TF} />
        </tr>
      </tfoot>
    </table>
  );
}

function SikkeTable({ items, prices, catTotal, onView, onEdit, onDelete }: TableProps) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b-2 border-brand-400">
          <th className={`${TH} w-8`}>#</th>
          <th className={TH}>Lager Dato</th>
          <th className={`${TH} text-left`}>Sikke / Ürün</th>
          <th className={TH}>Üretici</th>
          <th className={TH}>Karat</th>
          <th className={`${TH} border-amber-300 bg-amber-50 text-amber-800`}>g/adet</th>
          <th className={`${TH} border-amber-300 bg-amber-50 text-amber-800`}>Adet</th>
          <th className={`${TH} border-amber-400 bg-amber-100 text-amber-900`}>Toplam (g)</th>
          <th className={`${TH} border-amber-500 bg-amber-200 text-amber-900`}>Finguld (g)</th>
          <th className={`${TH} text-right`}>Alış (DKK)</th>
          <th className={`${TH} border-emerald-300 bg-emerald-50 text-right text-emerald-800`}>Spot (DKK)</th>
          <th className={`${TH} w-16`}>İşlem</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => {
          const toplam = toplamGram(item);
          const has = hasMetalGram(item);
          const spot = spotDeger(item, prices);
          return (
            <tr key={item.id} className={`border-b border-brand-100 transition-colors hover:bg-amber-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-brand-50'}`}>
              <td className={`${TD} text-center font-bold text-brand-400`} style={monoStyle}>
                {idx + 1}
              </td>
              <td className={TD} style={monoStyle}>
                {shortDate(item.lagerDato)}
              </td>
              <td className={`${TD} font-semibold text-brand-900`}>{item.urun}</td>
              <td className={`${TD} text-xs text-brand-600`}>{item.uretici || '—'}</td>
              <td className={`${TD} text-center`}>
                <span className="border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-xs font-black text-amber-700" style={monoStyle}>
                  {saflikLabel(item.saflik, item.mainKat)}
                </span>
              </td>
              <td className={`${TD} border-amber-200 bg-amber-50 text-center`} style={monoStyle}>
                {item.birimGram.toFixed(3)}
              </td>
              <td className={`${TD} border-amber-200 bg-amber-50 text-center font-bold`} style={monoStyle}>
                {item.adet}
              </td>
              <td className={`${TD} border-amber-300 bg-amber-50 text-center font-bold text-amber-900`} style={monoStyle}>
                {toplam.toFixed(3)}
              </td>
              <td className={`${TD} border-amber-400 bg-amber-100 text-center font-black text-amber-900`} style={monoStyle}>
                {has.toFixed(3)}
              </td>
              <td className={`${TD} text-right`} style={monoStyle}>
                {item.alisFiyati.toFixed(0)}
              </td>
              <td className={`${TD} border-emerald-200 bg-emerald-50 text-right font-semibold text-emerald-800`} style={monoStyle}>
                {spot.toFixed(0)}
              </td>
              <ActionCell item={item} onView={onView} onEdit={onEdit} onDelete={onDelete} />
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-brand-400">
          <td colSpan={7} className={`${TF} text-brand-500`}>
            I alt — {items.length} kalem
          </td>
          <td className={`${TF} border-amber-300 text-center text-amber-900`} style={monoStyle}>
            {catTotal.toplamGramSum.toFixed(3)} g
          </td>
          <td className={`${TF} border-amber-400 text-center text-amber-900`} style={monoStyle}>
            {catTotal.hasMetalSum.toFixed(3)} g
          </td>
          <td className={`${TF} text-right`} style={monoStyle}>
            {catTotal.alisSum.toFixed(0)}
          </td>
          <td className={`${TF} border-emerald-300 bg-emerald-100 text-right text-emerald-900`} style={monoStyle}>
            {catTotal.spotSum.toFixed(0)}
          </td>
          <td className={TF} />
        </tr>
      </tfoot>
    </table>
  );
}

function TakiTable({ items, prices, catTotal, onView, onEdit, onDelete }: TableProps) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b-2 border-brand-400">
          <th className={`${TH} w-16`}>Stok No</th>
          <th className={TH}>Lager Dato</th>
          <th className={`${TH} text-left`}>Ürün</th>
          <th className={TH}>Karat</th>
          <th className={`${TH} border-amber-300 bg-amber-50 text-amber-800`}>Brüt (g)</th>
          <th className={`${TH} border-amber-300 bg-amber-50 text-amber-800`}>Adet</th>
          <th className={`${TH} border-amber-400 bg-amber-100 text-amber-900`}>Toplam (g)</th>
          <th className={`${TH} border-amber-500 bg-amber-200 text-amber-900`}>Finguld (g)</th>
          <th className={`${TH} text-right`}>Alış (DKK)</th>
          <th className={`${TH} border-emerald-300 bg-emerald-50 text-right text-emerald-800`}>Spot (DKK)</th>
          <th className={`${TH} border-blue-300 bg-blue-50 text-right text-blue-800`}>Shop (DKK)</th>
          <th className={`${TH} border-purple-300 bg-purple-50 text-right text-purple-800`}>Fark</th>
          <th className={TH}>Üretici</th>
          <th className={TH}>Ölçü</th>
          <th className={TH}>Durum</th>
          <th className={`${TH} w-16`}>İşlem</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => {
          const toplam = toplamGram(item);
          const has = hasMetalGram(item);
          const spot = spotDeger(item, prices);
          const fark = item.shopFiyati != null ? shopFark(item, prices) : null;
          const olcu = [item.olcuUzunluk, item.olcuGenislik ? `${item.olcuGenislik}mm` : null, item.olcuKalinlik ? `${item.olcuKalinlik}mm` : null]
            .filter(Boolean)
            .join(' · ');
          return (
            <tr key={item.id} className={`border-b border-brand-100 transition-colors hover:bg-amber-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-brand-50'}`}>
              <td className={`${TD} text-center`}>
                <span className="text-xs font-black text-brand-600" style={monoStyle}>
                  {item.stokNo || '—'}
                </span>
              </td>
              <td className={TD} style={monoStyle}>
                {shortDate(item.lagerDato)}
              </td>
              <td className={`${TD} font-semibold text-brand-900`}>{item.urun}</td>
              <td className={`${TD} text-center`}>
                <span className="border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-xs font-black text-amber-700" style={monoStyle}>
                  {saflikLabel(item.saflik, item.mainKat)}
                </span>
              </td>
              <td className={`${TD} border-amber-200 bg-amber-50 text-center`} style={monoStyle}>
                {item.birimGram.toFixed(2)}
              </td>
              <td className={`${TD} border-amber-200 bg-amber-50 text-center font-bold`} style={monoStyle}>
                {item.adet}
              </td>
              <td className={`${TD} border-amber-300 bg-amber-50 text-center font-bold text-amber-900`} style={monoStyle}>
                {toplam.toFixed(2)}
              </td>
              <td className={`${TD} border-amber-400 bg-amber-100 text-center font-black text-amber-900`} style={monoStyle}>
                {has.toFixed(3)}
              </td>
              <td className={`${TD} text-right`} style={monoStyle}>
                {item.alisFiyati.toFixed(0)}
              </td>
              <td className={`${TD} border-emerald-200 bg-emerald-50 text-right font-semibold text-emerald-800`} style={monoStyle}>
                {spot.toFixed(0)}
              </td>
              <td className={`${TD} border-blue-200 bg-blue-50 text-right font-semibold text-blue-800`} style={monoStyle}>
                {item.shopFiyati != null ? item.shopFiyati.toFixed(0) : <span className="text-brand-300">—</span>}
              </td>
              <td className={`${TD} border-purple-200 bg-purple-50 text-right`} style={monoStyle}>
                {fark != null ? (
                  <span className={fark >= 0 ? 'font-semibold text-purple-700' : 'font-semibold text-red-600'}>
                    {fark >= 0 ? '+' : ''}
                    {fark.toFixed(0)}
                  </span>
                ) : (
                  <span className="text-brand-300">—</span>
                )}
              </td>
              <td className={`${TD} text-xs text-brand-600`}>{item.uretici || '—'}</td>
              <td className={`${TD} text-xs text-brand-500`} style={monoStyle}>
                {olcu || '—'}
              </td>
              <td className={`${TD} text-center`}>
                {item.shopDurumu ? (
                  <span className={`whitespace-nowrap border px-1.5 py-0.5 text-xs font-bold ${DURUM_STYLE[item.shopDurumu] || 'bg-brand-100 border-brand-300 text-brand-600'}`}>
                    {DURUM_LABEL[item.shopDurumu]}
                  </span>
                ) : (
                  <span className="text-xs text-brand-300">—</span>
                )}
              </td>
              <ActionCell item={item} onView={onView} onEdit={onEdit} onDelete={onDelete} />
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-brand-400">
          <td colSpan={6} className={`${TF} text-brand-500`}>
            I alt — {items.length} kalem
          </td>
          <td className={`${TF} border-amber-300 text-center text-amber-900`} style={monoStyle}>
            {catTotal.toplamGramSum.toFixed(2)} g
          </td>
          <td className={`${TF} border-amber-400 text-center text-amber-900`} style={monoStyle}>
            {catTotal.hasMetalSum.toFixed(3)} g
          </td>
          <td className={`${TF} text-right`} style={monoStyle}>
            {catTotal.alisSum.toFixed(0)}
          </td>
          <td className={`${TF} border-emerald-300 bg-emerald-100 text-right text-emerald-900`} style={monoStyle}>
            {catTotal.spotSum.toFixed(0)}
          </td>
          <td className={`${TF} border-blue-300 bg-blue-50 text-right text-blue-800`} style={monoStyle}>
            {catTotal.shopSum > 0 ? catTotal.shopSum.toFixed(0) : '—'}
          </td>
          <td colSpan={5} className={TF} />
        </tr>
      </tfoot>
    </table>
  );
}

function GumusTable({ items, prices, catTotal, onView, onEdit, onDelete }: TableProps) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b-2 border-slate-400">
          <th className={`${TH} w-8`}>#</th>
          <th className={TH}>Lager Dato</th>
          <th className={`${TH} text-left`}>Vare / Ürün</th>
          <th className={TH}>Üretici</th>
          <th className={`${TH} border-slate-300 bg-slate-50 text-slate-700`}>Saflık</th>
          <th className={`${TH} border-slate-300 bg-slate-50 text-slate-700`}>g/adet</th>
          <th className={`${TH} border-slate-300 bg-slate-50 text-slate-700`}>Adet</th>
          <th className={`${TH} border-slate-400 bg-slate-100 text-slate-800`}>Toplam (g)</th>
          <th className={`${TH} border-slate-500 bg-slate-200 text-slate-900`}>Finsølv (g)</th>
          <th className={`${TH} text-right`}>Alış (DKK)</th>
          <th className={`${TH} border-emerald-300 bg-emerald-50 text-right text-emerald-800`}>Spot (DKK)</th>
          <th className={`${TH} w-16`}>İşlem</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => {
          const toplam = toplamGram(item);
          const has = hasMetalGram(item);
          const spot = spotDeger(item, prices);
          return (
            <tr key={item.id} className={`border-b border-slate-100 transition-colors hover:bg-slate-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-brand-50'}`}>
              <td className={`${TD} text-center font-bold text-brand-400`} style={monoStyle}>
                {idx + 1}
              </td>
              <td className={TD} style={monoStyle}>
                {shortDate(item.lagerDato)}
              </td>
              <td className={`${TD} font-semibold text-brand-900`}>{item.urun}</td>
              <td className={`${TD} text-xs text-brand-600`}>{item.uretici || '—'}</td>
              <td className={`${TD} border-slate-200 bg-slate-50 text-center`}>
                <span className="border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-xs font-black text-slate-600" style={monoStyle}>
                  {saflikLabel(item.saflik, item.mainKat)}
                </span>
              </td>
              <td className={`${TD} border-slate-200 bg-slate-50 text-center`} style={monoStyle}>
                {item.birimGram.toFixed(2)}
              </td>
              <td className={`${TD} border-slate-200 bg-slate-50 text-center font-bold`} style={monoStyle}>
                {item.adet}
              </td>
              <td className={`${TD} border-slate-300 bg-slate-50 text-center font-bold text-slate-800`} style={monoStyle}>
                {toplam.toFixed(2)}
              </td>
              <td className={`${TD} border-slate-400 bg-slate-100 text-center font-black text-slate-900`} style={monoStyle}>
                {has.toFixed(3)}
              </td>
              <td className={`${TD} text-right`} style={monoStyle}>
                {item.alisFiyati.toFixed(0)}
              </td>
              <td className={`${TD} border-emerald-200 bg-emerald-50 text-right font-semibold text-emerald-800`} style={monoStyle}>
                {spot.toFixed(0)}
              </td>
              <ActionCell item={item} onView={onView} onEdit={onEdit} onDelete={onDelete} />
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-slate-400">
          <td colSpan={7} className={`${TF} text-brand-500`}>
            I alt — {items.length} kalem
          </td>
          <td className={`${TF} border-slate-300 text-center text-slate-800`} style={monoStyle}>
            {catTotal.toplamGramSum.toFixed(2)} g
          </td>
          <td className={`${TF} border-slate-400 text-center text-slate-900`} style={monoStyle}>
            {catTotal.hasMetalSum.toFixed(3)} g
          </td>
          <td className={`${TF} text-right`} style={monoStyle}>
            {catTotal.alisSum.toFixed(0)}
          </td>
          <td className={`${TF} border-emerald-300 bg-emerald-100 text-right text-emerald-900`} style={monoStyle}>
            {catTotal.spotSum.toFixed(0)}
          </td>
          <td className={TF} />
        </tr>
      </tfoot>
    </table>
  );
}

function PlatinTable({
  items,
  prices,
  catTotal,
  platinAlt,
  onView,
  onEdit,
  onDelete,
}: TableProps & { platinAlt: PlatinumSub }) {
  const metalLabel = platinAlt === 'platin' ? 'Pt' : 'Pd';
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b-2 border-zinc-400">
          <th className={`${TH} w-8`}>#</th>
          <th className={TH}>Lager Dato</th>
          <th className={`${TH} text-left`}>Ürün</th>
          <th className={TH}>Üretici</th>
          <th className={`${TH} border-zinc-300 bg-zinc-50 text-zinc-700`}>Saflık</th>
          <th className={`${TH} border-zinc-300 bg-zinc-50 text-zinc-700`}>g/adet</th>
          <th className={`${TH} border-zinc-300 bg-zinc-50 text-zinc-700`}>Adet</th>
          <th className={`${TH} border-zinc-400 bg-zinc-100 text-zinc-800`}>Toplam (g)</th>
          <th className={`${TH} border-zinc-500 bg-zinc-200 text-zinc-900`}>Has {metalLabel} (g)</th>
          <th className={`${TH} text-right`}>Alış (DKK)</th>
          <th className={`${TH} border-emerald-300 bg-emerald-50 text-right text-emerald-800`}>Spot (DKK)</th>
          <th className={`${TH} w-16`}>İşlem</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => {
          const toplam = toplamGram(item);
          const has = hasMetalGram(item);
          const spot = spotDeger(item, prices);
          return (
            <tr key={item.id} className={`border-b border-zinc-100 transition-colors hover:bg-zinc-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-brand-50'}`}>
              <td className={`${TD} text-center font-bold text-brand-400`} style={monoStyle}>
                {idx + 1}
              </td>
              <td className={TD} style={monoStyle}>
                {shortDate(item.lagerDato)}
              </td>
              <td className={`${TD} font-semibold text-brand-900`}>{item.urun}</td>
              <td className={`${TD} text-xs text-brand-600`}>{item.uretici || '—'}</td>
              <td className={`${TD} border-zinc-200 bg-zinc-50 text-center`}>
                <span className="border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 text-xs font-black text-zinc-600" style={monoStyle}>
                  {(item.saflik * 1000).toFixed(0)}‰
                </span>
              </td>
              <td className={`${TD} border-zinc-200 bg-zinc-50 text-center`} style={monoStyle}>
                {item.birimGram.toFixed(3)}
              </td>
              <td className={`${TD} border-zinc-200 bg-zinc-50 text-center font-bold`} style={monoStyle}>
                {item.adet}
              </td>
              <td className={`${TD} border-zinc-300 bg-zinc-50 text-center font-bold text-zinc-800`} style={monoStyle}>
                {toplam.toFixed(3)}
              </td>
              <td className={`${TD} border-zinc-400 bg-zinc-100 text-center font-black text-zinc-900`} style={monoStyle}>
                {has.toFixed(3)}
              </td>
              <td className={`${TD} text-right`} style={monoStyle}>
                {item.alisFiyati.toFixed(0)}
              </td>
              <td className={`${TD} border-emerald-200 bg-emerald-50 text-right font-semibold text-emerald-800`} style={monoStyle}>
                {spot.toFixed(0)}
              </td>
              <ActionCell item={item} onView={onView} onEdit={onEdit} onDelete={onDelete} />
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-zinc-400">
          <td colSpan={7} className={`${TF} text-brand-500`}>
            I alt — {items.length} kalem
          </td>
          <td className={`${TF} border-zinc-300 text-center text-zinc-800`} style={monoStyle}>
            {catTotal.toplamGramSum.toFixed(3)} g
          </td>
          <td className={`${TF} border-zinc-400 text-center text-zinc-900`} style={monoStyle}>
            {catTotal.hasMetalSum.toFixed(3)} g
          </td>
          <td className={`${TF} text-right`} style={monoStyle}>
            {catTotal.alisSum.toFixed(0)}
          </td>
          <td className={`${TF} border-emerald-300 bg-emerald-100 text-right text-emerald-900`} style={monoStyle}>
            {catTotal.spotSum.toFixed(0)}
          </td>
          <td className={TF} />
        </tr>
      </tfoot>
    </table>
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
  prices,
}: {
  editing: StokItem;
  upd: <K extends keyof StokItem>(field: K, value: StokItem[K]) => void;
  prices: MarketPrices;
}) {
  const kat = editing.mainKat;
  const isTaki = kat === 'taki';
  const isGumus = kat === 'gumus';
  const isPlatinPd = kat === 'platin_pd';

  const toplam = toplamGram(editing);
  const has = hasMetalGram(editing);
  const spot = spotDeger(editing, prices);
  const fark = editing.shopFiyati != null ? shopFark(editing, prices) : null;
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
          <input
            type="number"
            step="0.001"
            value={editing.birimGram || ''}
            onChange={(event) => upd('birimGram', Number(event.target.value) || 0)}
            className={cellIn}
            style={monoStyle}
            placeholder="0.000"
          />
        </div>

        <div>
          <label className={labelCls}>Adet / Antal</label>
          <input
            type="number"
            value={editing.adet}
            onChange={(event) => upd('adet', Number.parseInt(event.target.value, 10) || 1)}
            className={cellIn}
            style={monoStyle}
          />
        </div>

        <div>
          <label className={labelCls}>Alış Fiyatı (DKK)</label>
          <input
            type="number"
            step="0.01"
            value={editing.alisFiyati || ''}
            onChange={(event) => upd('alisFiyati', Number(event.target.value) || 0)}
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

        {isTaki ? (
          <>
            <div>
              <label className={labelCls}>Shop Fiyatı (DKK)</label>
              <input
                type="number"
                step="0.01"
                value={editing.shopFiyati || ''}
                onChange={(event) => upd('shopFiyati', Number(event.target.value) || undefined)}
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
              <input
                type="number"
                step="0.01"
                value={editing.olcuGenislik || ''}
                onChange={(event) => upd('olcuGenislik', Number(event.target.value) || undefined)}
                className={cellIn}
                style={monoStyle}
              />
            </div>
            <div>
              <label className={labelCls}>Kalınlık (mm)</label>
              <input
                type="number"
                step="0.01"
                value={editing.olcuKalinlik || ''}
                onChange={(event) => upd('olcuKalinlik', Number(event.target.value) || undefined)}
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
  purchased: 'Giris Bekliyor',
  in_inventory: 'Depoda',
  for_sale: 'Satis Hazir',
  undecided: 'Karar Bekliyor',
  sold: 'Satildi',
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
  const officeState = useOfficeDocumentState({
    kind: 'depolama',
    artifactKey: 'live',
    disableReopen: true,
  });

  return (
    <div className="flex-1 min-h-0 border-b-2 border-brand-300 bg-stone-100">
      <div className="h-[calc(100vh-16rem)] min-h-[760px]">
        <MakeOfficeDocumentPage {...officeState} layoutMode="workspace" />
      </div>
    </div>
  );
}

function InventoryDetailDrawer({
  product,
  loading,
  onClose,
  onEdit,
  onOpenWooProduct,
  onUpdateStatus,
  updatingStatus,
}: {
  product: ProductOut | null;
  loading: boolean;
  onClose: () => void;
  onEdit: () => void;
  onOpenWooProduct: () => void;
  onUpdateStatus: (status: InventoryLifecycleStatus, meltReason?: string | null) => void;
  updatingStatus: boolean;
}) {
  const statusLabel = product ? PRODUCT_STATUS_LABEL[product.status] || product.status : '—';
  const statusTone = product ? PRODUCT_STATUS_TONE[product.status] || 'border-brand-300 bg-brand-100 text-brand-700' : 'border-brand-300 bg-brand-100 text-brand-700';
  const canMarkForSale = product?.status === 'in_inventory' || product?.status === 'undecided';
  const canReturnToInventory = product?.status === 'for_sale' || product?.status === 'undecided';

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-brand-950/20">
      <button type="button" className="flex-1 cursor-default" aria-label="Detay drawer overlay" onClick={onClose} />
      <aside className="relative h-full w-full max-w-[30rem] overflow-y-auto border-l-2 border-brand-300 bg-stone-100 shadow-2xl" style={sansStyle}>
        <div className="sticky top-0 z-10 border-b border-brand-300 bg-white px-5 py-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${statusTone}`}>{statusLabel}</span>
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
              onClick={onOpenWooProduct}
              className="inline-flex items-center gap-2 border border-sky-300 bg-sky-50 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-sky-800 transition hover:bg-sky-100"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              WooCommerce'de Aç
            </button>
            {canMarkForSale ? (
              <button
                type="button"
                disabled={updatingStatus}
                onClick={() => onUpdateStatus('for_sale')}
                className="inline-flex items-center gap-2 border border-emerald-300 bg-emerald-50 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                Satışa Hazırla
              </button>
            ) : null}
            {canReturnToInventory ? (
              <button
                type="button"
                disabled={updatingStatus}
                onClick={() => onUpdateStatus('in_inventory')}
                className="inline-flex items-center gap-2 border border-brand-300 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <PackageCheck className="h-3.5 w-3.5" />
                Depoda Tut
              </button>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-sm text-brand-500">Ürün detayı yükleniyor...</div>
        ) : !product ? (
          <div className="px-5 py-10 text-sm text-brand-500">Ürün detayı bulunamadı.</div>
        ) : (
          <div className="space-y-5 px-5 py-5">
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

            <section>
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Fotoğraflar</p>
              {product.photos.length > 0 ? (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {product.photos.slice(0, 6).map((photo) => (
                    <div key={photo.id || photo.url} className="overflow-hidden border border-brand-200 bg-white">
                      <img src={photo.url} alt={photo.filename || product.display_name || 'Ürün fotoğrafı'} className="h-24 w-full object-cover" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 border border-dashed border-brand-300 bg-white px-4 py-5 text-sm text-brand-500">
                  Bu ürün için depolamada foto yok. Fotoğraf ve yayın akışı WooCommerce modülünde yönetiliyor.
                </div>
              )}
            </section>

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

            <section className="border border-rose-200 bg-rose-50 px-4 py-4">
              <div className="flex items-start gap-3">
                <Flame className="mt-0.5 h-4 w-4 text-rose-700" />
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Review Gate</p>
                  <p className="mt-1 text-sm text-rose-900">
                    Depolamaya giren ürün default olarak eritme yüzeyi sayılmaz. Eritmeye dönüş yalnız açık yönetim kararıyla yapılır.
                  </p>
                  <button
                    type="button"
                    disabled={updatingStatus}
                    onClick={() => {
                      const meltReason = window.prompt('Eritme nedeni zorunlu:', 'Hasarlı veya stok dışı karar');
                      if (!meltReason?.trim()) return;
                      onUpdateStatus('melted', meltReason.trim());
                    }}
                    className="mt-3 inline-flex items-center gap-2 border border-rose-300 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Flame className="h-3.5 w-3.5" />
                    Eritmeye Taşı
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

export function DepolamaPage({
  activeView,
  setActiveView,
  stokList,
  prices,
  setPrices,
  priceOpen,
  setPriceOpen,
  activeKat,
  setActiveKat,
  gumusAlt,
  setGumusAlt,
  platinAlt,
  setPlatinAlt,
  editing,
  setEditing,
  selectedProductId,
  selectedProduct,
  loadingSelectedProduct,
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
}: DepolamaPageProps) {
  const totals = useMemo(
    () => ({
      finguld: stokList.filter((item) => item.mainKat !== 'gumus' && item.mainKat !== 'platin_pd').reduce((sum, item) => sum + hasMetalGram(item), 0),
      finsolv: stokList.filter((item) => item.mainKat === 'gumus').reduce((sum, item) => sum + hasMetalGram(item), 0),
      goldVal: stokList.filter((item) => item.mainKat !== 'gumus' && item.mainKat !== 'platin_pd').reduce((sum, item) => sum + spotDeger(item, prices), 0),
      silverVal: stokList.filter((item) => item.mainKat === 'gumus').reduce((sum, item) => sum + spotDeger(item, prices), 0),
      platinVal: stokList.filter((item) => item.mainKat === 'platin_pd').reduce((sum, item) => sum + spotDeger(item, prices), 0),
      alisToplam: stokList.reduce((sum, item) => sum + item.alisFiyati, 0),
      total: stokList.reduce((sum, item) => sum + spotDeger(item, prices), 0),
      items: stokList.length,
    }),
    [prices, stokList],
  );

  const filteredItems = useMemo(
    () =>
      stokList.filter((item) => {
        if (item.mainKat !== activeKat) return false;
        if (activeKat === 'gumus') return item.gumusAlt === gumusAlt;
        if (activeKat === 'platin_pd') return item.platinAlt === platinAlt;
        return true;
      }),
    [activeKat, gumusAlt, platinAlt, stokList],
  );

  const catTotal = useMemo<CategoryTotals>(
    () => ({
      toplamGramSum: filteredItems.reduce((sum, item) => sum + toplamGram(item), 0),
      hasMetalSum: filteredItems.reduce((sum, item) => sum + hasMetalGram(item), 0),
      alisSum: filteredItems.reduce((sum, item) => sum + item.alisFiyati, 0),
      spotSum: filteredItems.reduce((sum, item) => sum + spotDeger(item, prices), 0),
      shopSum: filteredItems.reduce((sum, item) => sum + (item.shopFiyati || 0), 0),
    }),
    [filteredItems, prices],
  );

  function upd<K extends keyof StokItem>(field: K, value: StokItem[K]) {
    setEditing((current) => (current ? { ...current, [field]: value } : current));
  }

  function confirmDelete(id: string) {
    if (typeof window !== 'undefined' && !window.confirm('Bu stok kaydını silmek istiyor musunuz?')) {
      return;
    }
    if (selectedProductId === id) {
      onCloseDetail();
    }
    deleteItem(id);
  }

  const countFor = (key: MainCategory) => stokList.filter((item) => item.mainKat === key).length;
  const workbookStatus = formatWorkbookStamp(opdateret);
  const selectedDraft = selectedProductId ? stokList.find((item) => item.id === selectedProductId) ?? null : null;
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
        <div className="flex border-b-2 border-brand-300 flex-shrink-0 bg-brand-50 overflow-x-auto">
          {([
            { key: 'kulce', label: 'Guldbarrer', sub: 'Külçeler', badge: 'Au', color: 'amber' },
            { key: 'sikke', label: 'Guldmønter', sub: 'Sikkeler', badge: 'Au', color: 'amber' },
            { key: 'taki', label: 'Guldsmykker', sub: 'Takılar', badge: 'Au', color: 'amber' },
            { key: 'gumus', label: 'Sølv varer', sub: 'Gümüş', badge: 'Ag', color: 'slate' },
            { key: 'platin_pd', label: 'Platin & Pd', sub: 'Diğer Metaller', badge: 'Pt', color: 'zinc' },
          ] as const).map(({ key, label, sub, badge, color }) => {
            const isActive = activeKat === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setActiveKat(key);
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

      {!editing && activeKat === 'gumus' ? (
        <div className="flex border-b border-brand-200 bg-slate-50 flex-shrink-0">
          {([
            { key: 'smykker', label: 'Smykker / Takılar' },
            { key: 'barrer', label: 'Sølvbarrer / Külçe' },
            { key: 'monter', label: 'Sølvmønter / Sikke' },
          ] as const).map(({ key, label }) => (
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

      {!editing && activeKat === 'platin_pd' ? (
        <div className="flex border-b border-brand-200 bg-zinc-50 flex-shrink-0">
          {([
            { key: 'platin', label: 'Platin' },
            { key: 'palladyum', label: 'Palladyum' },
          ] as const).map(({ key, label }) => (
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
                className="flex items-center px-5 py-2 bg-green-700 text-white text-sm font-bold border border-green-600 hover:bg-green-800 transition-colors"
              >
                <Save className="w-4 h-4 mr-2" /> Kaydet
              </button>
            </div>
          </div>
          <StokForm editing={editing} upd={upd} prices={prices} />
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {filteredItems.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-brand-400 text-sm font-semibold">Bu kategoride henüz ürün yok</p>
              <p className="text-brand-300 text-xs mt-1">Yukarıdan "Yeni Ürün" ekleyebilirsiniz</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              {activeKat === 'kulce' ? <KulceTable items={filteredItems} prices={prices} catTotal={catTotal} onView={(item) => onOpenDetail(item.id)} onEdit={(item) => setEditing(item)} onDelete={confirmDelete} /> : null}
              {activeKat === 'sikke' ? <SikkeTable items={filteredItems} prices={prices} catTotal={catTotal} onView={(item) => onOpenDetail(item.id)} onEdit={(item) => setEditing(item)} onDelete={confirmDelete} /> : null}
              {activeKat === 'taki' ? <TakiTable items={filteredItems} prices={prices} catTotal={catTotal} onView={(item) => onOpenDetail(item.id)} onEdit={(item) => setEditing(item)} onDelete={confirmDelete} /> : null}
              {activeKat === 'gumus' ? <GumusTable items={filteredItems} prices={prices} catTotal={catTotal} onView={(item) => onOpenDetail(item.id)} onEdit={(item) => setEditing(item)} onDelete={confirmDelete} /> : null}
              {activeKat === 'platin_pd' ? (
                <PlatinTable items={filteredItems} prices={prices} catTotal={catTotal} platinAlt={platinAlt} onView={(item) => onOpenDetail(item.id)} onEdit={(item) => setEditing(item)} onDelete={confirmDelete} />
              ) : null}
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
            <span className={`px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${activeView === 'excel' ? 'bg-brand-700 text-brand-100' : 'bg-emerald-100 text-emerald-700'}`}>
              XLSX
            </span>
            <span className="flex flex-col">
              <span className={`text-[10px] font-black uppercase tracking-widest ${activeView === 'excel' ? 'text-brand-200' : 'text-emerald-700'}`}>Canlı Workbook</span>
              <span className={`text-xs font-black uppercase tracking-wider ${activeView === 'excel' ? 'text-white' : 'text-brand-900'}`}>Depolama.xlsx</span>
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
                  {([
                    { key: 'gold', label: 'Altın 24K' },
                    { key: 'silver', label: 'Gümüş' },
                    { key: 'platin', label: 'Platin' },
                    { key: 'palladyum', label: 'Palladyum' },
                  ] as const).map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2">
                      <span className="text-xs font-black text-brand-600 w-24 uppercase tracking-wider">{label}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={prices[key]}
                        onChange={(event) => setPrices((current) => ({ ...current, [key]: Number.parseFloat(event.target.value) || 0 }))}
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
                    className="w-full py-1.5 bg-brand-800 text-white text-xs font-bold hover:bg-brand-900 mt-1"
                  >
                    Kaydet
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
          onUpdateStatus={(status, meltReason) => {
            if (selectedProductId) {
              onUpdateProductStatus(selectedProductId, status, meltReason);
            }
          }}
          updatingStatus={updatingStatus}
        />
      ) : null}
    </div>
  );
}
