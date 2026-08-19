import { filesFromDataTransfer } from '@/make/woocommerce/photoUpload';
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Eye,
  FileText,
  ImagePlus,
  Search,
  Star,
  Trash2,
} from 'lucide-react';

import { formatMoney, formatNumber } from '@/lib/format';
import {
  ModernBadge,
  ModernButton,
  ModernCard,
  ModernCheckboxField,
  ModernDrawer,
  ModernField,
  ModernNotice,
  ModernTextInput,
  ModernTextarea,
} from '@/modern/design-system';
import { missingSeoFields, type SeoBundle } from '@/make/woocommerce/WooCommercePage';
import {
  buildDraftFromStock,
  defaultNewWooProductDraft,
  type DraftPhoto,
  type NewWooProductDraft,
  type StokItem,
  type WooCategory,
  type WooListItem,
} from '@/make/woocommerce/useWooMakeState';
import { WooCategoryPicker } from '@/make/woocommerce/WooCategoryPicker';
import type { ProductOut } from '@/types';

type WizardStep = 1 | 2 | 3 | 4;

const steps: Array<{ id: WizardStep; label: string }> = [
  { id: 1, label: 'Kaynak' },
  { id: 2, label: 'Bilgiler' },
  { id: 3, label: 'AI & SEO' },
  { id: 4, label: 'Fotoğraf & yayın' },
];

const selectClassName = 'min-h-10 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3.5 text-sm text-sg-text outline-none transition focus:border-sg-accent focus:ring-2 focus:ring-sg-accent-soft';

function stockCategoryLabel(item: StokItem) {
  if (item.mainKat === 'gumus' && item.gumusAlt) {
    return `Gümüş · ${item.gumusAlt === 'barrer' ? 'Barrer' : item.gumusAlt === 'monter' ? 'Mønter' : 'Smykker'}`;
  }
  if (item.mainKat === 'platin_pd' && item.platinAlt) return `Platin/Pd · ${item.platinAlt === 'palladyum' ? 'Palladyum' : 'Platin'}`;
  return { kulce: 'Külçe', sikke: 'Sikke', taki: 'Takı', gumus: 'Gümüş', platin_pd: 'Platin/Pd' }[item.mainKat];
}

function buildAiPreview(draft: NewWooProductDraft) {
  const metal = draft.metal === 'Altın' ? 'guld' : draft.metal === 'Gümüş' ? 'sølv' : draft.metal === 'Platin' ? 'platin' : 'palladium';
  const tip = draft.tip === 'Bar' ? 'barre' : draft.tip === 'Mønt' ? 'mønt' : draft.tip === 'Smykke' ? 'smykke' : 'produkt';
  const name = draft.urunAdi.trim() || `${draft.metal} ${draft.tip}`;
  return `${name} er et ${metal} ${tip} med vægt på ${Number(draft.agirlik || '0').toLocaleString('da-DK')} gram og finhed ${draft.ayar || '0'} ‰. ${draft.uretici.trim() ? `${draft.uretici.trim()} er registreret som producent. ` : ''}Produktet er klargjort til WooCommerce med fokus på tydelig metadata, præcis vægtangivelse og salgsklar præsentation hos Sero Guld.`.trim();
}

function slugify(value: string) {
  return value.toLocaleLowerCase('tr-TR').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function buildSeoPreview(draft: NewWooProductDraft, aiText: string): SeoBundle {
  const name = draft.urunAdi.trim() || `${draft.metal} ${draft.tip}`;
  return { title: `${name} | Sero Guld`, slug: slugify(name), kisaAciklama: aiText.slice(0, 160), meta: `Køb ${name} hos Sero Guld. Vægt ${draft.agirlik || '0'}g, finhed ${draft.ayar || '0'} ‰.`, uzunAciklama: `<p>${aiText}</p>` };
}

function validationError(draft: NewWooProductDraft, target: WizardStep) {
  if (target >= 2 && !draft.kaynak) return 'Kaynak seçimi zorunlu.';
  if (target >= 2 && draft.kaynak === 'depo' && !draft.secilenStokId) return 'Bir depo ürünü seçin.';
  if (target >= 3 && !draft.urunAdi.trim()) return 'Ürün adı zorunlu.';
  if (target >= 3 && (Number(draft.agirlik || '0') <= 0 || Number(draft.alimFiyati || '0') <= 0)) return 'Geçerli ağırlık ve alım fiyatı girin.';
  return null;
}

export function ModernWooProductWizard({
  open,
  stokList,
  urunler,
  pending,
  onClose,
  onSave,
  categories = [],
  categoriesLoading = false,
  categoriesError = null,
  onRefreshCategories,
}: {
  open: boolean;
  stokList: StokItem[];
  urunler: WooListItem[];
  pending: boolean;
  onClose: () => void;
  onSave: (draft: NewWooProductDraft) => Promise<ProductOut | null>;
  categories?: WooCategory[];
  categoriesLoading?: boolean;
  categoriesError?: string | null;
  onRefreshCategories?: () => void;
}) {
  const [step, setStep] = useState<WizardStep>(1);
  const [stockSearch, setStockSearch] = useState('');
  const [seoOpen, setSeoOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<NewWooProductDraft>(defaultNewWooProductDraft());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [photoDragActive, setPhotoDragActive] = useState(false);
  const photosRef = useRef<DraftPhoto[]>([]);

  useEffect(() => {
    photosRef.current = form.fotograflar;
  }, [form.fotograflar]);

  useEffect(() => () => {
    photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
  }, []);

  const linkedStockIds = useMemo(() => new Set(urunler.map((item) => item.depoStokId).filter(Boolean)), [urunler]);
  const filteredStock = useMemo(() => {
    const query = stockSearch.trim().toLocaleLowerCase('tr-TR');
    return stokList.filter((item) => !linkedStockIds.has(item.id) && (!query || [item.urun, item.stokNo || '', item.uretici || '', stockCategoryLabel(item)].join(' ').toLocaleLowerCase('tr-TR').includes(query)));
  }, [linkedStockIds, stockSearch, stokList]);
  const missingSeo = useMemo(() => missingSeoFields(form.seo as SeoBundle), [form.seo]);

  function patch(values: Partial<NewWooProductDraft>) {
    setForm((current) => ({ ...current, ...values }));
  }

  function goTo(target: WizardStep) {
    const nextError = validationError(form, target);
    setError(nextError);
    if (!nextError) setStep(target);
  }

  function selectStock(stock: StokItem) {
    patch({ ...buildDraftFromStock(stock), kaynak: 'depo' });
  }

  function addPhotoFiles(files: File[]) {
    if (!files.length) return;
    setForm((current) => ({
      ...current,
      fotograflar: [...current.fotograflar, ...files.map((file, index) => ({ id: `${file.name}-${file.size}-${Date.now()}-${index}`, name: file.name, url: URL.createObjectURL(file), file, birincil: current.fotograflar.length === 0 && index === 0 }))],
    }));
  }

  function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    addPhotoFiles(Array.from(event.target.files || []));
    event.target.value = '';
  }

  function removePhoto(id: string) {
    setForm((current) => {
      const photo = current.fotograflar.find((item) => item.id === id);
      if (photo) URL.revokeObjectURL(photo.url);
      return { ...current, fotograflar: current.fotograflar.filter((item) => item.id !== id) };
    });
  }

  async function submit() {
    const wantsPublish = form.wooYayin === 'Yayında';
    if (wantsPublish && (!form.aiOnaylandi || form.aiAciklama.trim().length < 10)) return setError('Yayına almadan önce AI açıklamasını üretip onaylayın.');
    if (wantsPublish && form.fotograflar.length === 0) return setError('Yayına almadan önce en az bir fotoğraf ekleyin.');
    if (wantsPublish && Number(form.satisHasJiyati || '0') <= 0) return setError('Yayına almadan önce geçerli shop fiyatı girin.');
    setError(null);
    try {
      const created = await onSave(form);
      if (created) onClose();
      else setError('Ürün oluşturulamadı. Lütfen tekrar deneyin.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Ürün oluşturulamadı. Lütfen tekrar deneyin.');
    }
  }

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <ModernButton tone="ghost" onClick={onClose}>Vazgeç</ModernButton>
      <div className="flex items-center gap-2">
        {step > 1 ? <ModernButton tone="ghost" icon={ChevronLeft} onClick={() => { setError(null); setStep((current) => (current - 1) as WizardStep); }}>Geri</ModernButton> : null}
        {step < 4 ? <ModernButton tone="primary" trailingIcon={ChevronRight} onClick={() => goTo((step + 1) as WizardStep)}>İleri</ModernButton> : <ModernButton tone="success" icon={CheckCircle2} disabled={pending} onClick={() => void submit()}>{pending ? 'Oluşturuluyor…' : 'Ürünü oluştur'}</ModernButton>}
      </div>
    </div>
  );

  return (
    <ModernDrawer open={open} onClose={onClose} title="Yeni ürün oluştur" description="Depo bağlantısı, ürün bilgileri, AI içeriği ve WooCommerce yayın ayarları." footer={footer}>
      <nav aria-label="Ürün oluşturma adımları" className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((item) => {
          const active = step === item.id;
          const done = step > item.id;
          return <button key={item.id} type="button" disabled={item.id > step} onClick={() => { setError(null); setStep(item.id); }} className={`flex items-center gap-2 rounded-sg-md border px-3 py-2.5 text-left text-xs font-semibold transition disabled:cursor-not-allowed ${active ? 'border-sg-accent bg-sg-accent-soft text-sg-accent-dark' : done ? 'border-sg-green/25 bg-sg-green-soft text-sg-green-strong hover:bg-sg-green-soft/70' : 'border-sg-border bg-sg-surface text-sg-text-soft'}`}><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${active ? 'bg-sg-accent text-white' : done ? 'bg-sg-green text-white' : 'bg-sg-surface-soft'}`}>{done ? <Check className="h-3 w-3" /> : item.id}</span><span>{item.label}</span></button>;
        })}
      </nav>

      {step === 1 ? <div className="space-y-5">
        <div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent">Adım 1</p><h4 className="mt-1 text-lg font-semibold text-sg-text">Ürün kaynağı</h4><p className="mt-1 text-sm text-sg-text-soft">Mevcut depodan bir kalem bağlayın veya ürünü manuel oluşturun.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => patch({ kaynak: 'depo' })} className={`rounded-sg-lg border p-5 text-left transition ${form.kaynak === 'depo' ? 'border-sg-accent bg-sg-accent-soft' : 'border-sg-border bg-sg-surface hover:bg-sg-surface-soft'}`}><Database className="h-5 w-5 text-sg-accent" /><p className="mt-4 text-sm font-semibold text-sg-text">Depodan seç</p><p className="mt-1 text-sm text-sg-text-soft">Mevcut stok kalemini Woo taslağına bağla.</p>{form.kaynak === 'depo' ? <ModernBadge tone="primary" className="mt-4">Seçildi</ModernBadge> : null}</button>
          <button type="button" onClick={() => patch({ kaynak: 'manuel', secilenStokId: null })} className={`rounded-sg-lg border p-5 text-left transition ${form.kaynak === 'manuel' ? 'border-sg-accent bg-sg-accent-soft' : 'border-sg-border bg-sg-surface hover:bg-sg-surface-soft'}`}><FileText className="h-5 w-5 text-sg-accent" /><p className="mt-4 text-sm font-semibold text-sg-text">Manuel gir</p><p className="mt-1 text-sm text-sg-text-soft">Woo için ürünü sıfırdan hazırlayın.</p>{form.kaynak === 'manuel' ? <ModernBadge tone="primary" className="mt-4">Seçildi</ModernBadge> : null}</button>
        </div>
        {form.kaynak === 'depo' ? <ModernCard className="overflow-hidden p-0"><div className="border-b border-sg-border-soft p-4"><label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sg-text-soft" /><ModernTextInput value={stockSearch} onChange={(event) => setStockSearch(event.target.value)} className="pl-9" placeholder="Stok no, ürün, üretici veya kategori ara" /></label></div><div className="max-h-[360px] overflow-auto">{filteredStock.map((item) => { const selected = form.secilenStokId === item.id; return <button key={item.id} type="button" onClick={() => selectStock(item)} className={`w-full border-b border-sg-border-soft px-4 py-3 text-left last:border-b-0 ${selected ? 'bg-sg-accent-soft' : 'hover:bg-sg-surface'}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-semibold text-sg-text">{item.stokNo || item.id.slice(0, 8)}</span><ModernBadge tone="neutral">{stockCategoryLabel(item)}</ModernBadge></div><p className="mt-2 text-sm font-semibold text-sg-text">{item.urun}</p><p className="mt-1 text-xs text-sg-text-soft">{formatNumber(item.birimGram, ' g')} · {item.adet} adet · {formatMoney(item.alisFiyati)}</p></div>{selected ? <CheckCircle2 className="h-5 w-5 shrink-0 text-sg-green" /> : null}</div></button>; })}{filteredStock.length === 0 ? <p className="px-4 py-10 text-center text-sm text-sg-text-soft">Bağlanabilir depo ürünü bulunamadı.</p> : null}</div></ModernCard> : null}
      </div> : null}

      {step === 2 ? <div className="space-y-5"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent">Adım 2</p><h4 className="mt-1 text-lg font-semibold text-sg-text">Ürün bilgileri</h4><p className="mt-1 text-sm text-sg-text-soft">Temel ürün, metal, fiyat ve satıcı alanlarını tamamlayın.</p></div><div className="grid gap-4 sm:grid-cols-2">
        <ModernField label="Ürün adı"><ModernTextInput value={form.urunAdi} onChange={(event) => patch({ urunAdi: event.target.value })} /></ModernField><ModernField label="Üretici"><ModernTextInput value={form.uretici} onChange={(event) => patch({ uretici: event.target.value })} /></ModernField>
        <ModernField label="Metal"><select className={selectClassName} value={form.metal} onChange={(event) => patch({ metal: event.target.value as NewWooProductDraft['metal'] })}>{['Altın', 'Gümüş', 'Platin', 'Palladyum'].map((value) => <option key={value}>{value}</option>)}</select></ModernField><ModernField label="Tip"><select className={selectClassName} value={form.tip} onChange={(event) => patch({ tip: event.target.value as NewWooProductDraft['tip'] })}>{['Bar', 'Mønt', 'Smykke'].map((value) => <option key={value}>{value}</option>)}</select></ModernField>
        <ModernField label="Ağırlık (g)"><ModernTextInput inputMode="decimal" value={form.agirlik} onChange={(event) => patch({ agirlik: event.target.value })} /></ModernField><ModernField label="Ayar / ‰"><ModernTextInput inputMode="numeric" value={form.ayar} onChange={(event) => patch({ ayar: event.target.value })} /></ModernField>
        <ModernField label="Alım fiyatı (DKK)"><ModernTextInput inputMode="decimal" value={form.alimFiyati} onChange={(event) => patch({ alimFiyati: event.target.value })} /></ModernField><ModernField label="Shop fiyatı (DKK)"><ModernTextInput inputMode="decimal" value={form.satisHasJiyati} onChange={(event) => patch({ satisHasJiyati: event.target.value })} /></ModernField>
        <ModernField label="Satıcı"><ModernTextInput value={form.satici} onChange={(event) => patch({ satici: event.target.value })} /></ModernField><ModernField label="Ref / stok no"><ModernTextInput value={form.stokNo} onChange={(event) => patch({ stokNo: event.target.value })} /></ModernField>
      </div><ModernField label="Notlar"><ModernTextarea rows={4} value={form.notlar} onChange={(event) => patch({ notlar: event.target.value })} /></ModernField></div> : null}

      {step === 3 ? <div className="space-y-5"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent">Adım 3</p><h4 className="mt-1 text-lg font-semibold text-sg-text">AI & SEO</h4><p className="mt-1 text-sm text-sg-text-soft">Danca ürün açıklamasını oluşturun, kontrol edin ve onaylayın.</p></div><div className="flex flex-wrap gap-2"><ModernButton tone="info" icon={Bot} onClick={() => { const text = buildAiPreview(form); patch({ aiAciklama: text, seo: buildSeoPreview(form, text) }); }}>AI açıklama üret</ModernButton></div><ModernCheckboxField label="Oluştururken AI açıklamasını onayla" description="Doğrudan yayın için AI açıklamasının onaylı olması gerekir." checked={form.aiOnaylandi} onChange={(checked) => patch({ aiOnaylandi: checked })} /><ModernField label="AI açıklaması"><ModernTextarea rows={7} value={form.aiAciklama} onChange={(event) => patch({ aiAciklama: event.target.value })} /></ModernField><ModernCard className="p-0"><button type="button" onClick={() => setSeoOpen((current) => !current)} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-sg-surface"><div><p className="text-sm font-semibold text-sg-text">SEO paket kontrolü</p><p className="mt-1 text-xs text-sg-text-soft">Yayın için tüm SEO alanlarını doldurun.</p></div><div className="flex items-center gap-2"><ModernBadge tone={missingSeo.length ? 'warning' : 'success'}>{missingSeo.length ? `${missingSeo.length} eksik` : 'Tam'}</ModernBadge><ChevronDown className={`h-4 w-4 text-sg-text-soft transition ${seoOpen ? 'rotate-180' : ''}`} /></div></button>{seoOpen ? <div className="grid gap-4 border-t border-sg-border-soft p-4"><ModernField label="SEO title"><ModernTextInput value={form.seo.title} onChange={(event) => patch({ seo: { ...form.seo, title: event.target.value } })} /></ModernField><ModernField label="URL slug"><ModernTextInput value={form.seo.slug} onChange={(event) => patch({ seo: { ...form.seo, slug: event.target.value } })} /></ModernField><ModernField label="Kısa açıklama"><ModernTextarea rows={2} value={form.seo.kisaAciklama} onChange={(event) => patch({ seo: { ...form.seo, kisaAciklama: event.target.value } })} /></ModernField><ModernField label="Meta description"><ModernTextarea rows={2} value={form.seo.meta} onChange={(event) => patch({ seo: { ...form.seo, meta: event.target.value } })} /></ModernField><ModernField label="Uzun açıklama"><ModernTextarea rows={4} value={form.seo.uzunAciklama} onChange={(event) => patch({ seo: { ...form.seo, uzunAciklama: event.target.value } })} /></ModernField></div> : null}</ModernCard></div> : null}

      {step === 4 ? <div className="space-y-5"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent">Adım 4</p><h4 className="mt-1 text-lg font-semibold text-sg-text">Fotoğraf & yayın</h4><p className="mt-1 text-sm text-sg-text-soft">Ürünü taslak olarak oluşturun veya yayın koşullarını tamamlayıp doğrudan yayınlayın.</p></div><div className="grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => patch({ wooYayin: 'Taslak' })} className={`rounded-sg-md border p-4 text-left ${form.wooYayin === 'Taslak' ? 'border-sg-accent bg-sg-accent-soft' : 'border-sg-border bg-sg-surface'}`}><p className="text-sm font-semibold text-sg-text">Taslak oluştur</p><p className="mt-1 text-xs text-sg-text-soft">Ürünü kaydet, yayın kararını daha sonra ver.</p></button><button type="button" onClick={() => patch({ wooYayin: 'Yayında', aiOnaylandi: true })} className={`rounded-sg-md border p-4 text-left ${form.wooYayin === 'Yayında' ? 'border-sg-green bg-sg-green-soft' : 'border-sg-border bg-sg-surface'}`}><p className="text-sm font-semibold text-sg-text">Oluşturunca yayınla</p><p className="mt-1 text-xs text-sg-text-soft">AI onayı, fotoğraf ve shop fiyatı gerekir.</p></button></div>{form.wooYayin === 'Yayında' ? <WooCategoryPicker categories={categories} selectedIds={form.kategoriIds} onToggle={(id) => patch({ kategoriIds: form.kategoriIds.includes(id) ? form.kategoriIds.filter((value) => value !== id) : [...form.kategoriIds, id] })} onRefresh={() => onRefreshCategories?.()} loading={categoriesLoading} error={categoriesError} variant="modern" /> : null}<div data-testid="wizard-photo-dropzone" onDragOver={(event) => { event.preventDefault(); setPhotoDragActive(true); }} onDragLeave={(event) => { if (event.currentTarget === event.target || !event.currentTarget.contains(event.relatedTarget as Node)) setPhotoDragActive(false); }} onDrop={(event) => { event.preventDefault(); setPhotoDragActive(false); addPhotoFiles(filesFromDataTransfer(event.dataTransfer)); }} className={`rounded-sg-md border-2 border-dashed p-3 transition ${photoDragActive ? 'border-sg-accent bg-sg-accent-soft' : 'border-sg-border'}`}><div className="flex flex-wrap items-center gap-3"><ModernButton tone="primary" icon={ImagePlus} onClick={() => fileInputRef.current?.click()}>Fotoğraf yükle</ModernButton><input ref={fileInputRef} type="file" multiple accept="image/*" className="hidden" onChange={addPhotos} /><span className="text-sm text-sg-text-soft">{photoDragActive ? 'Fotoğrafları buraya bırakın' : form.fotograflar.length ? `${form.fotograflar.length} fotoğraf eklendi` : 'Henüz fotoğraf eklenmedi · sürükleyip bırakabilirsiniz'}</span></div></div>{form.fotograflar.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{form.fotograflar.map((photo, index) => <div key={photo.id} className="group overflow-hidden rounded-sg-md border border-sg-border bg-sg-surface"><div className="relative aspect-square bg-sg-surface-soft"><img src={photo.url} alt={photo.name} className="h-full w-full object-cover" />{photo.birincil || index === 0 ? <ModernBadge tone="warning" className="absolute left-2 top-2"><Star className="h-3 w-3" />Birincil</ModernBadge> : null}<div className="absolute inset-0 flex items-center justify-center gap-2 bg-sg-text/45 opacity-0 transition group-hover:opacity-100"><ModernButton aria-label="Fotoğrafı aç" size="sm" tone="ghost" icon={Eye} onClick={() => window.open(photo.url, '_blank', 'noopener,noreferrer')}>Aç</ModernButton><ModernButton aria-label="Fotoğrafı sil" size="sm" tone="danger" icon={Trash2} onClick={() => removePhoto(photo.id)}>Sil</ModernButton></div></div><p className="truncate px-3 py-2 text-xs text-sg-text-soft">{photo.name}</p></div>)}</div> : <ModernCard className="border-dashed text-center"><ImagePlus className="mx-auto h-7 w-7 text-sg-text-soft" /><p className="mt-2 text-sm text-sg-text-soft">Fotoğraf yüklemek için yukarıdaki düğmeyi kullanın.</p></ModernCard>}{form.wooYayin === 'Yayında' ? <ModernNotice tone="warning" title="Yayın ön koşulları" description="AI açıklaması onaylı olmalı, en az bir fotoğraf ve geçerli shop fiyatı bulunmalı." /> : null}</div> : null}
      {error ? <ModernNotice tone="danger" title="Devam edilemiyor" description={error} /> : null}
    </ModernDrawer>
  );
}
