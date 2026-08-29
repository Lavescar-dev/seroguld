import { useMemo, useState } from 'react';
import { RefreshCcw, X } from 'lucide-react';

import type { WooCategory } from './useWooMakeState';

export function filterCategories(categories: WooCategory[], query: string): WooCategory[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return categories;
  // Eşleşen kategorinin ebeveyn zinciri de listede kalır — girinti bağlamı kopmaz.
  const byId = new Map(categories.map((item) => [item.id, item]));
  const keep = new Set<number>();
  for (const item of categories) {
    if (!item.name.toLowerCase().includes(needle)) continue;
    keep.add(item.id);
    let parent = item.parent;
    let guard = 0;
    while (parent && guard < 20) {
      const entry = byId.get(parent);
      if (!entry || keep.has(entry.id)) break;
      keep.add(entry.id);
      parent = entry.parent;
      guard += 1;
    }
  }
  return categories.filter((item) => keep.has(item.id));
}

interface WooCategoryPickerProps {
  categories: WooCategory[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  // R1-10: secili bir kategoriyi liste basina (=Primaer) tasir; opsiyonel.
  onMakePrimary?: (id: number) => void;
  onRefresh: () => void;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  /** Klasik keskin köşeli görünüm için 'classic', yumuşak modern için 'modern'. */
  variant?: 'classic' | 'modern';
}

export function WooCategoryPicker({
  categories,
  selectedIds,
  onToggle,
  onMakePrimary,
  onRefresh,
  loading = false,
  error = null,
  disabled = false,
  variant = 'classic',
}: WooCategoryPickerProps) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterCategories(categories, query), [categories, query]);
  const selected = useMemo(
    () => selectedIds.map((id) => categories.find((item) => item.id === id) ?? null),
    [categories, selectedIds],
  );

  const isModern = variant === 'modern';
  const frame = isModern
    ? 'rounded-sg-md border border-sg-border bg-sg-surface'
    : 'border border-brand-200 bg-white';
  const labelCls = isModern
    ? 'text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft'
    : 'text-[10px] font-black uppercase tracking-widest text-brand-500';
  const inputCls = isModern
    ? 'w-full rounded-sg-sm border border-sg-border bg-sg-surface px-2 py-1.5 text-xs text-sg-text'
    : 'w-full border border-brand-200 px-2 py-1.5 text-xs text-brand-900';
  const chipCls = isModern
    ? 'inline-flex items-center gap-1 rounded-full border border-sg-accent/30 bg-sg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-sg-accent'
    : 'inline-flex items-center gap-1 border border-brand-300 bg-brand-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-brand-800';

  return (
    <div className={`${frame} p-3`}>
      <div className="flex items-center justify-between gap-2">
        <p className={labelCls}>Site kategorileri (WP)</p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={disabled || loading}
          className={
            isModern
              ? 'inline-flex items-center gap-1 text-[11px] font-semibold text-sg-accent disabled:opacity-50'
              : 'inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-brand-600 disabled:opacity-50'
          }
        >
          <RefreshCcw className="h-3 w-3" />
          Yenile
        </button>
      </div>
      {selected.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((item, index) =>
            item ? (
              <span key={item.id} className={chipCls}>
                {item.name}
                <button type="button" aria-label={`${item.name} kategorisini kaldır`} onClick={() => onToggle(item.id)} disabled={disabled}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ) : (
              <span key={`missing-${selectedIds[index]}`} className={chipCls}>
                #{selectedIds[index]}
                <button type="button" aria-label="Kategoriyi kaldır" onClick={() => onToggle(selectedIds[index])} disabled={disabled}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ),
          )}
        </div>
      ) : (
        <p className={isModern ? 'mt-2 text-xs text-sg-text-soft' : 'mt-2 text-xs text-brand-500'}>
          Kategori seçilmedi — yayın Settings kategori haritasını kullanır.
        </p>
      )}
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Kategori ara..."
        className={`mt-2 ${inputCls}`}
        disabled={disabled}
      />
      <div className={`mt-2 max-h-48 overflow-y-auto ${isModern ? 'rounded-sg-sm border border-sg-border-soft' : 'border border-brand-100'}`}>
        {loading ? (
          <p className={isModern ? 'p-3 text-xs text-sg-text-soft' : 'p-3 text-xs text-brand-500'}>Kategoriler yükleniyor...</p>
        ) : error ? (
          <p className={isModern ? 'p-3 text-xs text-sg-red' : 'p-3 text-xs text-red-600'}>{error}</p>
        ) : visible.length === 0 ? (
          <p className={isModern ? 'p-3 text-xs text-sg-text-soft' : 'p-3 text-xs text-brand-500'}>
            {categories.length === 0 ? 'Siteden kategori alınamadı — Yenile ile tekrar deneyin.' : 'Aramayla eşleşen kategori yok.'}
          </p>
        ) : (
          visible.map((item) => (
            <label
              key={item.id}
              className={
                isModern
                  ? 'flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs text-sg-text hover:bg-sg-surface-soft'
                  : 'flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs text-brand-900 hover:bg-brand-50'
              }
              style={{ paddingLeft: `${8 + item.depth * 16}px` }}
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(item.id)}
                onChange={() => onToggle(item.id)}
                disabled={disabled}
              />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {/* R1-10: ilk seçili kategori Primær olarak yayınlanır (payload'da
                  primary_category_id = ilk id); diğer seçililer tek tıkla öne alınabilir. */}
              {selectedIds[0] === item.id ? (
                <span className={isModern ? 'rounded bg-sg-green-soft px-1.5 py-0.5 text-[10px] font-semibold text-sg-green-strong' : 'bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700'}>Primær</span>
              ) : selectedIds.includes(item.id) && onMakePrimary ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    onMakePrimary(item.id);
                  }}
                  className={isModern ? 'text-[10px] text-sg-accent hover:underline' : 'text-[10px] font-bold text-brand-500 hover:underline'}
                >
                  Primær yap
                </button>
              ) : null}
              <span className={isModern ? 'text-[10px] text-sg-text-soft' : 'text-[10px] text-brand-400'}>{item.count}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
