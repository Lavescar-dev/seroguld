import type { Dispatch, SetStateAction } from 'react';
import { Calendar, FilterX, Lock, Search, Sparkles } from 'lucide-react';

import type { InventoryFilterState } from './types';
import { EMPTY_FILTERS, STATUS_FILTER_OPTIONS } from './types';

interface InventoryFiltersProps {
  filters: InventoryFilterState;
  setFilters: Dispatch<SetStateAction<InventoryFilterState>>;
  onReset: () => void;
  totalCount: number;
  filteredCount: number;
}

const inputCls =
  'w-full border border-brand-300 bg-white px-2 py-1 text-xs text-brand-900 focus:border-brand-700 focus:outline-none';

export function InventoryFilters({
  filters,
  setFilters,
  onReset,
  totalCount,
  filteredCount,
}: InventoryFiltersProps) {
  const hasAny =
    filters.q ||
    filters.dateFrom ||
    filters.dateTo ||
    filters.weightMin ||
    filters.weightMax ||
    filters.priceMin ||
    filters.priceMax ||
    filters.location ||
    filters.needsCleaning ||
    filters.status ||
    filters.gdprLocked !== 'all';

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-brand-200 bg-white px-4 py-2 print:hidden">
      <div className="relative flex-1 min-w-[16rem]">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-400" />
        <input
          type="text"
          placeholder="Stok no, ürün adı, üretici, depo, notlar..."
          value={filters.q}
          onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
          className={`${inputCls} pl-7`}
        />
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-brand-500">Tarih</span>
        <div className="relative">
          <Calendar className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-brand-400" />
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))}
            className={`${inputCls} mono w-32 pl-6`}
            title="Başlangıç"
          />
        </div>
        <span className="text-brand-400">→</span>
        <div className="relative">
          <Calendar className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-brand-400" />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))}
            className={`${inputCls} mono w-32 pl-6`}
            title="Bitiş"
          />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-brand-500">Gram</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          placeholder="Min"
          value={filters.weightMin}
          onChange={(event) => setFilters((current) => ({ ...current, weightMin: event.target.value }))}
          className={`${inputCls} mono w-16`}
        />
        <span className="text-brand-400">→</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          placeholder="Max"
          value={filters.weightMax}
          onChange={(event) => setFilters((current) => ({ ...current, weightMax: event.target.value }))}
          className={`${inputCls} mono w-16`}
        />
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-brand-500">Alış DKK</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          placeholder="Min"
          value={filters.priceMin}
          onChange={(event) => setFilters((current) => ({ ...current, priceMin: event.target.value }))}
          className={`${inputCls} mono w-20`}
        />
        <span className="text-brand-400">→</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          placeholder="Max"
          value={filters.priceMax}
          onChange={(event) => setFilters((current) => ({ ...current, priceMax: event.target.value }))}
          className={`${inputCls} mono w-20`}
        />
      </div>

      <input
        type="text"
        placeholder="Depo / lokasyon"
        value={filters.location}
        onChange={(event) => setFilters((current) => ({ ...current, location: event.target.value }))}
        className={`${inputCls} w-32`}
      />

      <button
        type="button"
        onClick={() => setFilters((current) => ({ ...current, needsCleaning: !current.needsCleaning }))}
        className={`inline-flex items-center gap-1 border px-2 py-1 text-[10px] font-black uppercase tracking-widest transition ${
          filters.needsCleaning
            ? 'border-orange-400 bg-orange-100 text-orange-700'
            : 'border-brand-300 bg-white text-brand-500 hover:bg-brand-50'
        }`}
        title="Sadece temizlik gereken ürünler"
      >
        <Sparkles className="h-3 w-3" />
        Temizlik
      </button>

      <select
        value={filters.status}
        onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
        className={`${inputCls} w-40`}
        title="Ürün durumu (satılmış/eritilmiş dahil görüntüle)"
      >
        {STATUS_FILTER_OPTIONS.map((option) => (
          <option key={option.value || 'default'} value={option.value}>
            {option.value ? `Durum: ${option.label}` : option.label}
          </option>
        ))}
      </select>

      <select
        value={filters.gdprLocked}
        onChange={(event) =>
          setFilters((current) => ({ ...current, gdprLocked: event.target.value as InventoryFilterState['gdprLocked'] }))
        }
        className={`${inputCls} w-32`}
        title="GDPR kilit durumu"
      >
        <option value="all">GDPR: Hepsi</option>
        <option value="locked">GDPR: Kilitli</option>
        <option value="unlocked">GDPR: Açık</option>
      </select>

      {hasAny ? (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1 border border-red-200 bg-white p-1.5 text-red-500 transition hover:border-red-400 hover:bg-red-50 hover:text-red-700"
          title="Filtreleri Temizle"
        >
          <FilterX className="h-3.5 w-3.5" />
        </button>
      ) : null}

      <span className="mono ml-auto border border-brand-300 bg-brand-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-brand-600">
        {filteredCount === totalCount ? `${totalCount} kayıt` : `${filteredCount} / ${totalCount} kayıt`}
      </span>
    </div>
  );
}

// Re-export for convenience
export { EMPTY_FILTERS, Lock };
