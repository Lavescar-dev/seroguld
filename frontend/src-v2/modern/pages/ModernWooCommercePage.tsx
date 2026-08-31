import { buildMediaUrl } from '@/lib/media';
import { type ChangeEvent, type DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Clock3,
  Eye,
  Globe,
  History,
  Image as ImageIcon,
  Info,
  Link2,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { apiRequest, localizeApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { openExternalUrl } from '@/lib/desktop';
import {
  ModernBadge,
  ModernButton,
  ModernCard,
  ModernEmptyState,
  ModernErrorState,
  ModernKeyValueList,
  ModernLoadingState,
  ModernNotice,
  ModernPage,
  ModernSection,
  ModernSectionHeader,
  ModernTextInput,
  ModernTextarea,
  ModernToolbar,
} from '@/modern/design-system';
import {
  isPublishReady,
  missingSeoFields,
  parseAiSeoBundle,
  parseAiSuggestions,
} from '@/make/woocommerce/WooCommercePage';
import type { WooFilter, WooMakeState, WooListItem } from '@/make/woocommerce/useWooMakeState';
import { filesFromDataTransfer, PHOTO_ACCEPT_ATTR, PHOTO_MAX_SIZE_MB } from '@/make/woocommerce/photoUpload';
import { WooCatalogPanel } from '@/make/woocommerce/WooCatalogPanel';
import { WooCategoryPicker } from '@/make/woocommerce/WooCategoryPicker';
import { WooPhotoThumb } from '@/make/woocommerce/WooPhotoThumb';
import { ModernWooProductWizard } from './ModernWooProductWizard';

type ModernWooCommercePageProps = { state: WooMakeState };
type DetailTab = 'overview' | 'photos' | 'ai' | 'publish' | 'history';

const PRODUCT_PAGE_SIZE = 25;
const filterLabels: Record<WooFilter, string> = {
  all: 'Tümü',
  published: 'Yayında',
  draft: 'Taslak',
  unpublished: 'Yayınlanmadı',
};

function money(value: string | number | null | undefined) {
  return value === null || value === undefined || value === '' ? '—' : formatMoney(value);
}

function badgeTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'Yayında' || status === 'Satışta') return 'success';
  if (status === 'Taslak' || status === 'Hazır') return 'warning';
  if (status === 'Satıldı' || status === 'Yayından Kaldırıldı') return 'danger';
  return 'neutral';
}

function ReadinessRow({ label, ready, detail }: { label: string; ready: boolean; detail?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-sg-border-soft py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-sg-text">{label}</p>
        {detail ? <p className="mt-1 text-xs leading-5 text-sg-text-soft">{detail}</p> : null}
      </div>
      <ModernBadge tone={ready ? 'success' : 'warning'}>{ready ? 'Hazır' : 'Eksik'}</ModernBadge>
    </div>
  );
}

function ProductRow({
  item,
  selected,
  onSelect,
}: {
  item: WooListItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${item.urunNo} ${item.urun}`}
      onClick={onSelect}
      className={`group grid w-full gap-3 border-b border-sg-border-soft px-4 py-3 text-left transition hover:bg-sg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sg-accent sm:grid-cols-[minmax(180px,1.5fr)_minmax(110px,0.8fr)_minmax(120px,0.9fr)_minmax(100px,0.8fr)_auto] ${selected ? 'bg-sg-accent-soft/45 shadow-[inset_3px_0_0_var(--sg-accent)]' : ''}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 shrink-0 text-sg-accent" />
          <p className="truncate text-sm font-semibold text-sg-text">{item.urun || item.urunNo}</p>
          {item.depoStokId ? <Link2 className="h-3.5 w-3.5 shrink-0 text-sg-amber" aria-label="Depo bağlantılı" /> : null}
        </div>
        <p className="mt-1 truncate pl-6 text-xs text-sg-text-soft">#{item.urunNo} · {item.stokNo || 'Stok no yok'}</p>
      </div>
      <div className="pl-6 sm:pl-0">
        <p className="text-xs font-medium text-sg-text">{item.metal} · {item.tip}</p>
        <p className="mt-1 text-xs text-sg-text-soft">{item.ayar} ‰ · {formatNumber(item.agirlik, ' g')}</p>
      </div>
      <div className="pl-6 sm:pl-0">
        <p className="text-xs text-sg-text-soft">Alış {money(item.alimFiyati)}</p>
        <p className="mt-1 text-xs font-semibold text-sg-text">Shop {money(item.shopFiyati)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1 pl-6 sm:pl-0">
        <ModernBadge tone={badgeTone(item.wooYayin)}>{item.wooYayin}</ModernBadge>
        {!item.hasPhoto ? <ModernBadge tone="danger">Foto yok</ModernBadge> : null}
        {!item.aiOnaylandi ? <ModernBadge tone="warning">AI bek.</ModernBadge> : null}
      </div>
      <ChevronRight className={`hidden h-4 w-4 self-center text-sg-text-soft transition-transform group-hover:translate-x-0.5 sm:block ${selected ? 'text-sg-accent' : ''}`} />
    </button>
  );
}

function ProductList({ state }: { state: WooMakeState }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(state.urunler.length / PRODUCT_PAGE_SIZE));
  const visibleItems = state.urunler.slice(page * PRODUCT_PAGE_SIZE, (page + 1) * PRODUCT_PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [state.filter, state.search]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  return (
    <ModernSection className="min-w-0 overflow-hidden p-0">
      <div className="border-b border-sg-border-soft px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent">Product master</p>
            <h2 className="mt-1 text-base font-semibold text-sg-text">Ürün listesi</h2>
          </div>
          <ModernBadge tone="neutral">{state.workspaceSummary.total_products} gerçek ürün</ModernBadge>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sg-text-soft" />
            <ModernTextInput
              aria-label="Woo ürünlerinde ara"
              value={state.search}
              onChange={(event) => state.setSearch(event.target.value)}
              placeholder="Ürün no, ad veya stok no ara"
              className="pl-9"
            />
          </label>
          <select
            aria-label="Yayın filtresi"
            value={state.filter}
            onChange={(event) => state.setFilter(event.target.value as WooFilter)}
            className="min-h-10 rounded-sg-md border border-sg-border bg-sg-surface px-3 text-sm text-sg-text outline-none focus:border-sg-accent focus:ring-2 focus:ring-sg-accent-soft"
          >
            {(Object.keys(filterLabels) as WooFilter[]).map((key) => <option key={key} value={key}>{filterLabels[key]}</option>)}
          </select>
        </div>
      </div>

      <div className="hidden grid-cols-[minmax(180px,1.5fr)_minmax(110px,0.8fr)_minmax(120px,0.9fr)_minmax(100px,0.8fr)_auto] gap-3 border-b border-sg-border-soft bg-sg-surface-soft px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sg-text-soft sm:grid sm:px-5">
        <span>Ürün</span><span>Metal / özellik</span><span>Fiyat</span><span>Yayın / eksik</span><span />
      </div>

      {state.loadingWorkspace ? <ModernLoadingState title="Ürün listesi hazırlanıyor" description="Gerçek depo ürünleri yükleniyor." /> : null}
      {!state.loadingWorkspace && state.urunler.length === 0 ? (
        <ModernEmptyState title="Ürün bulunamadı" description={state.search ? 'Arama veya filtreye uyan ürün yok.' : 'Woo çalışma alanında ürün satırı dönmedi.'} />
      ) : null}
      {!state.loadingWorkspace && state.urunler.length > 0 ? (
        <div>
          {visibleItems.map((item) => <ProductRow key={item.id} item={item} selected={item.id === state.secilenId} onSelect={() => state.setSecilenId(item.id)} />)}
        </div>
      ) : null}

      {state.urunler.length > PRODUCT_PAGE_SIZE ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sg-border-soft px-4 py-3 text-xs text-sg-text-soft sm:px-5">
          <span>Ürünler {page * PRODUCT_PAGE_SIZE + 1}–{Math.min((page + 1) * PRODUCT_PAGE_SIZE, state.urunler.length)} / {state.urunler.length}</span>
          <div className="flex items-center gap-2">
            <ModernButton size="sm" tone="ghost" icon={ChevronLeft} disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Önceki</ModernButton>
            <span aria-live="polite" className="min-w-20 text-center font-semibold text-sg-text">Sayfa {page + 1} / {pageCount}</span>
            <ModernButton size="sm" tone="ghost" trailingIcon={ChevronRight} disabled={page >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Sonraki</ModernButton>
          </div>
        </div>
      ) : null}
    </ModernSection>
  );
}

function DetailHeader({ state }: { state: WooMakeState }) {
  const item = state.secilen;
  const detail = state.detail;
  if (!item) return null;
  return (
    <div className="flex flex-col gap-4 border-b border-sg-border-soft pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent">Seçili ürün</p>
          <ModernBadge tone={badgeTone(detail?.is_published_to_site ? 'Yayında' : item.wooYayin)}>{detail?.is_published_to_site ? 'Yayında' : item.wooYayin}</ModernBadge>
          {detail?.woocommerce_product_id ? <ModernBadge tone="info">Woo ID {detail.woocommerce_product_id}</ModernBadge> : null}
        </div>
        <h2 className="mt-1 truncate text-lg font-semibold tracking-[-0.01em] text-sg-text">{detail?.display_name || item.urun || item.urunNo}</h2>
        <p className="mt-1 text-sm text-sg-text-soft">#{item.urunNo} · {item.metal} · {item.tip} · {formatNumber(detail?.weight_grams || item.agirlik, ' g')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <ModernButton size="sm" tone="ghost" icon={RefreshCw} disabled={!detail || state.isSyncing} onClick={state.syncSale}>Satış kontrolü</ModernButton>
        <ModernButton size="sm" tone="warning" icon={ShieldCheck} disabled={!detail?.manual_review_required || state.isApprovingReview} onClick={state.approveManualReview}>Manuel inceleme onayı</ModernButton>
      </div>
    </div>
  );
}

function OverviewTab({ state, seoMissing }: { state: WooMakeState; seoMissing: string[] }) {
  const detail = state.detail;
  const item = state.secilen;
  if (!detail || !item) return <ModernLoadingState title="Ürün detayı hazırlanıyor" />;
  const readiness = [
    { label: 'Ürün adı', ready: Boolean(detail.display_name?.trim()) },
    { label: 'Fotoğraf', ready: detail.photos.length > 0, detail: `${detail.photos.length} görsel` },
    { label: 'AI açıklaması', ready: Boolean(detail.ai_description?.trim()) },
    { label: 'AI onayı', ready: detail.ai_description_approved },
    { label: 'SEO paketi', ready: seoMissing.length === 0, detail: seoMissing.length ? `Eksik: ${seoMissing.join(', ')}` : undefined },
    { label: 'Manuel review', ready: !detail.manual_review_required, detail: detail.manual_review_reasons?.join(' · ') },
    { label: 'GDPR', ready: true, detail: detail.is_gdpr_locked ? '14 günlük süre devam ediyor (bilgi — yayını engellemez)' : undefined },
    { label: 'Shop fiyatı', ready: Number(state.publishPrice || 0) > 0, detail: money(state.publishPrice) },
  ];
  return (
    <div className="space-y-5">
      {detail.manual_review_required ? <ModernNotice tone="warning" title="Manuel review gerekiyor" description={detail.manual_review_reasons?.join(' · ') || 'Yayın öncesi ürün incelemesini tamamlayın.'} icon={<Info className="h-5 w-5" />} /> : null}
      <ModernKeyValueList columns={2} items={[
        { label: 'Metal / tip', value: `${item.metal} · ${item.tip}`, accent: true },
        { label: 'Ağırlık', value: formatNumber(detail.weight_grams || item.agirlik, ' g'), accent: true },
        { label: 'Ayar', value: detail.purity_percentage ? `${Math.round(Number(detail.purity_percentage) * 10)} ‰` : `${item.ayar} ‰` },
        { label: 'Saf metal', value: formatNumber(detail.pure_gold_grams || item.safMetal, ' g') },
        { label: 'Alış fiyatı', value: money(detail.purchase_price_dkk), accent: true },
        { label: 'Shop fiyatı', value: money(detail.shop_price_dkk), accent: true },
        { label: 'Satıcı', value: detail.seller_name || item.satici || '—' },
        { label: 'Ref / stok no', value: detail.reference_number || item.stokNo || '—' },
        { label: 'Stok durumu', value: detail.status },
        { label: 'GDPR', value: detail.is_gdpr_locked ? 'Kilitli' : 'Açık' },
      ]} />
      <ModernCard>
        <div className="flex items-center gap-2 border-b border-sg-border-soft pb-3"><CheckCircle2 className="h-4 w-4 text-sg-green" /><h3 className="text-sm font-semibold text-sg-text">Yayın hazırlığı</h3></div>
        <div className="mt-1">{readiness.map((entry) => <ReadinessRow key={entry.label} {...entry} />)}</div>
      </ModernCard>
    </div>
  );
}

export function PhotosTab({ state }: { state: WooMakeState }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const detail = state.detail;
  if (!detail) return <ModernLoadingState title="Fotoğraflar hazırlanıyor" />;
  const photos = detail.photos.filter((photo, index, all) => {
    const identity = photo.id || photo.original_url || photo.url || `${photo.filename || 'photo'}:${index}`;
    return all.findIndex((candidate) => (candidate.id || candidate.original_url || candidate.url || `${candidate.filename || 'photo'}:${all.indexOf(candidate)}`) === identity) === index;
  });
  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (files.length) state.uploadPhotos(files);
    event.target.value = '';
  }
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length) state.uploadPhotos(files);
  }
  return (
    <div
      data-testid="woo-photo-dropzone"
      onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
      onDragLeave={(event) => { if (event.currentTarget === event.target || !event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
      onDrop={handleDrop}
      className={`space-y-4 rounded-sg-lg transition ${dragActive ? 'ring-2 ring-sg-accent ring-offset-2 bg-sg-surface-accent/40' : ''}`}
    >
      {dragActive ? (
        <div className="rounded-sg-md border-2 border-dashed border-sg-accent bg-sg-surface-accent/60 px-4 py-6 text-center text-sm font-semibold text-sg-accent-dark">
          Fotoğrafları buraya bırakın
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-semibold text-sg-text">Ürün fotoğrafları</h3><p className="mt-1 text-sm text-sg-text-soft">Siteye AVIF olarak gönderilir (yedek format da hazır tutulur). JPG, PNG, WEBP, HEIC (iPhone) — en çok {PHOTO_MAX_SIZE_MB} MB. Tıklayarak seçin veya sürükleyip bırakın.</p></div><ModernButton tone="primary" icon={Upload} disabled={state.isUploadingPhotos} onClick={() => inputRef.current?.click()}>{state.isUploadingPhotos ? 'Yükleniyor…' : 'Fotoğraf yükle'}</ModernButton></div>
      <input ref={inputRef} type="file" multiple accept={PHOTO_ACCEPT_ATTR} className="hidden" onChange={handleFiles} />
      {photos.length === 0 ? <ModernEmptyState title="Fotoğraf yok" description="Yayın için en az bir fotoğraf yükleyin." action={<ModernButton tone="primary" icon={Upload} onClick={() => inputRef.current?.click()}>İlk fotoğrafı yükle</ModernButton>} /> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{photos.map((photo, index) => <div key={`${photo.id || photo.original_url || photo.url || photo.filename || 'photo'}:${index}`} className="group overflow-hidden rounded-sg-md border border-sg-border bg-sg-surface"><div className="relative aspect-square bg-sg-surface-soft"><WooPhotoThumb photo={photo} alt={detail.display_name || 'Ürün fotoğrafı'} className="h-full w-full object-cover" />{photo.is_primary || index === 0 ? <ModernBadge tone="warning" className="absolute left-2 top-2">Birincil</ModernBadge> : null}<div className="absolute inset-0 flex items-center justify-center gap-2 bg-sg-text/35 opacity-0 transition group-hover:opacity-100"><ModernButton aria-label="Fotoğrafı aç" size="sm" tone="ghost" icon={Eye} onClick={() => void openExternalUrl(buildMediaUrl(photo.original_url || photo.url))}>Aç</ModernButton>{photo.id ? <ModernButton aria-label="Fotoğrafı sil" size="sm" tone="danger" icon={Trash2} disabled={state.isDeletingPhoto} onClick={() => { if (window.confirm('Bu fotoğraf silinsin mi?')) state.deletePhoto(photo.id!); }}>Sil</ModernButton> : null}</div></div><p className="truncate px-3 py-2 text-xs text-sg-text-soft">{photo.filename || 'Fotoğraf'}</p></div>)}</div>}
    </div>
  );
}

function AiTab({ state, seoMissing }: { state: WooMakeState; seoMissing: string[] }) {
  const detail = state.detail;
  const aiDraft = state.aiDraft || '';
  const seo = parseAiSeoBundle(aiDraft || detail?.ai_description);
  if (!detail) return <ModernLoadingState title="AI çalışma alanı hazırlanıyor" />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2"><ModernButton tone="info" icon={Bot} disabled={state.isGeneratingAi} onClick={state.generateAi}>{state.isGeneratingAi ? 'Üretiliyor…' : 'AI açıklama üret'}</ModernButton><ModernButton tone="ghost" icon={Check} disabled={aiDraft.trim().length < 10 || state.isSavingAi} onClick={() => state.saveAi(false)}>Kaydet</ModernButton><ModernButton tone="success" icon={CheckCircle2} disabled={aiDraft.trim().length < 10 || state.isSavingAi} onClick={() => state.saveAi(true)}>Onayla</ModernButton></div>
      <label className="block"><span className="mb-2 block text-sm font-semibold text-sg-text">Danca ürün açıklaması</span><ModernTextarea aria-label="AI açıklaması" value={aiDraft} onChange={(event) => state.setAiDraft(event.target.value)} placeholder="AI açıklaması…" rows={7} /></label>
      <ModernCard><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-sg-text">SEO paket kontrolü</h3><p className="mt-1 text-xs text-sg-text-soft">Yayın için zorunlu alanlar açıklama metninden okunur.</p></div><ModernBadge tone={seoMissing.length ? 'warning' : 'success'}>{seoMissing.length ? `${seoMissing.length} eksik` : 'Tam'}</ModernBadge></div><div className="mt-4 space-y-3">{Object.entries({ 'SEO title': seo.title, 'URL slug': seo.slug, 'Kısa açıklama': seo.kisaAciklama, 'Meta description': seo.meta, 'Uzun açıklama': seo.uzunAciklama }).map(([label, value]) => <div key={label} className="border-b border-sg-border-soft pb-3 last:border-b-0"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sg-text-soft">{label}</p><p className={`mt-1 text-sm ${value ? 'text-sg-text' : 'text-sg-red'}`}>{value || 'Eksik'}</p></div>)}</div></ModernCard>
    </div>
  );
}

function specStripPreview(detail: WooMakeState['detail']): string {
  if (!detail) return '';
  const ref = (detail.reference_number || detail.product_number || '').trim();
  if (!ref) return '';
  const dims: string[] = [];
  if (detail.length_cm) dims.push(`Længde: ${String(detail.length_cm).trim()}`);
  if (detail.width_mm != null) dims.push(`Bredde: ${String(detail.width_mm).replace('.', ',')}mm`);
  if (detail.thickness_mm != null) dims.push(`Tykkelse: ${String(detail.thickness_mm).replace('.', ',')}mm`);
  if (detail.diameter_mm != null) dims.push(`Diameter: ${String(detail.diameter_mm).replace('.', ',')}mm`);
  const base = `Vare nr. : ${ref}`;
  return dims.length ? `${base} ${dims.join(', ')}` : base;
}

// R1-10: yayın öncesi şablon önizleme yanıtı (backend publish-preview).
type PublishPreviewData = {
  name: string | null;
  slug: string | null;
  regular_price: string | null;
  sku: string | null;
  categories: { id: number }[];
  short_description: string | null;
  description: string | null;
  attributes: { name?: string; options?: string[] }[];
  warnings: string[];
};

type WooSpotRates = { gold_24k_dkk?: string; silver_dkk?: string };

function PublishTab({ state, seoMissing }: { state: WooMakeState; seoMissing: string[] }) {
  // Hooks erken dönüşten ÖNCE gelmeli.
  const toast = useToast();
  const [publishPreview, setPublishPreview] = useState<PublishPreviewData | null>(null);
  // Woo otomatik fiyat önizlemesi: canlı WP priser kaynağı (tek kaynak).
  const [wooSpotRates, setWooSpotRates] = useState<WooSpotRates | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiRequest<WooSpotRates>('/api/v2/market-rates/defaults')
      .then((data) => {
        if (!cancelled) setWooSpotRates(data);
      })
      .catch(() => {
        // Sessiz: önizleme "oran yok" durumuna düşer, uydurma fiyat yok.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const detail = state.detail;
  const wooPricePreview = useMemo(() => {
    if (!wooSpotRates || !detail) return null;
    const rate = detail.metal_type === 'silver' ? Number(wooSpotRates.silver_dkk || '0') : Number(wooSpotRates.gold_24k_dkk || '0');
    const weight = Number(detail.weight_grams || '0');
    const purity = (Number(detail.purity_percentage || '0') || 0) / 100;
    const markup = (Number(state.publishMarkupRate || '0') || 0) / 100;
    if (!rate || weight <= 0 || purity <= 0) return null;
    return rate * weight * purity * (1 + markup);
  }, [detail, state.publishMarkupRate, wooSpotRates]);
  if (!detail) return <ModernLoadingState title="Yayın alanı hazırlanıyor" />;
  const ready = isPublishReady(detail) && seoMissing.length === 0 && Number(state.publishPrice || 0) > 0;
  const suggestions = parseAiSuggestions(state.aiDraft || detail.ai_description);
  const hasSuggestions = Boolean(suggestions.producer || suggestions.stone || suggestions.subtype);
  const specPreview = specStripPreview(detail);
  return (
    <div className="space-y-5">
      <ModernSectionHeader title="WooCommerce yayını" description="Yayın için fotoğraf, AI onayı, SEO alanları ve fiyat kontrol edilir." />

      {hasSuggestions ? (
        <ModernCard>
          <div className="flex items-start gap-3">
            <Bot className="mt-0.5 h-5 w-5 text-sg-accent" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-sg-text">AI'ın fotoğraftan okudukları (öneri)</h3>
              <p className="mt-1 text-xs text-sg-text-soft">Bunlar öneridir — doğrulayıp ürünün Depolama alanlarına (üretici, tip) girin. Ölçüler fiziksel ölçümdür, AI önermez.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestions.producer ? <ModernBadge tone="info">Üretici: {suggestions.producer}</ModernBadge> : null}
                {suggestions.stone ? <ModernBadge tone="info">Taş: {suggestions.stone}</ModernBadge> : null}
                {suggestions.subtype ? <ModernBadge tone="info">Tip: {suggestions.subtype}</ModernBadge> : null}
              </div>
            </div>
          </div>
        </ModernCard>
      ) : null}

      {specPreview ? (
        <ModernCard>
          <h3 className="text-sm font-semibold text-sg-text">Spec şeridi önizleme (sitede böyle görünecek)</h3>
          <div className="mt-2 rounded-sg-md border border-sg-green/30 bg-sg-green-soft px-3 py-2 text-sm text-sg-green-strong">✓ {specPreview}</div>
        </ModernCard>
      ) : null}

      <div className="flex flex-wrap gap-4">
        <label className="block"><span className="mb-2 block text-sm font-semibold text-sg-text">Yayın şablonu (WP yerleşimi)</span>
          <select value={state.publishProfile} onChange={(event) => state.setPublishProfile(event.target.value)} className="rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none">
            <option value="jewelry">Smykke (takı)</option>
            <option value="bar">Barre (külçe · yatırım)</option>
            <option value="coin">Mønt (sikke)</option>
            <option value="platinum">Platin / Palladium</option>
          </select>
          <span className="mt-1 block text-xs text-sg-text-soft">Yderligere information + açıklama bloğu bu şablona göre üretilir.</span>
        </label>
        {state.publishProfile === 'coin' ? (
          <label className="block"><span className="mb-2 block text-sm font-semibold text-sg-text">Årstal (üretim yılı){suggestions.year ? <span className="ml-1 text-sg-accent">· AI: {suggestions.year}</span> : null}</span>
            <ModernTextInput inputMode="numeric" type="number" min="0" placeholder={suggestions.year || 'örn. 2024'} value={state.publishYear} onChange={(event) => state.setPublishYear(event.target.value)} />
          </label>
        ) : null}
      </div>
      <label className="block max-w-sm"><span className="mb-2 block text-sm font-semibold text-sg-text">Shop fiyatı (DKK)</span><ModernTextInput inputMode="decimal" type="number" min="0" step="0.01" value={state.publishPrice} onChange={(event) => state.setPublishPrice(event.target.value)} /></label>
      <div className="max-w-md space-y-3 rounded-sg-md border border-sky-200 bg-sky-50 p-4">
        <div><p className="text-sm font-semibold text-sg-text">Woo otomatik fiyat</p><p className="mt-1 text-xs text-sg-text-soft">Markup girilince fiyat hesaplanır; yayında WP canlı altın fiyatıyla güncellemeye devam eder.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="mb-2 block text-sm font-semibold text-sg-text">Markup (%)</span><ModernTextInput inputMode="decimal" type="number" min="0" step="0.01" value={state.publishMarkupRate} onChange={(event) => state.setPublishMarkupRate(event.target.value)} /></label>
          <label className="block"><span className="mb-2 block text-sm font-semibold text-sg-text">Min fiyat (DKK, opsiyonel)</span><ModernTextInput inputMode="decimal" type="number" min="0" step="0.01" value={state.publishMinPrice} onChange={(event) => state.setPublishMinPrice(event.target.value)} /></label>
        </div>
        {wooPricePreview != null ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-sg-md border border-sg-green/30 bg-sg-green-soft px-3 py-2">
            <p className="text-sm font-semibold text-sg-green-strong">Önizleme: {formatMoney(wooPricePreview)} <span className="font-normal text-sg-text-soft">= canlı spot × ağırlık × saflık × (1 + markup)</span></p>
            <ModernButton size="sm" tone="info" onClick={() => state.setPublishPrice(wooPricePreview.toFixed(2))}>Fiyata uygula</ModernButton>
          </div>
        ) : (
          <p className="text-xs text-sg-text-soft">Fiyat önizlemesi için markup girin (saflık/ağırlık ürün girdilerinden gelir).</p>
        )}
      </div>
      <label className="flex max-w-sm items-center gap-2 text-sm text-sg-text">
        <input type="checkbox" checked={state.publishNewBadge} onChange={(event) => state.setPublishNewBadge(event.target.checked)} className="h-4 w-4 accent-sg-green-strong" />
        Nyhed-rozet (yeni ürün · 30 gün)
      </label>
      <div className="max-w-xl">
        <p className="mb-2 text-sm font-semibold text-sg-text">WP'de hangi grup(lar)a yayınlansın?</p>
        <WooCategoryPicker
          categories={state.categories}
          selectedIds={state.publishCategoryIds}
          onToggle={state.togglePublishCategory}
          onMakePrimary={(id) => state.setPublishCategoryIds([id, ...state.publishCategoryIds.filter((value) => value !== id)])}
          onRefresh={() => void state.refreshCategories()}
          loading={state.categoriesLoading}
          error={state.categoriesError}
          variant="modern"
        />
      </div>
      <ModernNotice tone={ready ? 'success' : 'warning'} title={ready ? 'Yayın için hazır' : 'Yayın ön koşulları eksik'} description={ready ? 'Ürün yayınlanabilir. Harici WooCommerce yazması için onay verin.' : 'Fotoğraf, AI onayı, SEO, manuel review ve fiyat alanlarını tamamlayın.'} icon={ready ? <CheckCircle2 className="h-5 w-5" /> : <Info className="h-5 w-5" />} />
      <div className="flex flex-wrap gap-2">
        <ModernButton tone="success" icon={Globe} disabled={!ready || state.isPublishing} onClick={state.publish}>
          {state.isPublishing ? 'Yayınlanıyor…' : 'Siteye yayınla'}
        </ModernButton>
        <ModernButton
          tone="ghost"
          icon={Eye}
          onClick={() => {
            // R1-10: yayın öncesi şablon önizleme — panelin güncel (kaydedilmemiş
            // dahil) durumuyla; saf payload, Woo'ya istek atılmaz.
            void (async () => {
              try {
                const preview = await state.fetchPublishPreview();
                if (preview) setPublishPreview(preview);
                else toast.error('Önizleme alınamadı');
              } catch (error) {
                toast.error('Önizleme alınamadı', localizeApiError(error));
              }
            })();
          }}
        >
          Önizleme
        </ModernButton>
        {detail.is_published_to_site ? (
          <ModernButton
            tone="danger"
            icon={X}
            disabled={state.isUnpublishing}
            onClick={() => {
              if (window.confirm('Ürün WooCommerce’den kaldırılsın mı?')) state.unpublish();
            }}
          >
            {state.isUnpublishing ? 'Kaldırılıyor…' : 'Yayından kaldır'}
          </ModernButton>
        ) : null}
      </div>

      {publishPreview ? (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/40 p-6" onClick={() => setPublishPreview(null)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-sg-lg border border-sg-border bg-sg-surface shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-sg-border px-5 py-3">
              <p className="text-sm font-semibold text-sg-text">Yayın önizlemesi — sitede böyle görünecek</p>
              <ModernButton tone="ghost" size="sm" icon={X} onClick={() => setPublishPreview(null)}>Kapat</ModernButton>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-sg-text">{publishPreview.name || '—'}</h3>
                <p className="text-xs text-sg-text-soft">
                  /{publishPreview.slug || ''} · SKU: {publishPreview.sku || '—'} · {publishPreview.regular_price || '—'} DKK
                  {publishPreview.categories.length ? ` · ${publishPreview.categories.length} kategori` : ' · kategori yok'}
                </p>
              </div>
              {publishPreview.warnings.length ? (
                <div className="space-y-1 rounded-sg-md border border-amber-200 bg-amber-50 px-3 py-2">
                  {publishPreview.warnings.map((warning, index) => (
                    <p key={index} className="text-xs text-amber-700">⚠ {warning}</p>
                  ))}
                </div>
              ) : null}
              <div>
                <p className="mb-1 text-xs font-semibold text-sg-text-soft">Kısa açıklama</p>
                <div className="prose prose-sm max-w-none rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3 text-sm text-sg-text" dangerouslySetInnerHTML={{ __html: publishPreview.short_description || '<p>—</p>' }} />
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-sg-text-soft">Uzun açıklama</p>
                <div className="prose prose-sm max-w-none rounded-sg-md border border-sg-border px-4 py-3 text-sm text-sg-text" dangerouslySetInnerHTML={{ __html: publishPreview.description || '<p>—</p>' }} />
              </div>
              {publishPreview.attributes.length ? (
                <div>
                  <p className="mb-1 text-xs font-semibold text-sg-text-soft">Yderligere information</p>
                  <table className="w-full rounded-sg-md border border-sg-border text-sm">
                    <tbody>
                      {publishPreview.attributes.map((attribute, index) => (
                        <tr key={index} className={index % 2 ? 'bg-sg-surface-soft' : ''}>
                          <td className="border-b border-sg-border px-3 py-1.5 font-semibold text-sg-text">{attribute.name || '—'}</td>
                          <td className="border-b border-sg-border px-3 py-1.5 text-sg-text">{(attribute.options || []).join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HistoryTab({ state }: { state: WooMakeState }) {
  return (
    <div className="space-y-5">
      <div><div className="flex items-center gap-2"><History className="h-4 w-4 text-sg-accent" /><h3 className="text-sm font-semibold text-sg-text">Ürün geçmişi</h3></div><div className="mt-3 space-y-2">{state.history.length ? state.history.map((entry) => <ModernCard key={entry.id} className="p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-sg-text">{entry.action}</p><time className="text-xs text-sg-text-soft">{formatDate(entry.created_at)}</time></div>{entry.notes ? <p className="mt-1 text-xs text-sg-text-soft">{entry.notes}</p> : null}</ModernCard>) : <p className="text-sm text-sg-text-soft">Geçmiş kaydı yok.</p>}</div></div>
      <div><div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-sg-accent" /><h3 className="text-sm font-semibold text-sg-text">Woo sync log</h3></div><div className="mt-3 space-y-2">{state.syncLog.length ? state.syncLog.map((entry) => <ModernCard key={entry.id} className="p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-sg-text">{entry.action}</p><ModernBadge tone={entry.status === 'success' || entry.status === 'synced' ? 'success' : entry.status === 'failed' ? 'danger' : 'warning'}>{entry.status}</ModernBadge></div><p className="mt-1 text-xs text-sg-text-soft">{entry.error_message || formatDate(entry.created_at)}</p></ModernCard>) : <p className="text-sm text-sg-text-soft">Sync kaydı yok.</p>}</div></div>
      <div><ModernButton tone="ghost" size="sm" icon={Eye} onClick={() => state.setRawOpen((current) => !current)}>{state.rawOpen ? 'Woo raw gizle' : 'Woo raw aç'}</ModernButton>{state.rawOpen ? <pre className="mt-3 max-h-80 overflow-auto rounded-sg-md bg-sg-text p-4 text-xs text-white">{JSON.stringify(state.rawData?.summary || state.rawData?.raw || {}, null, 2)}</pre> : null}</div>
    </div>
  );
}

function ProductWorkspace({ state }: { state: WooMakeState }) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const detail = state.detail;
  const seoMissing = useMemo(() => missingSeoFields(parseAiSeoBundle(state.aiDraft || detail?.ai_description)), [state.aiDraft, detail?.ai_description]);
  if (!state.secilen) return <ModernEmptyState title="Ürün seçin" description="Soldan bir ürün seçtiğinizde operasyon ayrıntıları burada açılır." />;
  if (state.loadingDetail && !detail) return <ModernLoadingState title="Ürün detayı hazırlanıyor" description="ProductOut ve geçmiş kayıtları bekleniyor." />;
  if (state.detailError && !detail) return <ModernErrorState title="Ürün detayı açılamadı" description={state.detailError} onRetry={state.refreshWorkspace} />;
  const tabs: Array<{ id: DetailTab; label: string; icon: typeof Package }> = [{ id: 'overview', label: 'Genel', icon: Package }, { id: 'photos', label: 'Fotoğraf', icon: ImageIcon }, { id: 'ai', label: 'AI & SEO', icon: Bot }, { id: 'publish', label: 'Yayın', icon: Globe }, { id: 'history', label: 'Geçmiş', icon: History }];
  return (
    <ModernSection className="min-w-0 p-4 sm:p-5">
      <DetailHeader state={state} />
      <div className="mt-4 flex flex-wrap gap-1 border-b border-sg-border-soft pb-1">{tabs.map((entry) => <button key={entry.id} type="button" onClick={() => setTab(entry.id)} className={`inline-flex items-center gap-2 rounded-t-sg-md px-3 py-2 text-xs font-semibold transition ${tab === entry.id ? 'border-b-2 border-sg-accent bg-sg-accent-soft text-sg-accent-dark' : 'text-sg-text-soft hover:bg-sg-surface-soft'}`}><entry.icon className="h-3.5 w-3.5" />{entry.label}</button>)}</div>
      <div className="mt-5">{tab === 'overview' ? <OverviewTab state={state} seoMissing={seoMissing} /> : null}{tab === 'photos' ? <PhotosTab state={state} /> : null}{tab === 'ai' ? <AiTab state={state} seoMissing={seoMissing} /> : null}{tab === 'publish' ? <PublishTab state={state} seoMissing={seoMissing} /> : null}{tab === 'history' ? <HistoryTab state={state} /> : null}</div>
    </ModernSection>
  );
}

export function ModernWooCommercePage({ state }: ModernWooCommercePageProps) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [surface, setSurface] = useState<'catalog' | 'local'>('catalog');
  const summary = state.workspaceSummary;
  if (surface === 'catalog') {
    return (
      <ModernPage>
        <WooCatalogPanel state={state} mode="modern" onOpenLocalProducts={() => setSurface('local')} />
      </ModernPage>
    );
  }
  if (state.loadingWorkspace && state.urunler.length === 0) return <ModernPage><ModernLoadingState title="WooCommerce çalışma alanı hazırlanıyor" description="Gerçek ürün listesi ve durum özeti yükleniyor." /></ModernPage>;
  if (state.workspaceError && state.urunler.length === 0) return <ModernPage><ModernErrorState title="WooCommerce çalışma alanı açılamadı" description={state.workspaceError} onRetry={state.refreshWorkspace} /></ModernPage>;
  return (
    <ModernPage>
      <ModernToolbar
        leading={<div className="flex min-w-0 items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-sg-md bg-sg-accent-soft text-sg-accent"><Package className="h-5 w-5" /></div><div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent">WooCommerce / WordPress</p><h1 className="truncate text-lg font-semibold tracking-[-0.02em] text-sg-text">Ürün yayın çalışma alanı</h1></div></div>}
        trailing={<div className="flex flex-wrap items-center gap-2"><ModernBadge tone="neutral">{summary.total_products} ürün</ModernBadge><ModernBadge tone="success">{summary.published_products} yayında</ModernBadge><ModernBadge tone="warning">{summary.photo_pending_products} foto eksik</ModernBadge><ModernButton size="sm" tone="ghost" icon={Cloud} onClick={() => setSurface('catalog')}>Woo kataloğu</ModernButton><ModernButton size="sm" tone="ghost" icon={RefreshCw} disabled={state.loadingWorkspace} onClick={state.refreshWorkspace}>Yenile</ModernButton><ModernButton size="sm" tone="primary" icon={Plus} onClick={() => setWizardOpen(true)}>Yeni ürün</ModernButton></div>}
      />
      <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(480px,0.9fr)]"><ProductList state={state} /><ProductWorkspace state={state} /></div>
      <ModernWooProductWizard
        open={wizardOpen}
        stokList={state.stokList}
        urunler={state.urunler}
        pending={state.isCreatingProduct}
        onClose={() => setWizardOpen(false)}
        onSave={state.createProductFromDraft}
        categories={state.categories}
        categoriesLoading={state.categoriesLoading}
        categoriesError={state.categoriesError}
        onRefreshCategories={() => void state.refreshCategories()}
      />
    </ModernPage>
  );
}
