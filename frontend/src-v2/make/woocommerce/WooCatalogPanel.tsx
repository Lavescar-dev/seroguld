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

import { useEffect, useRef, useState } from 'react';

import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { openExternalUrl } from '@/lib/desktop';
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
              <p className="mt-1 text-xs text-amber-800">Aşağıdaki değişiklikler yalnız “Onayla ve uygula” dediğinizde kataloğa yazılır. Önizleme 15 dakika geçerlidir.</p>
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
                <tr
                  key={item.id}
                  onClick={() => state.openCatalogDetail(item.id)}
                  className={`cursor-pointer border-b ${classic ? 'border-brand-100 hover:bg-brand-50' : 'border-sg-border-soft hover:bg-sg-surface-soft'}`}
                >
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
                  <td className="px-4 py-3">{item.linked_product_id ? <span className="inline-flex items-center gap-1 text-emerald-700"><Link2 className="h-3.5 w-3.5" />CRM bağlı</span> : item.permalink ? <a href={item.permalink} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void openExternalUrl(item.permalink as string); }} className="inline-flex items-center gap-1 text-blue-700 hover:underline">Siteyi aç<ExternalLink className="h-3 w-3" /></a> : '—'}</td>
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

      {state.catalogDetailId ? <WooCatalogDetailDrawer state={state} classic={classic} buttonClass={button} /> : null}
    </section>
  );
}

/** HTML açıklamaları güvenli düz metin olarak gösterir (etiketler sökülür). */
export function stripHtmlToText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function WooCatalogDetailDrawer({ state, classic, buttonClass }: { state: WooMakeState; classic: boolean; buttonClass: string }) {
  const detail = state.catalogDetail;
  const [linkTargetId, setLinkTargetId] = useState('');
  // R1-16: çekmece içi içerik düzenleme — kaydet Woo'ya yazar.
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSeoTitle, setEditSeoTitle] = useState('');
  const [editMetaDesc, setEditMetaDesc] = useState('');
  const [editShort, setEditShort] = useState('');
  const [editLong, setEditLong] = useState('');
  // Açılıştaki değerler: kaydet YALNIZ değişen alanları gönderir (backend
  // None = dokunma) — bayat snapshot WP'de sonradan yapılmış düzenlemeleri ezmesin.
  const editBaselineRef = useRef<Record<string, string>>({});
  const openEditor = () => {
    if (!detail) return;
    const baseline = {
      name: detail.name || '',
      seo_title: detail.seo_title || '',
      meta_description: detail.meta_description || '',
      short: detail.short_description_html || '',
      long: detail.description_html || '',
    };
    editBaselineRef.current = baseline;
    setEditName(baseline.name);
    setEditSeoTitle(baseline.seo_title);
    setEditMetaDesc(baseline.meta_description);
    setEditShort(baseline.short);
    setEditLong(baseline.long);
    setEditOpen(true);
  };
  // Çekmece başka bir katalog kaydına geçerse editör bayat alanlarla kalmasın.
  useEffect(() => {
    setEditOpen(false);
  }, [detail?.id]);
  const close = () => state.openCatalogDetail(null);
  const seoRows: Array<[string, string]> = detail
    ? [
        ['SEO başlığı', detail.seo_title || '—'],
        ['Meta açıklama', detail.meta_description || '—'],
        ['Kısa açıklama', stripHtmlToText(detail.short_description_html) || '—'],
        ['Açıklama', stripHtmlToText(detail.description_html) || '—'],
      ]
    : [];
  const unlinkedProducts = state.urunler.filter((item) => item.id);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-label="Katalog ürün detayı" onClick={close}>
      <div
        className={`flex h-full w-full max-w-[560px] flex-col overflow-y-auto shadow-2xl ${classic ? 'bg-white text-brand-900' : 'border-l border-sg-border bg-sg-surface text-sg-text'}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`sticky top-0 z-10 flex items-start justify-between gap-3 border-b px-5 py-4 ${classic ? 'border-brand-200 bg-white' : 'border-sg-border bg-sg-surface'}`}>
          <div className="min-w-0">
            <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${classic ? 'text-brand-500' : 'text-sg-accent'}`}>Woo katalog ürünü</p>
            <h3 className="mt-1 truncate text-base font-semibold">{detail?.name || 'Yükleniyor…'}</h3>
            {detail ? <p className={`mt-0.5 text-xs ${classic ? 'text-brand-500' : 'text-sg-text-soft'}`}>#{detail.woocommerce_product_id} · {detail.remote_status === 'publish' ? 'Yayında' : detail.remote_status} · {detail.sku || 'SKU yok'}</p> : null}
          </div>
          <button type="button" className={buttonClass} onClick={close} aria-label="Kapat">Kapat</button>
        </div>

        {state.catalogDetailLoading || !detail ? (
          <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm"><LoaderCircle className="h-5 w-5 animate-spin" />Detay yükleniyor…</div>
        ) : (
          <div className="space-y-4 p-5">
            {detail.images.length ? (
              <div className="flex gap-2 overflow-x-auto">
                {detail.images.slice(0, 6).map((image, index) => image.src ? <img key={image.id ?? index} src={image.src} alt={image.alt || ''} className="h-20 w-20 shrink-0 rounded object-cover" /> : null)}
              </div>
            ) : null}

            <div className={`grid gap-px sm:grid-cols-3 ${classic ? 'border border-brand-200 bg-brand-200' : 'rounded-sg-md border border-sg-border-soft bg-sg-border-soft'}`}>
              {([
                ['Fiyat', detail.price_dkk == null ? '—' : formatMoney(detail.price_dkk)],
                ['Ağırlık', detail.weight_grams == null ? '—' : formatNumber(detail.weight_grams, ' g')],
                ['Kategoriler', detail.categories.map((entry) => entry.name).filter(Boolean).join(', ') || '—'],
              ] as const).map(([label, value]) => (
                <div key={label} className={`px-3 py-2 ${classic ? 'bg-white' : 'bg-sg-surface'}`}>
                  <p className={`text-[10px] font-semibold uppercase tracking-[0.13em] ${classic ? 'text-brand-400' : 'text-sg-text-soft'}`}>{label}</p>
                  <p className="mt-1 text-sm font-semibold">{value}</p>
                </div>
              ))}
            </div>

            <div className={classic ? 'border border-brand-200' : 'rounded-sg-md border border-sg-border-soft'}>
              <div className={`flex items-center justify-between border-b px-3 py-2 ${classic ? 'border-brand-200' : 'border-sg-border-soft'}`}>
                <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${classic ? 'text-brand-500' : 'text-sg-text-soft'}`}>SEO & açıklamalar</p>
                <button type="button" className={buttonClass} onClick={() => (editOpen ? setEditOpen(false) : openEditor())}>
                  {editOpen ? 'Düzenlemeyi kapat' : 'Düzenle'}
                </button>
              </div>
              {editOpen ? (
                <div className="space-y-3 p-3">
                  {/* R1-16: düzenlenen alanlar kaydedilince doğrudan sitedeki ürüne yazılır. */}
                  {([
                    ['Ürün adı', editName, setEditName, false],
                    ['SEO başlığı', editSeoTitle, setEditSeoTitle, false],
                    ['Meta açıklama', editMetaDesc, setEditMetaDesc, true],
                    ['Kısa açıklama (HTML)', editShort, setEditShort, true],
                    ['Açıklama (HTML)', editLong, setEditLong, true],
                  ] as Array<[string, string, (value: string) => void, boolean]>).map(([label, value, setter, multiline]) => (
                    <label key={label} className="block">
                      <span className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${classic ? 'text-brand-400' : 'text-sg-text-soft'}`}>{label}</span>
                      {multiline ? (
                        <textarea
                          value={value}
                          onChange={(event) => setter(event.target.value)}
                          rows={label.startsWith('Açıklama') ? 8 : 3}
                          className={classic ? 'mt-1 w-full border border-brand-300 bg-white px-2 py-1.5 text-xs' : 'mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-2 py-1.5 text-xs'}
                        />
                      ) : (
                        <input
                          value={value}
                          onChange={(event) => setter(event.target.value)}
                          className={classic ? 'mt-1 w-full border border-brand-300 bg-white px-2 py-1.5 text-xs' : 'mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-2 py-1.5 text-xs'}
                        />
                      )}
                    </label>
                  ))}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={classic ? 'border border-emerald-700 bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50' : 'rounded-sg-md bg-sg-green-strong px-3 py-2 text-xs font-semibold text-white disabled:opacity-50'}
                      disabled={state.isCatalogActionPending}
                      onClick={() => {
                        void (async () => {
                          const baseline = editBaselineRef.current;
                          // Yalnız değişen alanlar; değişmeyenler gönderilmez (null=dokunma).
                          const body = {
                            name: editName !== baseline.name ? editName : null,
                            seo_title: editSeoTitle !== baseline.seo_title ? editSeoTitle : null,
                            meta_description: editMetaDesc !== baseline.meta_description ? editMetaDesc : null,
                            short_description_html: editShort !== baseline.short ? editShort : null,
                            description_html: editLong !== baseline.long ? editLong : null,
                          };
                          if (Object.values(body).every((value) => value === null)) {
                            setEditOpen(false);
                            return;
                          }
                          const ok = await state.updateCatalogContent(detail.id, body);
                          if (ok) setEditOpen(false);
                        })();
                      }}
                    >
                      {state.isCatalogActionPending ? 'Kaydediliyor…' : 'Siteye kaydet'}
                    </button>
                    <button type="button" className={buttonClass} onClick={() => setEditOpen(false)}>Vazgeç</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 p-3">
                  {seoRows.map(([label, value]) => (
                    <div key={label}>
                      <p className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${classic ? 'text-brand-400' : 'text-sg-text-soft'}`}>{label}</p>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">{value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {detail.permalink ? (
                <a href={detail.permalink} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); void openExternalUrl(detail.permalink as string); }} className={buttonClass}>
                  <span className="inline-flex items-center gap-1">Siteyi aç<ExternalLink className="h-3 w-3" /></span>
                </a>
              ) : null}
              {detail.remote_status === 'publish' && detail.is_active ? (
                <button
                  type="button"
                  className={classic ? 'border border-red-300 bg-white px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50' : 'rounded-sg-md border border-sg-red/30 bg-sg-red-soft px-3 py-2 text-xs font-semibold text-sg-red disabled:opacity-50'}
                  disabled={state.isCatalogActionPending}
                  onClick={() => {
                    if (window.confirm('Ürün sitede taslağa çekilsin mi?')) state.unpublishCatalogItem(detail.id);
                  }}
                >
                  Yayından kaldır
                </button>
              ) : null}
            </div>

            <div className={classic ? 'border border-brand-200 p-3' : 'rounded-sg-md border border-sg-border-soft p-3'}>
              <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${classic ? 'text-brand-500' : 'text-sg-text-soft'}`}>CRM bağlantısı</p>
              {detail.linked_product_id ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><Link2 className="h-3.5 w-3.5" />Bu kayıt bir CRM ürününe bağlı.</span>
                  <button type="button" className={buttonClass} onClick={() => state.setSecilenId(detail.linked_product_id)}>CRM ürününü seç</button>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={state.isCatalogActionPending}
                    onClick={() => {
                      if (window.confirm('Katalog kaydının CRM bağlantısı kaldırılsın mı?')) state.unlinkCatalogItem(detail.id);
                    }}
                  >
                    Bağlantıyı kaldır
                  </button>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Bağlanacak CRM ürünü"
                    value={linkTargetId}
                    onChange={(event) => setLinkTargetId(event.target.value)}
                    className={classic ? 'min-w-[220px] border border-brand-300 bg-white px-2 py-2 text-xs' : 'min-w-[220px] rounded-sg-md border border-sg-border bg-sg-surface px-2 py-2 text-xs'}
                  >
                    <option value="">CRM ürünü seçin…</option>
                    {unlinkedProducts.map((item) => (
                      <option key={item.id} value={item.id}>{item.urun}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={!linkTargetId || state.isCatalogActionPending}
                    onClick={() => state.linkCatalogItem(detail.id, linkTargetId)}
                  >
                    <span className="inline-flex items-center gap-1"><Link2 className="h-3.5 w-3.5" />Bağla</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
