import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  ExternalLink,
  ImageOff,
  Link2,
  LoaderCircle,
  PackageSearch,
  RefreshCw,
  Search,
} from 'lucide-react';

import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import type { WooCatalogSyncSummary, WooMakeState } from './useWooMakeState';

type WooCatalogPanelProps = {
  state: WooMakeState;
  mode: 'modern' | 'classic';
  onOpenLocalProducts: () => void;
};

function summaryCards(summary: WooCatalogSyncSummary) {
  return [
    ['Uzakta yayınlı', summary.remote_published_count],
    ['Yeni', summary.create_count],
    ['Güncellenecek', summary.update_count],
    ['Değişmedi', summary.unchanged_count],
    ['Pasif yapılacak', summary.deactivate_count],
    ['Kontrol gerekli', summary.manual_review_count],
  ] as const;
}

export function WooCatalogPanel({ state, mode, onOpenLocalProducts }: WooCatalogPanelProps) {
  const status = state.catalogStatus;
  const catalog = state.catalog;
  const classic = mode === 'classic';
  const surface = classic ? 'bg-white text-brand-900' : 'rounded-sg-lg border border-sg-border bg-sg-surface text-sg-text shadow-sg-sm';
  const soft = classic ? 'bg-brand-50 border-brand-200' : 'bg-sg-surface-soft border-sg-border-soft';
  const button = classic
    ? 'border border-brand-300 bg-white px-3 py-2 text-xs font-bold text-brand-700 hover:bg-brand-50 disabled:opacity-50'
    : 'rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-xs font-semibold text-sg-text transition hover:bg-sg-surface-soft disabled:opacity-50';
  const primaryButton = classic
    ? 'border border-brand-900 bg-brand-800 px-4 py-2 text-xs font-bold text-white hover:bg-brand-900 disabled:opacity-50'
    : 'rounded-sg-md bg-sg-accent px-4 py-2 text-xs font-semibold text-white transition hover:bg-sg-accent-dark disabled:opacity-50';

  return (
    <section className={`min-w-0 overflow-hidden ${surface}`}>
      <header className={`flex flex-wrap items-center gap-3 border-b px-5 py-4 ${soft}`}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center ${classic ? 'bg-brand-800 text-white' : 'rounded-sg-md bg-sg-accent-soft text-sg-accent'}`}>
            <Cloud className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${classic ? 'text-brand-500' : 'text-sg-accent'}`}>WooCommerce canlı katalog</p>
            <h2 className="truncate text-base font-semibold">Web sitesindeki yayınlı ürünler</h2>
            <p className={`mt-0.5 text-xs ${classic ? 'text-brand-500' : 'text-sg-text-soft'}`}>Depolama ve muhasebe kayıtlarından ayrı, güvenli katalog görünümü.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs font-semibold ${status?.reachable ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-700'}`}>
            {status?.reachable ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {status?.reachable ? 'Woo bağlı' : status?.configured ? 'Woo erişilemiyor' : 'Woo ayarlanmamış'}
          </span>
          <button type="button" className={button} onClick={onOpenLocalProducts}>CRM ürünleri</button>
          <button type="button" className={button} disabled={state.catalogLoading} onClick={() => void state.refreshCatalog()}>
            <span className="inline-flex items-center gap-2"><RefreshCw className={`h-3.5 w-3.5 ${state.catalogLoading ? 'animate-spin' : ''}`} />Yenile</span>
          </button>
          <button type="button" className={primaryButton} disabled={state.isPreviewingCatalog || state.isApplyingCatalog || !status?.configured} onClick={state.previewCatalogSync}>
            <span className="inline-flex items-center gap-2">{state.isPreviewingCatalog ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}Woo’dan senkronize et</span>
          </button>
        </div>
      </header>

      <div className={`grid gap-px border-b sm:grid-cols-4 ${classic ? 'bg-brand-200 border-brand-200' : 'bg-sg-border-soft border-sg-border-soft'}`}>
        {[
          ['Uzakta yayınlı', status?.remote_published_count ?? '—'],
          ['Yerel katalog', status?.local_active_count ?? catalog?.total ?? 0],
          ['Pasif kayıt', status?.local_inactive_count ?? 0],
          ['Son senkron', status?.last_synced_at ? formatDate(status.last_synced_at) : 'Henüz yok'],
        ].map(([label, value]) => (
          <div key={label} className={`px-4 py-3 ${classic ? 'bg-white' : 'bg-sg-surface'}`}>
            <p className={`text-[10px] font-semibold uppercase tracking-[0.13em] ${classic ? 'text-brand-400' : 'text-sg-text-soft'}`}>{label}</p>
            <p className="mt-1 text-sm font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {state.catalogPreview ? (
        <div className="border-b border-amber-300 bg-amber-50 px-5 py-4 text-amber-950">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold">Senkronizasyon önizlemesi hazır</p>
              <p className="mt-1 text-xs text-amber-800">Aşağıdaki değişiklikler yalnız “Onayla ve uygula” dediğinizde kataloğa yazılır.</p>
            </div>
            <button type="button" className="border border-amber-800 bg-amber-700 px-4 py-2 text-xs font-bold text-white hover:bg-amber-800 disabled:opacity-50" disabled={state.isApplyingCatalog} onClick={state.applyCatalogSync}>
              <span className="inline-flex items-center gap-2">{state.isApplyingCatalog ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Onayla ve uygula</span>
            </button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {summaryCards(state.catalogPreview.summary).map(([label, value]) => <div key={label} className="border border-amber-200 bg-white/70 px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-amber-700">{label}</p><p className="mt-1 text-sm font-bold">{value}</p></div>)}
          </div>
          {state.catalogPreview.warnings.length ? <p className="mt-3 text-xs text-amber-800">{state.catalogPreview.warnings.join(' · ')}</p> : null}
        </div>
      ) : null}

      <div className={`flex flex-wrap items-center gap-3 border-b px-5 py-3 ${soft}`}>
        <label className="relative min-w-[240px] flex-1">
          <Search className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${classic ? 'text-brand-400' : 'text-sg-text-soft'}`} />
          <input aria-label="Woo kataloğunda ara" value={state.catalogSearch} onChange={(event) => state.setCatalogSearch(event.target.value)} placeholder="Ürün adı, SKU veya Woo ID ara" className={`w-full border py-2 pl-9 pr-3 text-sm outline-none ${classic ? 'border-brand-300 bg-white focus:border-brand-700' : 'rounded-sg-md border-sg-border bg-sg-surface focus:border-sg-accent'}`} />
        </label>
        <span className={`text-xs ${classic ? 'text-brand-500' : 'text-sg-text-soft'}`}>{catalog?.total ?? 0} katalog ürünü</span>
      </div>

      {state.catalogError ? <div className="border-b border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">{state.catalogError}</div> : null}
      {state.catalogLoading && !catalog ? <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm"><LoaderCircle className="h-5 w-5 animate-spin" />Katalog hazırlanıyor…</div> : null}
      {!state.catalogLoading && catalog && catalog.items.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <PackageSearch className={`mx-auto h-9 w-9 ${classic ? 'text-brand-300' : 'text-sg-text-soft'}`} />
          <p className="mt-3 text-sm font-semibold">Katalogda ürün yok</p>
          <p className={`mt-1 text-xs ${classic ? 'text-brand-500' : 'text-sg-text-soft'}`}>{state.catalogSearch ? 'Aramaya uyan ürün bulunamadı.' : 'WooCommerce ürünlerini önce önizleyip onaylayarak senkronize edin.'}</p>
        </div>
      ) : null}

      {catalog?.items.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-xs">
            <thead className={classic ? 'bg-brand-800 text-brand-200' : 'bg-sg-surface-soft text-sg-text-soft'}>
              <tr>{['Ürün', 'SKU / Woo ID', 'Fiyat', 'Ağırlık', 'Stok', 'Kontrol', 'Bağlantı'].map((label) => <th key={label} className="border-b px-4 py-2.5 font-semibold uppercase tracking-[0.1em]">{label}</th>)}</tr>
            </thead>
            <tbody>
              {catalog.items.map((item) => (
                <tr key={item.id} className={`border-b ${classic ? 'border-brand-100 hover:bg-brand-50' : 'border-sg-border-soft hover:bg-sg-surface-soft'}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {item.images[0]?.src ? <img src={item.images[0].src} alt="" className="h-10 w-10 shrink-0 rounded object-cover" /> : <div className={`flex h-10 w-10 shrink-0 items-center justify-center ${classic ? 'bg-brand-100' : 'rounded bg-sg-surface-soft'}`}><ImageOff className="h-4 w-4" /></div>}
                      <div className="min-w-0"><p className="max-w-[280px] truncate font-semibold">{item.name}</p><p className={`mt-1 max-w-[280px] truncate ${classic ? 'text-brand-400' : 'text-sg-text-soft'}`}>{item.categories.map((entry) => entry.name).filter(Boolean).join(' · ') || 'Kategori yok'}</p></div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><p className="font-medium">{item.sku || 'SKU yok'}</p><p className={`mt-1 ${classic ? 'text-brand-400' : 'text-sg-text-soft'}`}>#{item.woocommerce_product_id}</p></td>
                  <td className="px-4 py-3 font-semibold">{item.price_dkk == null ? '—' : formatMoney(item.price_dkk)}</td>
                  <td className="px-4 py-3">{item.weight_grams == null ? <span className="text-amber-700">Eksik</span> : formatNumber(item.weight_grams, ' g')}</td>
                  <td className="px-4 py-3"><p>{item.stock_status || '—'}</p><p className={`mt-1 ${classic ? 'text-brand-400' : 'text-sg-text-soft'}`}>{item.stock_quantity ?? '—'} adet</p></td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{item.manual_review_required ? <span className="border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-800">Manuel</span> : <span className="border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-emerald-800">Hazır</span>}{item.photo_missing ? <span className="border border-red-200 bg-red-50 px-1.5 py-0.5 text-red-700">Foto yok</span> : null}</div></td>
                  <td className="px-4 py-3">{item.linked_product_id ? <span className="inline-flex items-center gap-1 text-emerald-700"><Link2 className="h-3.5 w-3.5" />CRM bağlı</span> : item.permalink ? <a href={item.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">Siteyi aç<ExternalLink className="h-3 w-3" /></a> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {catalog && catalog.total_pages > 1 ? (
        <footer className={`flex items-center justify-between gap-3 border-t px-5 py-3 ${soft}`}>
          <span className="text-xs">Sayfa {catalog.page} / {catalog.total_pages}</span>
          <div className="flex gap-2">
            <button type="button" className={button} disabled={catalog.page <= 1} onClick={() => state.setCatalogPageNumber(Math.max(1, catalog.page - 1))}><span className="inline-flex items-center gap-1"><ChevronLeft className="h-3.5 w-3.5" />Önceki</span></button>
            <button type="button" className={button} disabled={catalog.page >= catalog.total_pages} onClick={() => state.setCatalogPageNumber(Math.min(catalog.total_pages, catalog.page + 1))}><span className="inline-flex items-center gap-1">Sonraki<ChevronRight className="h-3.5 w-3.5" /></span></button>
          </div>
        </footer>
      ) : null}
    </section>
  );
}
