import { type ReactNode, useMemo } from 'react';
import { Edit2, Eye, Lock, Printer, Sparkles, Trash2 } from 'lucide-react';

import type {
  CategoryTotals,
  InventorySortKey,
  InventorySortState,
  MainCategory,
  MarketPrices,
  PlatinumSub,
  StokItem,
} from './types';

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;

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

function saflikLabel(saflik: number, kat: MainCategory) {
  const opts = kat === 'gumus' ? SILVER_PURITIES : GOLD_PURITIES;
  return opts.find((item) => Math.abs(item.saflik - saflik) < 0.0001)?.label ?? `${(saflik * 1000).toFixed(0)}‰`;
}

function shortDate(value: string) {
  return new Date(value).toLocaleDateString('da-DK');
}

interface ColumnDef {
  key: string;
  label: ReactNode;
  sortKey?: InventorySortKey;
  className?: string;
  align?: 'left' | 'right' | 'center';
  render: (item: StokItem) => ReactNode;
  footer?: (totals: CategoryTotals) => ReactNode;
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: ReactNode;
  sortKey?: InventorySortKey;
  sort?: InventorySortState;
  onSort?: (key: InventorySortKey) => void;
  className?: string;
}) {
  if (!sortKey || !onSort) {
    return <th className={className}>{label}</th>;
  }
  const active = sort?.key === sortKey;
  const arrow = active ? (sort?.direction === 'asc' ? '↑' : '↓') : '↕';
  return (
    <th
      className={`${className || ''} ${active ? 'bg-brand-200' : ''} cursor-pointer select-none hover:bg-brand-200`}
      onClick={() => onSort(sortKey)}
      title="Bu kolona göre sırala"
    >
      {label} <span className="text-brand-400">{arrow}</span>
    </th>
  );
}

function buildColumns(kat: MainCategory, platinAlt: PlatinumSub | undefined): ColumnDef[] {
  const baseColumns: ColumnDef[] = [
    {
      key: 'lager_dato',
      label: 'Lager Dato',
      sortKey: 'lager_dato',
      className: TH,
      render: (item) => (
        <span className="mono" style={monoStyle}>
          {shortDate(item.lagerDato)}
        </span>
      ),
    },
    {
      key: 'urun',
      label: kat === 'kulce' ? 'Marka / Ürün' : kat === 'sikke' ? 'Sikke / Ürün' : 'Ürün',
      sortKey: 'urun',
      className: `${TH} text-left`,
      align: 'left',
      render: (item) => (
        <div>
          <p className="font-semibold text-brand-900">{item.urun}</p>
          {item.uretici && kat === 'kulce' ? (
            <span className="text-xs font-normal text-brand-400">{item.uretici}</span>
          ) : null}
          {item.isGdprLocked ? (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-amber-700">
              <Lock className="h-2.5 w-2.5" /> GDPR
            </span>
          ) : null}
        </div>
      ),
    },
  ];

  if (kat === 'taki') {
    baseColumns.unshift({
      key: 'stok_no',
      label: 'Stok No',
      className: `${TH} w-16`,
      render: (item) => (
        <span className="text-xs font-black text-brand-600" style={monoStyle}>
          {item.stokNo || '—'}
        </span>
      ),
    });
  } else {
    baseColumns.unshift({
      key: 'index',
      label: '#',
      className: `${TH} w-8`,
      render: (_item) => null, // tablo render içinde idx inject edilir
    });
  }

  if (kat === 'sikke') {
    baseColumns.push({
      key: 'producer',
      label: 'Üretici',
      className: TH,
      render: (item) => <span className="text-xs text-brand-600">{item.uretici || '—'}</span>,
    });
  }

  const isGumus = kat === 'gumus';
  const isPlat = kat === 'platin_pd';
  const accent = isGumus ? 'slate' : isPlat ? 'zinc' : 'amber';
  const metalLabel = isPlat ? (platinAlt === 'platin' ? 'Pt' : 'Pd') : isGumus ? 'Finsølv' : 'Finguld';

  baseColumns.push({
    key: 'saflik',
    label: kat === 'sikke' ? 'Karat' : 'Saflık',
    className: TH,
    render: (item) => (
      <span
        className={`border border-${accent}-300 bg-${accent}-100 px-1.5 py-0.5 text-xs font-black text-${accent}-700`}
        style={monoStyle}
      >
        {saflikLabel(item.saflik, item.mainKat)}
      </span>
    ),
  });
  baseColumns.push({
    key: 'birim_gram',
    label: kat === 'taki' ? 'Brüt (g)' : 'g/adet',
    sortKey: 'birim_gram',
    className: `${TH} border-${accent}-300 bg-${accent}-50 text-${accent}-800`,
    render: (item) => (
      <span style={monoStyle}>{item.birimGram.toFixed(kat === 'sikke' ? 3 : 2)}</span>
    ),
  });
  baseColumns.push({
    key: 'adet',
    label: 'Adet',
    className: `${TH} border-${accent}-300 bg-${accent}-50 text-${accent}-800`,
    render: (item) => (
      <span className="font-bold" style={monoStyle}>
        {item.adet}
      </span>
    ),
  });
  baseColumns.push({
    key: 'toplam',
    label: 'Toplam (g)',
    sortKey: 'toplam_gram',
    className: `${TH} border-${accent}-400 bg-${accent}-100 text-${accent}-900`,
    render: (item) => (
      <span className="font-bold" style={monoStyle}>
        {(item.toplamGram ?? item.birimGram * item.adet).toFixed(kat === 'sikke' ? 3 : 2)}
      </span>
    ),
    footer: (totals) => (
      <span className="mono" style={monoStyle}>
        {totals.toplamGramSum.toFixed(kat === 'sikke' ? 3 : 2)} g
      </span>
    ),
  });
  baseColumns.push({
    key: 'has_metal',
    label: `${metalLabel} (g)`,
    className: `${TH} border-${accent}-500 bg-${accent}-200 text-${accent}-900`,
    render: (item) => (
      <span className="font-black" style={monoStyle}>
        {(item.hasMetalGrams ?? 0).toFixed(3)}
      </span>
    ),
    footer: (totals) => (
      <span className="mono" style={monoStyle}>
        {totals.hasMetalSum.toFixed(3)} g
      </span>
    ),
  });
  baseColumns.push({
    key: 'alis',
    label: 'Alış (DKK)',
    sortKey: 'alis_fiyati',
    className: `${TH} text-right`,
    align: 'right',
    render: (item) => (
      <span style={monoStyle}>{item.alisFiyati.toFixed(0)}</span>
    ),
    footer: (totals) => (
      <span className="mono" style={monoStyle}>
        {totals.alisSum.toFixed(0)}
      </span>
    ),
  });
  baseColumns.push({
    key: 'spot',
    label: 'Spot (DKK)',
    sortKey: 'spot_degeri',
    className: `${TH} border-emerald-300 bg-emerald-50 text-right text-emerald-800`,
    align: 'right',
    render: (item) => (
      <span className="font-semibold text-emerald-800" style={monoStyle}>
        {(item.spotDegeri ?? 0).toFixed(0)}
      </span>
    ),
    footer: (totals) => (
      <span className="mono" style={monoStyle}>
        {totals.spotSum.toFixed(0)}
      </span>
    ),
  });

  if (kat === 'taki') {
    baseColumns.push({
      key: 'shop',
      label: 'Shop (DKK)',
      sortKey: 'shop_fiyati',
      className: `${TH} border-blue-300 bg-blue-50 text-right text-blue-800`,
      align: 'right',
      render: (item) =>
        item.shopFiyati != null ? (
          <span className="font-semibold text-blue-800" style={monoStyle}>
            {item.shopFiyati.toFixed(0)}
          </span>
        ) : (
          <span className="text-brand-300">—</span>
        ),
      footer: (totals) =>
        totals.shopSum > 0 ? (
          <span className="mono" style={monoStyle}>
            {totals.shopSum.toFixed(0)}
          </span>
        ) : (
          '—'
        ),
    });
    baseColumns.push({
      key: 'fark',
      label: 'Fark',
      className: `${TH} border-purple-300 bg-purple-50 text-right text-purple-800`,
      align: 'right',
      render: (item) =>
        item.shopFark != null ? (
          <span
            className={item.shopFark >= 0 ? 'font-semibold text-purple-700' : 'font-semibold text-red-600'}
            style={monoStyle}
          >
            {item.shopFark >= 0 ? '+' : ''}
            {item.shopFark.toFixed(0)}
          </span>
        ) : (
          <span className="text-brand-300">—</span>
        ),
    });
    baseColumns.push({
      key: 'olcu',
      label: 'Ölçü',
      className: TH,
      render: (item) => {
        const olcu = [
          item.olcuUzunluk,
          item.olcuGenislik ? `${item.olcuGenislik}mm` : null,
          item.olcuKalinlik ? `${item.olcuKalinlik}mm` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <span className="text-xs text-brand-500" style={monoStyle}>
            {olcu || '—'}
          </span>
        );
      },
    });
    baseColumns.push({
      key: 'shop_durum',
      label: 'Durum',
      className: TH,
      render: (item) =>
        item.shopDurumu ? (
          <span
            className={`whitespace-nowrap border px-1.5 py-0.5 text-xs font-bold ${DURUM_STYLE[item.shopDurumu] || 'bg-brand-100 border-brand-300 text-brand-600'}`}
          >
            {DURUM_LABEL[item.shopDurumu]}
          </span>
        ) : (
          <span className="text-xs text-brand-300">—</span>
        ),
    });
  }

  return baseColumns;
}

export interface InventoryDataTableProps {
  items: StokItem[];
  catTotal: CategoryTotals;
  kat: MainCategory;
  platinAlt?: PlatinumSub;
  marketPrices: MarketPrices;
  sort: InventorySortState;
  onSort: (key: InventorySortKey) => void;
  onView: (item: StokItem) => void;
  onEdit: (item: StokItem) => void;
  onDelete: (id: string) => void;
  onPrintLabel: (item: StokItem) => void;
  printingLabelForId: string | null;
}

export function InventoryDataTable({
  items,
  catTotal,
  kat,
  platinAlt,
  sort,
  onSort,
  onView,
  onEdit,
  onDelete,
  onPrintLabel,
  printingLabelForId,
}: InventoryDataTableProps) {
  const columns = useMemo(() => buildColumns(kat, platinAlt), [kat, platinAlt]);
  const colspanIndex = Math.max(0, columns.findIndex((c) => c.footer != null));

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b-2 border-brand-400">
          {columns.map((col) => (
            <SortableHeader
              key={col.key}
              label={col.label}
              sortKey={col.sortKey}
              sort={sort}
              onSort={onSort}
              className={col.className}
            />
          ))}
          <th className={`${TH} w-24`}>İşlem</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => (
          <tr
            key={item.id}
            className={`border-b border-brand-100 transition-colors hover:bg-amber-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-brand-50'}`}
          >
            {columns.map((col) => (
              <td
                key={col.key}
                className={`${TD} ${col.align === 'right' ? 'text-right' : col.align === 'center' || !col.align ? 'text-center' : ''}`}
              >
                {col.key === 'index' ? (
                  <span className="font-bold text-brand-400" style={monoStyle}>
                    {idx + 1}
                  </span>
                ) : (
                  col.render(item)
                )}
              </td>
            ))}
            <td className={`${TD} text-center`}>
              <div className="flex items-center justify-center gap-1">
                <button
                  type="button"
                  onClick={() => onView(item)}
                  className="border border-brand-300 bg-white p-1 text-brand-600 transition-colors hover:border-brand-500 hover:bg-brand-50 hover:text-brand-900"
                  title="Detay"
                >
                  <Eye className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(item)}
                  className="flex items-center bg-brand-700 p-1 text-white transition-colors hover:bg-brand-900"
                  title="Düzenle"
                >
                  <Edit2 className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onPrintLabel(item)}
                  disabled={printingLabelForId === item.id}
                  className="border border-blue-300 bg-blue-50 p-1 text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-wait disabled:opacity-50"
                  title="Etiket Yazdır"
                >
                  <Printer className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  className="border border-red-200 p-1 text-red-400 transition-colors hover:border-red-400 hover:text-red-700"
                  title="Sil"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-brand-400">
          {columns.map((col, idx) => (
            <td key={col.key} className={`${TF} ${col.align === 'right' ? 'text-right' : 'text-center'}`}>
              {idx === colspanIndex ? null : col.footer ? col.footer(catTotal) : idx === 0 ? `${items.length} kalem` : null}
            </td>
          ))}
          <td className={TF} />
        </tr>
      </tfoot>
    </table>
  );
}

export { Sparkles };
