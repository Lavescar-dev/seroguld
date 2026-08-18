import { type ChangeEvent, type DragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudUpload,
  Database,
  Eye,
  FileText,
  Globe,
  History,
  Image as ImageIcon,
  Info,
  Link2,
  LoaderCircle,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Star,
  Trash2,
  Upload,
  X,
  Zap,
  ZapOff,
} from 'lucide-react';

import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { WooCatalogPanel } from './WooCatalogPanel';
import { describeRejectedPhotos, filesFromDataTransfer, validatePhotoFiles } from './photoUpload';

import {
  buildDraftFromStock,
  defaultNewWooProductDraft,
  type DraftPhoto,
  type NewWooProductDraft,
  type StokItem,
  type WooFilter,
  type WooMakeState,
} from './useWooMakeState';

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;
const sansStyle = { fontFamily: "'IBM Plex Sans', system-ui, sans-serif" } as const;

const METAL_STYLE = {
  Altın: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-400' },
  Gümüş: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-400' },
  Platin: { bg: 'bg-zinc-100', text: 'text-zinc-700', border: 'border-zinc-400' },
  Palladyum: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-400' },
} as const;

const WOO_STYLE = {
  Yayında: { bg: 'bg-emerald-100', text: 'text-emerald-800', icon: <Zap className="h-3 w-3" /> },
  Taslak: { bg: 'bg-amber-100', text: 'text-amber-800', icon: <FileText className="h-3 w-3" /> },
  'Yayınlanmadı': { bg: 'bg-slate-100', text: 'text-slate-600', icon: <ZapOff className="h-3 w-3" /> },
} as const;

const DURUM_STYLE: Record<string, { bg: string; text: string }> = {
  Satışta: { bg: 'bg-emerald-100', text: 'text-emerald-800' },
  Taslak: { bg: 'bg-slate-100', text: 'text-slate-600' },
  Yayında: { bg: 'bg-blue-100', text: 'text-blue-800' },
  'Yayından Kaldırıldı': { bg: 'bg-red-100', text: 'text-red-700' },
  Satıldı: { bg: 'bg-brand-100', text: 'text-brand-600' },
};

const STOCK_KAT_LABEL: Record<StokItem['mainKat'], string> = {
  kulce: 'Külçe',
  sikke: 'Sikke',
  taki: 'Takı',
  gumus: 'Gümüş',
  platin_pd: 'Platin/Pd',
};

const STOCK_KAT_STYLE: Record<StokItem['mainKat'], { bg: string; text: string; border: string }> = {
  kulce: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-400' },
  sikke: { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-400' },
  taki: { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-400' },
  gumus: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-400' },
  platin_pd: { bg: 'bg-zinc-100', text: 'text-zinc-700', border: 'border-zinc-400' },
};

const SHOP_STATUS_LABEL: Record<NonNullable<StokItem['shopDurumu']>, string> = {
  hazir: 'Hazır',
  mangler_foto: 'Mangler foto',
  listelendi: 'Listelendi',
};

export type SeoBundle = {
  title: string;
  slug: string;
  kisaAciklama: string;
  meta: string;
  uzunAciklama: string;
};

const SEO_SECTION_KEYS: Record<string, keyof SeoBundle> = {
  SEO_TITLE: 'title',
  URL_SLUG: 'slug',
  SHORT_DESCRIPTION: 'kisaAciklama',
  META_DESCRIPTION: 'meta',
  LONG_DESCRIPTION_HTML: 'uzunAciklama',
};

const SEO_FIELD_LABELS: Record<keyof SeoBundle, string> = {
  title: 'SEO Title',
  slug: 'URL Slug',
  kisaAciklama: 'Kısa Açıklama',
  meta: 'Meta Description',
  uzunAciklama: 'Uzun Açıklama',
};

const FILTER_LABELS: Record<WooFilter, string> = {
  all: 'Tümü',
  published: 'Yayında',
  draft: 'Taslak',
  unpublished: 'Yayınlanmadı',
};

const STEP_LABELS = ['Kaynak', 'Bilgiler', 'AI & SEO', 'Fotoğraf & Yayın'] as const;

function emptySeoBundle(): SeoBundle {
  return {
    title: '',
    slug: '',
    kisaAciklama: '',
    meta: '',
    uzunAciklama: '',
  };
}

function stripCodeFence(value: string) {
  return value.replace(/^```[a-z-]*\n?/i, '').replace(/\n?```$/i, '').trim();
}

export function parseAiSeoBundle(text: string | null | undefined): SeoBundle {
  if (!text?.trim()) return emptySeoBundle();

  const parsed = emptySeoBundle();
  let currentKey: keyof SeoBundle | null = null;
  let buffer: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const sectionMatch = line.match(/^\s*(SEO_TITLE|SHORT_DESCRIPTION|LONG_DESCRIPTION_HTML|META_DESCRIPTION|URL_SLUG)\s*:\s*(.*)$/);
    if (sectionMatch) {
      if (currentKey) {
        parsed[currentKey] = stripCodeFence(buffer.join('\n').trim());
      }
      currentKey = SEO_SECTION_KEYS[sectionMatch[1]];
      buffer = sectionMatch[2]?.trim() ? [sectionMatch[2].trim()] : [];
      continue;
    }
    if (currentKey) buffer.push(line);
  }

  if (currentKey) {
    parsed[currentKey] = stripCodeFence(buffer.join('\n').trim());
  }

  return parsed;
}

export function missingSeoFields(bundle: SeoBundle) {
  return (Object.keys(SEO_FIELD_LABELS) as (keyof SeoBundle)[]).filter((key) => !bundle[key]?.trim()).map((key) => SEO_FIELD_LABELS[key]);
}

export function isPublishReady(state: WooMakeState['detail']) {
  if (!state) return false;
  return (
    !state.is_gdpr_locked &&
    state.photos.length > 0 &&
    Boolean(state.ai_description?.trim()) &&
    state.ai_description_approved &&
    !state.manual_review_required &&
    Boolean(state.shop_price_dkk || state.sale_price_dkk || state.purchase_price_dkk)
  );
}

function slugify(input: string) {
  return input
    .toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildAiPreview(draft: NewWooProductDraft) {
  const agirlik = Number(draft.agirlik || '0');
  const ayar = Number(draft.ayar || '0');
  const metalText =
    draft.metal === 'Altın'
      ? 'guld'
      : draft.metal === 'Gümüş'
        ? 'sølv'
        : draft.metal === 'Platin'
          ? 'platin'
          : 'palladium';
  const tipText =
    draft.tip === 'Bar' ? 'barre' : draft.tip === 'Mønt' ? 'mønt' : draft.tip === 'Smykke' ? 'smykke' : 'produkt';
  const name = draft.urunAdi.trim() || `${draft.metal} ${draft.tip}`;
  return `${name} er et ${metalText} ${tipText} med vægt på ${agirlik.toLocaleString('da-DK')} gram og finhed ${ayar} ‰. ${
    draft.uretici.trim() ? `${draft.uretici.trim()} er registreret som producent. ` : ''
  }Produktet er klargjort til WooCommerce med fokus på tydelig metadata, præcis vægtangivelse og salgsklar præsentation hos Sero Guld.`.trim();
}

function buildSeoPreview(draft: NewWooProductDraft, aiText: string): SeoBundle {
  const name = draft.urunAdi.trim() || `${draft.metal} ${draft.tip}`;
  return {
    title: `${name} | Sero Guld`,
    slug: slugify(name),
    kisaAciklama: aiText.slice(0, 160),
    meta: `Køb ${name} hos Sero Guld. Vægt ${draft.agirlik || '0'}g, finhed ${draft.ayar || '0'} ‰.`,
    uzunAciklama: `<p>${aiText}</p>`,
  };
}

function stockCategoryLabel(item: StokItem) {
  if (item.mainKat === 'gumus' && item.gumusAlt) {
    return `Gümüş · ${item.gumusAlt === 'barrer' ? 'Barrer' : item.gumusAlt === 'monter' ? 'Mønter' : 'Smykker'}`;
  }
  if (item.mainKat === 'platin_pd' && item.platinAlt) {
    return `Platin/Pd · ${item.platinAlt === 'palladyum' ? 'Palladyum' : 'Platin'}`;
  }
  return STOCK_KAT_LABEL[item.mainKat];
}

function stockMetaLine(item: StokItem) {
  return `${formatNumber(item.birimGram, ' g')} · ${item.adet} adet · ${formatMoney(item.alisFiyati)}`;
}

function primaryPhotoLabel(index: number, isPrimary: boolean | undefined) {
  return isPrimary || index === 0;
}

function openExternal(url: string) {
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start border-b border-brand-100 last:border-b-0">
      <div className="w-36 flex-shrink-0 border-r border-brand-200 bg-brand-50 px-3 py-2.5">
        <span className="text-xs font-black uppercase tracking-wider text-brand-600">{label}</span>
      </div>
      <div className="flex-1 px-3 py-2.5">{children}</div>
    </div>
  );
}

function StepTab({
  active,
  done,
  step,
  label,
  onClick,
}: {
  active: boolean;
  done: boolean;
  step: 1 | 2 | 3 | 4;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 border-r border-brand-200 px-3 py-2.5 text-center last:border-r-0 ${
        active
          ? 'bg-amber-500 text-white'
          : done
            ? 'cursor-pointer bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            : 'cursor-not-allowed bg-brand-50 text-brand-400'
      }`}
    >
      {done ? (
        <CheckCircle className="h-3.5 w-3.5" />
      ) : (
        <span className={`inline-flex h-5 w-5 items-center justify-center border text-[10px] font-black ${active ? 'border-white/40 bg-white/20 text-white' : 'border-current'}`}>
          {step}
        </span>
      )}
      <span className="hidden text-xs font-black uppercase tracking-wider sm:inline">{label}</span>
    </button>
  );
}

export function YeniUrunPanel({
  stokList,
  urunler,
  pending,
  onKapat,
  onKaydet,
}: {
  stokList: StokItem[];
  urunler: WooMakeState['urunler'];
  pending: boolean;
  onKapat: () => void;
  onKaydet: (draft: NewWooProductDraft) => Promise<void>;
}) {
  const [adim, setAdim] = useState<1 | 2 | 3 | 4>(1);
  const [stokArama, setStokArama] = useState('');
  const [seoAcik, setSeoAcik] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [photoDragActive, setPhotoDragActive] = useState(false);
  const [form, setForm] = useState<NewWooProductDraft>(defaultNewWooProductDraft());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      for (const item of form.fotograflar) {
        URL.revokeObjectURL(item.url);
      }
    };
  }, [form.fotograflar]);

  const linkedStockIds = useMemo(() => new Set(urunler.map((item) => item.depoStokId).filter(Boolean)), [urunler]);

  const filtreliStok = useMemo(() => {
    const q = stokArama.trim().toLocaleLowerCase('tr-TR');
    return stokList.filter((item) => {
      if (linkedStockIds.has(item.id)) return false;
      if (!q) return true;
      return [item.urun, item.stokNo || '', item.uretici || '', stockCategoryLabel(item)].join(' ').toLocaleLowerCase('tr-TR').includes(q);
    });
  }, [linkedStockIds, stokArama, stokList]);

  const seoEksik = useMemo(() => missingSeoFields(form.seo as SeoBundle), [form.seo]);

  function patch(values: Partial<NewWooProductDraft>) {
    setForm((current) => ({ ...current, ...values }));
  }

  function selectStock(item: StokItem) {
    const next = buildDraftFromStock(item);
    setForm((current) => ({ ...current, ...next }));
  }

  function nextStep(target: 2 | 3 | 4) {
    setHata(null);
    if (target >= 2) {
      if (!form.kaynak) {
        setHata('Kaynak seçimi zorunlu.');
        return;
      }
      if (form.kaynak === 'depo' && !form.secilenStokId) {
        setHata('Bir depo ürünü seçin.');
        return;
      }
    }
    if (target >= 3) {
      if (!form.urunAdi.trim()) {
        setHata('Ürün adı zorunlu.');
        return;
      }
      if (Number(form.agirlik || '0') <= 0 || Number(form.alimFiyati || '0') <= 0) {
        setHata('Geçerli ağırlık ve alım fiyatı girin.');
        return;
      }
    }
    setAdim(target);
  }

  function generateDraftAi() {
    const aiText = buildAiPreview(form);
    patch({
      aiAciklama: aiText,
      seo: buildSeoPreview(form, aiText),
    });
  }

  function addDraftPhotos(files: File[]) {
    if (files.length === 0) return;
    const { accepted, rejected } = validatePhotoFiles(files);
    if (rejected.length > 0) {
      setHata(`Bazı dosyalar kabul edilmedi — ${describeRejectedPhotos(rejected)}`);
    }
    if (accepted.length === 0) return;
    const next: DraftPhoto[] = accepted.map((file, index) => ({
      id: `${file.name}-${file.size}-${Date.now()}-${index}`,
      name: file.name,
      url: URL.createObjectURL(file),
      file,
      birincil: form.fotograflar.length === 0 && index === 0,
    }));
    patch({ fotograflar: [...form.fotograflar, ...next] });
  }

  function onDraftFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    addDraftPhotos(Array.from(event.target.files || []));
    event.target.value = '';
  }

  function onDraftPhotosDropped(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setPhotoDragActive(false);
    addDraftPhotos(filesFromDataTransfer(event.dataTransfer));
  }

  function removeDraftPhoto(photoId: string) {
    const photo = form.fotograflar.find((item) => item.id === photoId);
    if (photo) URL.revokeObjectURL(photo.url);
    patch({ fotograflar: form.fotograflar.filter((item) => item.id !== photoId) });
  }

  async function submit() {
    setHata(null);
    const wantsPublish = form.wooYayin === 'Yayında';
    if (wantsPublish) {
      if (!form.aiOnaylandi || form.aiAciklama.trim().length < 10) {
        setHata('Yayına almadan önce AI açıklamasını üretip onaylayın.');
        return;
      }
      if (form.fotograflar.length === 0) {
        setHata('Yayına almadan önce en az bir fotoğraf ekleyin.');
        return;
      }
      if (Number(form.satisHasJiyati || '0') <= 0) {
        setHata('Yayına almadan önce geçerli shop fiyatı girin.');
        return;
      }
    }
    await onKaydet(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex" style={sansStyle}>
      <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onKapat} />

      <div className="flex h-full w-[680px] max-w-[95vw] flex-col overflow-hidden border-l-4 border-amber-500 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b-2 border-brand-700 bg-brand-900 px-5 py-4">
          <div className="flex items-center gap-3">
            <Plus className="h-5 w-5 text-amber-400" />
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-brand-400">WooCommerce</p>
              <p className="font-black text-white">Yeni Ürün Ekle</p>
            </div>
          </div>
          <button type="button" aria-label="Yeni ürün penceresini kapat" onClick={onKapat} className="border border-brand-700 p-1.5 transition-colors hover:bg-brand-700">
            <X className="h-4 w-4 text-brand-300" />
          </button>
        </div>

        <div className="flex border-b-2 border-brand-200 bg-brand-50">
          {STEP_LABELS.map((label, index) => {
            const step = (index + 1) as 1 | 2 | 3 | 4;
            return (
              <StepTab
                key={label}
                active={adim === step}
                done={adim > step}
                step={step}
                label={label}
                onClick={step < adim ? () => setAdim(step) : undefined}
              />
            );
          })}
        </div>

        <div className="flex-1 overflow-auto p-5">
          {adim === 1 ? (
            <div className="space-y-4">
              <div>
                <p className="mb-1 text-sm font-black uppercase tracking-wider text-brand-700">Ürün Kaynağı</p>
                <p className="text-xs text-brand-500">Depolama modülünden mevcut bir stok kalemi seçin veya sıfırdan manuel olarak girin.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => patch({ kaynak: 'depo' })}
                  className={`flex flex-col items-center gap-2 border-2 p-4 transition-all ${
                    form.kaynak === 'depo' ? 'border-amber-500 bg-amber-50' : 'border-brand-200 bg-white hover:border-brand-400'
                  }`}
                >
                  <Database className={`h-6 w-6 ${form.kaynak === 'depo' ? 'text-amber-600' : 'text-brand-400'}`} />
                  <span className="text-sm font-black text-brand-800">Depodan Seç</span>
                  <span className="text-center text-xs text-brand-500">Mevcut stok kalemini Woo taslağına bağla</span>
                  {form.kaynak === 'depo' ? (
                    <span className="border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">Seçildi</span>
                  ) : null}
                </button>

                <button
                  type="button"
                  onClick={() => patch({ kaynak: 'manuel', secilenStokId: null })}
                  className={`flex flex-col items-center gap-2 border-2 p-4 transition-all ${
                    form.kaynak === 'manuel' ? 'border-amber-500 bg-amber-50' : 'border-brand-200 bg-white hover:border-brand-400'
                  }`}
                >
                  <FileText className={`h-6 w-6 ${form.kaynak === 'manuel' ? 'text-amber-600' : 'text-brand-400'}`} />
                  <span className="text-sm font-black text-brand-800">Manuel Gir</span>
                  <span className="text-center text-xs text-brand-500">Woo için ürünü sıfırdan hazırlayın</span>
                  {form.kaynak === 'manuel' ? (
                    <span className="border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">Seçildi</span>
                  ) : null}
                </button>
              </div>

              {form.kaynak === 'depo' ? (
                <div className="overflow-hidden border-2 border-brand-300 bg-white">
                  <div className="border-b border-brand-200 bg-brand-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Search className="h-4 w-4 text-brand-500" />
                      <input
                        value={stokArama}
                        onChange={(event) => setStokArama(event.target.value)}
                        className="w-full border border-brand-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-700"
                        placeholder="Stok no, ürün, üretici veya kategori ara"
                      />
                    </div>
                  </div>
                  <div className="max-h-[360px] overflow-auto">
                    {filtreliStok.map((item) => {
                      const active = form.secilenStokId === item.id;
                      const tone = STOCK_KAT_STYLE[item.mainKat];
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => selectStock(item)}
                          className={`block w-full border-b border-brand-100 px-4 py-3 text-left transition-colors ${
                            active ? 'border-l-4 border-l-amber-500 bg-amber-50/60' : 'border-l-4 border-l-transparent hover:bg-brand-50'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-sm font-black text-brand-900">{item.stokNo || item.id.slice(0, 8)}</span>
                                <span className={`border px-1.5 py-0 text-[10px] font-bold ${tone.bg} ${tone.text} ${tone.border}`}>{stockCategoryLabel(item)}</span>
                                {item.shopDurumu ? <span className="text-[10px] font-bold text-brand-500">{SHOP_STATUS_LABEL[item.shopDurumu]}</span> : null}
                              </div>
                              <p className="mt-1 text-sm font-bold text-brand-800">{item.urun}</p>
                              <p className="mt-1 text-xs text-brand-500">{stockMetaLine(item)}</p>
                            </div>
                            {active ? <CheckCircle className="mt-1 h-4 w-4 text-emerald-600" /> : null}
                          </div>
                        </button>
                      );
                    })}

                    {filtreliStok.length === 0 ? (
                      <div className="px-4 py-8 text-center text-xs text-brand-400">Bağlanabilir depo ürünü bulunamadı.</div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {adim === 2 ? (
            <div className="space-y-4">
              <div>
                <p className="mb-1 text-sm font-black uppercase tracking-wider text-brand-700">Ürün Bilgileri</p>
                <p className="text-xs text-brand-500">Temel ürün, metal, fiyat ve satıcı alanlarını Make akışındaki sırayla doldurun.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-black uppercase tracking-wider text-brand-600">Ürün Adı</span>
                  <input value={form.urunAdi} onChange={(event) => patch({ urunAdi: event.target.value })} className="w-full border border-brand-300 px-3 py-2 text-sm outline-none focus:border-amber-500" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black uppercase tracking-wider text-brand-600">Üretici</span>
                  <input value={form.uretici} onChange={(event) => patch({ uretici: event.target.value })} className="w-full border border-brand-300 px-3 py-2 text-sm outline-none focus:border-amber-500" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black uppercase tracking-wider text-brand-600">Metal</span>
                  <select value={form.metal} onChange={(event) => patch({ metal: event.target.value as NewWooProductDraft['metal'] })} className="w-full border border-brand-300 px-3 py-2 text-sm outline-none focus:border-amber-500">
                    <option>Altın</option>
                    <option>Gümüş</option>
                    <option>Platin</option>
                    <option>Palladyum</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black uppercase tracking-wider text-brand-600">Tip</span>
                  <select value={form.tip} onChange={(event) => patch({ tip: event.target.value as NewWooProductDraft['tip'] })} className="w-full border border-brand-300 px-3 py-2 text-sm outline-none focus:border-amber-500">
                    <option>Bar</option>
                    <option>Mønt</option>
                    <option>Smykke</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black uppercase tracking-wider text-brand-600">Ağırlık (g)</span>
                  <input value={form.agirlik} onChange={(event) => patch({ agirlik: event.target.value })} className="w-full border border-brand-300 px-3 py-2 text-sm outline-none focus:border-amber-500" style={monoStyle} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black uppercase tracking-wider text-brand-600">Ayar / ‰</span>
                  <input value={form.ayar} onChange={(event) => patch({ ayar: event.target.value })} className="w-full border border-brand-300 px-3 py-2 text-sm outline-none focus:border-amber-500" style={monoStyle} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black uppercase tracking-wider text-brand-600">Alım Fiyatı (DKK)</span>
                  <input value={form.alimFiyati} onChange={(event) => patch({ alimFiyati: event.target.value })} className="w-full border border-brand-300 px-3 py-2 text-sm outline-none focus:border-amber-500" style={monoStyle} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black uppercase tracking-wider text-brand-600">Shop Fiyatı (DKK)</span>
                  <input value={form.satisHasJiyati} onChange={(event) => patch({ satisHasJiyati: event.target.value })} className="w-full border border-brand-300 px-3 py-2 text-sm outline-none focus:border-amber-500" style={monoStyle} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black uppercase tracking-wider text-brand-600">Satıcı</span>
                  <input value={form.satici} onChange={(event) => patch({ satici: event.target.value })} className="w-full border border-brand-300 px-3 py-2 text-sm outline-none focus:border-amber-500" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black uppercase tracking-wider text-brand-600">Ref / Stok No</span>
                  <input value={form.stokNo} onChange={(event) => patch({ stokNo: event.target.value })} className="w-full border border-brand-300 px-3 py-2 text-sm outline-none focus:border-amber-500" style={monoStyle} />
                </label>
              </div>

              <label className="space-y-1">
                <span className="text-xs font-black uppercase tracking-wider text-brand-600">Notlar</span>
                <textarea value={form.notlar} onChange={(event) => patch({ notlar: event.target.value })} rows={4} className="w-full border border-brand-300 px-3 py-2 text-sm outline-none focus:border-amber-500" />
              </label>
            </div>
          ) : null}

          {adim === 3 ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={generateDraftAi}
                  className="inline-flex items-center gap-2 border border-indigo-900 bg-indigo-900 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white"
                >
                  <Bot className="h-3.5 w-3.5" />
                  AI Açıklama Üret
                </button>
                <label className="inline-flex items-center gap-2 text-xs font-bold text-brand-700">
                  <input
                    type="checkbox"
                    checked={form.aiOnaylandi}
                    onChange={(event) => patch({ aiOnaylandi: event.target.checked })}
                  />
                  Oluştururken onaylı say
                </label>
              </div>

              <label className="block">
                <span className="mb-2 block text-xs font-black uppercase tracking-wider text-brand-600">AI Açıklama</span>
                <textarea
                  value={form.aiAciklama}
                  onChange={(event) => patch({ aiAciklama: event.target.value })}
                  rows={6}
                  className="w-full border border-brand-300 px-3 py-3 text-sm outline-none focus:border-indigo-500"
                />
              </label>

              <div className="overflow-hidden border border-brand-200">
                <button
                  type="button"
                  onClick={() => setSeoAcik((current) => !current)}
                  className="flex w-full items-center justify-between border-b border-brand-200 bg-brand-50 px-4 py-3 hover:bg-brand-100"
                >
                  <span className="text-xs font-black uppercase tracking-wider text-brand-500">SEO Paket Kontrolü</span>
                  <div className="flex items-center gap-2">
                    {seoEksik.length > 0 ? (
                      <span className="inline-flex items-center gap-1 border border-red-300 bg-red-50 px-1.5 py-0 text-[11px] font-bold text-red-700">
                        <AlertCircle className="h-3 w-3" />
                        {seoEksik.length} eksik
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 border border-emerald-300 bg-emerald-50 px-1.5 py-0 text-[11px] font-bold text-emerald-700">
                        <CheckCircle className="h-3 w-3" />
                        Tam
                      </span>
                    )}
                    <ChevronDown className={`h-3.5 w-3.5 text-brand-500 transition-transform ${seoAcik ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                {seoAcik ? (
                  <div className="bg-white">
                    <FieldRow label="SEO Title">
                      <input value={form.seo.title} onChange={(event) => patch({ seo: { ...form.seo, title: event.target.value } })} className="w-full border border-brand-300 px-3 py-2 text-sm outline-none focus:border-brand-700" />
                    </FieldRow>
                    <FieldRow label="URL Slug">
                      <input value={form.seo.slug} onChange={(event) => patch({ seo: { ...form.seo, slug: event.target.value } })} className="w-full border border-brand-300 px-3 py-2 text-sm outline-none focus:border-brand-700" style={monoStyle} />
                    </FieldRow>
                    <FieldRow label="Kısa">
                      <textarea value={form.seo.kisaAciklama} onChange={(event) => patch({ seo: { ...form.seo, kisaAciklama: event.target.value } })} rows={2} className="w-full border border-brand-300 px-3 py-2 text-sm outline-none focus:border-brand-700" />
                    </FieldRow>
                    <FieldRow label="Meta">
                      <textarea value={form.seo.meta} onChange={(event) => patch({ seo: { ...form.seo, meta: event.target.value } })} rows={2} className="w-full border border-brand-300 px-3 py-2 text-sm outline-none focus:border-brand-700" />
                    </FieldRow>
                    <FieldRow label="Uzun">
                      <textarea value={form.seo.uzunAciklama} onChange={(event) => patch({ seo: { ...form.seo, uzunAciklama: event.target.value } })} rows={4} className="w-full border border-brand-300 px-3 py-2 text-sm outline-none focus:border-brand-700" />
                    </FieldRow>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {adim === 4 ? (
            <div
              data-testid="woo-draft-photo-dropzone"
              onDragOver={(event) => { event.preventDefault(); setPhotoDragActive(true); }}
              onDragLeave={(event) => { if (event.currentTarget === event.target || !event.currentTarget.contains(event.relatedTarget as Node)) setPhotoDragActive(false); }}
              onDrop={onDraftPhotosDropped}
              className={`space-y-4 ${photoDragActive ? 'ring-2 ring-brand-500 ring-offset-2 bg-brand-50' : ''}`}
            >
              {photoDragActive ? (
                <div className="border-2 border-dashed border-brand-500 bg-brand-50 px-4 py-6 text-center text-sm font-bold text-brand-700">
                  Fotoğrafları buraya bırakın
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 border border-brand-900 bg-brand-900 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Fotoğraf Yükle
                </button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onDraftFilesSelected} />

                <label className="inline-flex items-center gap-2 text-xs font-bold text-brand-700">
                  <input type="radio" checked={form.wooYayin === 'Taslak'} onChange={() => patch({ wooYayin: 'Taslak' })} />
                  Taslak oluştur
                </label>
                <label className="inline-flex items-center gap-2 text-xs font-bold text-brand-700">
                  <input type="radio" checked={form.wooYayin === 'Yayında'} onChange={() => patch({ wooYayin: 'Yayında', aiOnaylandi: true })} />
                  Oluşturunca yayınla
                </label>
              </div>

              {form.fotograflar.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-4">
                  {form.fotograflar.map((photo, index) => (
                    <div key={photo.id} className="group relative overflow-hidden border border-brand-200 bg-brand-50">
                      <img src={photo.url} alt={photo.name} className="aspect-square w-full object-cover" />
                      {photo.birincil || index === 0 ? (
                        <div className="absolute left-1 top-1 flex items-center gap-0.5 bg-amber-500 px-1 py-0.5">
                          <Star className="h-2.5 w-2.5 text-white" />
                          <span className="text-[9px] font-black text-white">Birincil</span>
                        </div>
                      ) : null}
                      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                        <button type="button" onClick={() => openExternal(photo.url)} className="border border-white/40 bg-white/20 p-1.5 hover:bg-white/40">
                          <Eye className="h-3.5 w-3.5 text-white" />
                        </button>
                        <button type="button" onClick={() => removeDraftPhoto(photo.id)} className="bg-red-500/80 p-1.5 hover:bg-red-600">
                          <Trash2 className="h-3.5 w-3.5 text-white" />
                        </button>
                      </div>
                      <p className="truncate border-t border-brand-200 bg-brand-50 px-1.5 py-1 text-[10px] text-brand-500">{photo.name}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border-2 border-dashed border-brand-200 px-6 py-8 text-center">
                  <CloudUpload className="mx-auto mb-2 h-8 w-8 text-brand-300" />
                  <p className="text-xs text-brand-400">Henüz fotoğraf yüklenmedi</p>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {hata ? <div className="border-t border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">{hata}</div> : null}

        <div className="flex items-center justify-between border-t-2 border-brand-200 bg-white px-5 py-4">
          <button type="button" onClick={onKapat} className="border border-brand-300 px-4 py-2 text-xs font-bold uppercase tracking-wider text-brand-600 hover:bg-brand-50">
            Vazgeç
          </button>

          <div className="flex items-center gap-2">
            {adim > 1 ? (
              <button
                type="button"
                onClick={() => setAdim((current) => (current > 1 ? ((current - 1) as 1 | 2 | 3 | 4) : current))}
                className="border border-brand-300 px-4 py-2 text-xs font-bold uppercase tracking-wider text-brand-700 hover:bg-brand-50"
              >
                Geri
              </button>
            ) : null}

            {adim < 4 ? (
              <button
                type="button"
                onClick={() => nextStep((adim + 1) as 2 | 3 | 4)}
                className="border border-brand-900 bg-brand-900 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-800"
              >
                İleri
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  void submit().then(onKapat).catch(() => undefined);
                }}
                className="inline-flex items-center gap-2 border border-emerald-800 bg-emerald-700 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                Ürünü Oluştur
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MakeWooCommercePage({
  filter,
  setFilter,
  urunler,
  secilenId,
  setSecilenId,
  secilen,
  detail,
  history,
  syncLog,
  rawData,
  rawOpen,
  setRawOpen,
  publishPrice,
  setPublishPrice,
  aiDraft,
  setAiDraft,
  stokList,
  bootstrap,
  loadingWorkspace,
  loadingDetail,
  isGeneratingAi,
  isSavingAi,
  isApprovingReview,
  isPublishing,
  isUnpublishing,
  isSyncing,
  isUploadingPhotos,
  isDeletingPhoto,
  isCreatingProduct,
  generateAi,
  saveAi,
  approveManualReview,
  publish,
  unpublish,
  syncSale,
  uploadPhotos,
  deletePhoto,
  createProductFromDraft,
  ...catalogState
}: WooMakeState) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [yeniPanelAcik, setYeniPanelAcik] = useState(false);
  const [seoGoster, setSeoGoster] = useState(false);
  const [surface, setSurface] = useState<'catalog' | 'local'>('catalog');

  const fullState = {
    filter,
    setFilter,
    urunler,
    secilenId,
    setSecilenId,
    secilen,
    detail,
    history,
    syncLog,
    rawData,
    rawOpen,
    setRawOpen,
    publishPrice,
    setPublishPrice,
    aiDraft,
    setAiDraft,
    stokList,
    bootstrap,
    loadingWorkspace,
    loadingDetail,
    isGeneratingAi,
    isSavingAi,
    isApprovingReview,
    isPublishing,
    isUnpublishing,
    isSyncing,
    isUploadingPhotos,
    isDeletingPhoto,
    isCreatingProduct,
    generateAi,
    saveAi,
    approveManualReview,
    publish,
    unpublish,
    syncSale,
    uploadPhotos,
    deletePhoto,
    createProductFromDraft,
    ...catalogState,
  } as WooMakeState;

  useEffect(() => {
    setSeoGoster(false);
  }, [secilenId]);

  const publishedCount =
    bootstrap?.integrations.total_published_products ?? urunler.filter((item) => item.wooYayin === 'Yayında').length;
  const draftCount = urunler.filter((item) => item.wooYayin === 'Taslak').length;
  const totalProducts = bootstrap?.summary.total_products ?? urunler.length;
  const publishReady = useMemo(() => isPublishReady(detail), [detail]);
  const seoBundle = useMemo(() => parseAiSeoBundle(aiDraft || detail?.ai_description || ''), [aiDraft, detail?.ai_description]);
  const seoEksik = useMemo(() => missingSeoFields(seoBundle), [seoBundle]);
  const seoTamMi = seoEksik.length === 0;

  const selectedMetal = secilen ? METAL_STYLE[secilen.metal] : METAL_STYLE.Altın;
  const selectedWoo = secilen ? WOO_STYLE[detail?.is_published_to_site ? 'Yayında' : secilen.wooYayin] : WOO_STYLE['Yayınlanmadı'];
  const selectedStatus = secilen ? DURUM_STYLE[secilen.durum] || DURUM_STYLE.Taslak : DURUM_STYLE.Taslak;
  const lastSyncAt = syncLog[0]?.created_at || detail?.published_at || null;

  function onFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) uploadPhotos(files);
    event.target.value = '';
  }

  if (surface === 'catalog') {
    return (
      <div className="min-h-full bg-white p-5" style={sansStyle}>
        <WooCatalogPanel state={fullState} mode="classic" onOpenLocalProducts={() => setSurface('local')} />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-white" style={sansStyle}>
      <div className="border-b-2 border-brand-300 bg-brand-50 px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <ShoppingCart className="h-5 w-5 text-brand-600" />
          <div>
            <h2 className="text-lg font-black uppercase tracking-wider text-brand-900">WooCommerce ürün dışa aktarımı</h2>
            <p className="mt-0.5 text-xs text-brand-500">Depo ürünlerinin AI Danca SEO açıklaması üretimi ve WooCommerce&apos;e yayını</p>
          </div>

          <div className="ml-auto flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              {[
                ['Toplam', totalProducts, 'text-brand-900'],
                ['Yayında', publishedCount, 'text-emerald-700'],
                ['Taslak', draftCount, 'text-amber-700'],
              ].map(([label, value, tone]) => (
                <div key={label as string} className="text-right">
                  <p className="text-xs uppercase tracking-wider text-brand-400">{label}</p>
                  <p className={`text-sm font-black ${tone}`} style={monoStyle}>
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setSurface('catalog')}
              className="flex items-center gap-2 border border-brand-300 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-wider text-brand-700 transition-colors hover:bg-brand-100"
            >
              <Cloud className="h-4 w-4" />
              Woo Kataloğu
            </button>

            <button
              type="button"
              onClick={() => setYeniPanelAcik(true)}
              className="flex items-center gap-2 border border-amber-800 bg-amber-600 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-amber-700"
            >
              <Plus className="h-4 w-4" />
              Yeni Ürün Ekle
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-72 shrink-0 flex-col overflow-hidden border-r-2 border-brand-200">
          <div className="flex items-center justify-between border-b border-brand-700 bg-brand-800 px-3 py-2">
            <span className="text-xs font-black uppercase tracking-widest text-brand-300">Ürünler</span>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as WooFilter)}
              className="border border-brand-600 bg-brand-700 px-1.5 py-0.5 text-xs font-bold text-brand-300 focus:outline-none"
            >
              <option value="all">Tümü</option>
              <option value="published">Yayında</option>
              <option value="draft">Taslak</option>
              <option value="unpublished">Yayınlanmadı</option>
            </select>
          </div>

          <div className="flex-1 overflow-auto">
            {loadingWorkspace ? (
              <div className="px-4 py-10 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Çalışma alanı</p>
                <p className="mt-2 text-sm text-brand-600">Woo urun listesi hazirlaniyor.</p>
              </div>
            ) : urunler.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Filtre</p>
                <p className="mt-2 text-sm text-brand-400">{FILTER_LABELS[filter]} için ürün bulunamadı.</p>
              </div>
            ) : (
              urunler.map((item) => {
                const metalTone = METAL_STYLE[item.metal];
                const wooTone = WOO_STYLE[item.wooYayin];
                const active = item.id === secilenId;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSecilenId(item.id)}
                    className={`group block w-full cursor-pointer border-b border-brand-100 px-4 py-3 text-left transition-colors ${
                      active ? 'border-l-4 border-l-amber-500 bg-brand-100' : 'border-l-4 border-l-transparent hover:bg-brand-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-black text-brand-900" style={monoStyle}>
                            #{item.urunNo}
                          </span>
                          <span className={`border px-1.5 py-0 text-xs font-bold ${metalTone.bg} ${metalTone.text} ${metalTone.border}`}>
                            {item.metal}
                          </span>
                          {item.depoStokId ? (
                            <span title="Depo bağlantılı">
                              <Link2 className="h-3 w-3 text-amber-600" />
                            </span>
                          ) : null}
                        </div>

                        <p className="mt-0.5 truncate text-xs text-brand-600">
                          {item.tip} · {formatNumber(item.agirlik, ' g')} · {item.ayar}‰
                        </p>

                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0 text-xs font-bold ${wooTone.bg} ${wooTone.text}`}>
                            {wooTone.icon}
                            {item.wooYayin}
                          </span>
                          {!item.hasPhoto ? <span className="border border-red-200 bg-red-50 px-1 text-xs text-red-500">Foto yok</span> : null}
                          {!item.aiOnaylandi ? <span className="border border-amber-200 bg-amber-50 px-1 text-xs text-amber-700">AI bekl.</span> : null}
                        </div>
                      </div>

                      <ChevronRight className={`mt-1 h-4 w-4 shrink-0 ${active ? 'text-amber-600' : 'text-brand-300 group-hover:text-brand-600'}`} />
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="border-t-2 border-brand-200 bg-brand-50 px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1.5">
              <Database className="h-3 w-3 text-brand-400" />
              <span className="text-xs font-black uppercase tracking-widest text-brand-500">Depo Bağlantısı</span>
            </div>
            <p className="text-xs text-brand-500" style={monoStyle}>
              {urunler.filter((item) => item.depoStokId).length} ürün bağlı · {stokList.length} stok kalemi
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {!secilen ? (
            <div className="px-8 py-12 text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Detay</p>
              <p className="mt-2 text-sm text-brand-600">Soldan bir urun secildiginde detay workspace burada acilir.</p>
            </div>
          ) : loadingDetail && !detail ? (
            <div className="mx-auto max-w-4xl p-5">
              <div className="border-2 border-brand-300 bg-white px-5 py-8 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Detay</p>
                <p className="mt-2 text-sm text-brand-600">Ürün detay çalışma alanı hazırlanıyor.</p>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl space-y-5 p-5">
              <div className={`overflow-hidden border-2 ${selectedMetal.border}`}>
                <div className={`${selectedMetal.bg} flex items-center justify-between gap-2 border-b-2 px-4 py-3 ${selectedMetal.border}`}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <Package className={`h-4 w-4 ${selectedMetal.text}`} />
                    <span className={`text-base font-black ${selectedMetal.text}`} style={monoStyle}>
                      Ürün #{secilen.urunNo}
                    </span>
                    <span className={`px-2 py-0.5 text-xs font-bold ${selectedStatus.bg} ${selectedStatus.text}`}>{secilen.durum}</span>
                    {secilen.depoStokId ? (
                      <span className="flex items-center gap-1 border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                        <Link2 className="h-3 w-3" />
                        Depo Bağlantılı
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {detail?.woocommerce_product_id ? (
                      <span className="border border-brand-300 bg-white px-2 py-0.5 text-xs font-black text-brand-500" style={monoStyle}>
                        Woo ID: {detail.woocommerce_product_id}
                      </span>
                    ) : null}
                    <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-xs font-bold ${selectedWoo.bg} ${selectedWoo.text}`}>
                      {selectedWoo.icon}
                      {detail?.is_published_to_site ? 'Yayında' : secilen.wooYayin}
                    </span>
                  </div>
                </div>

                <div className="bg-white">
                  <div className="grid grid-cols-2">
                    <FieldRow label="Tip">
                      <span className="text-sm font-bold text-brand-800">{secilen.tip}</span>
                    </FieldRow>
                    <FieldRow label="Metal">
                      <span className={`border px-1.5 py-0 text-sm font-black ${selectedMetal.bg} ${selectedMetal.text} ${selectedMetal.border}`}>{secilen.metal}</span>
                    </FieldRow>
                  </div>
                  <div className="grid grid-cols-2">
                    <FieldRow label="Ağırlık">
                      <span className="text-sm font-black text-brand-900" style={monoStyle}>
                        {formatNumber(detail?.weight_grams || secilen.agirlik, ' g')}
                      </span>
                    </FieldRow>
                    <FieldRow label="Ayar">
                      <span className="text-sm font-black text-brand-900" style={monoStyle}>
                        {detail?.purity_percentage ? `${Math.round(Number(detail.purity_percentage) * 10)} ‰` : `${secilen.ayar} ‰`}
                      </span>
                    </FieldRow>
                  </div>
                  <div className="grid grid-cols-2">
                    <FieldRow label="Alım Fiyatı">
                      <span className="text-sm font-black text-brand-900" style={monoStyle}>
                        {formatMoney(detail?.purchase_price_dkk || secilen.alimFiyati)}
                      </span>
                    </FieldRow>
                    <FieldRow label={`Saf ${secilen.metal}`}>
                      <span className="text-sm font-black text-emerald-800" style={monoStyle}>
                        {formatNumber(detail?.pure_gold_grams || secilen.safMetal, ' g')}
                      </span>
                    </FieldRow>
                  </div>
                  <div className="grid grid-cols-2">
                    <FieldRow label="Satıcı">
                      <span className="text-sm text-brand-700">{detail?.seller_name || secilen.satici || '—'}</span>
                    </FieldRow>
                    <FieldRow label="GDPR">
                      {detail?.is_gdpr_locked ? (
                        <span className="border border-red-300 bg-red-50 px-1.5 py-0.5 text-xs font-bold text-red-700">Kilitli</span>
                      ) : (
                        <span className="text-xs text-brand-400">Hayır</span>
                      )}
                    </FieldRow>
                  </div>
                  <div className="grid grid-cols-2">
                    <FieldRow label="Ref / Stok No">
                      <span className="text-sm font-black text-brand-900" style={monoStyle}>
                        {detail?.reference_number || secilen.stokNo || '-'}
                      </span>
                    </FieldRow>
                    <FieldRow label="Shop Durumu">
                      <span className="text-sm font-bold text-brand-700">{detail?.shop_sync_status || secilen.wooYayin}</span>
                    </FieldRow>
                  </div>
                </div>
              </div>

              <div className="overflow-hidden border border-brand-300">
                <div className="flex items-center gap-2 border-b border-brand-700 bg-brand-800 px-4 py-2.5">
                  <RefreshCw className="h-3.5 w-3.5 text-brand-400" />
                  <span className="text-xs font-black uppercase tracking-widest text-brand-300">Durum Senkronizasyonu</span>
                </div>
                <div className="bg-brand-50 px-4 py-3">
                  <p className="text-xs text-brand-600">Satışlar normalde POS ve WooCommerce webhook ile otomatik düşer. Buradan ürün bazlı manuel satış kontrolü tetikleyebilirsiniz.</p>

                  {detail?.manual_review_required ? (
                    <div className="mt-3 flex items-start gap-2 border border-amber-300 bg-amber-50 px-3 py-2">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-amber-800">Manuel review gerekiyor</p>
                        {detail.manual_review_reasons?.length ? (
                          <p className="text-xs text-amber-700">{detail.manual_review_reasons.join(' · ')}</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={syncSale}
                      disabled={!detail || isSyncing}
                      className="flex items-center gap-2 border border-brand-900 bg-brand-800 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-brand-900 disabled:opacity-60"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                      Woo Satışını Kontrol Et
                    </button>

                    <button
                      type="button"
                      onClick={approveManualReview}
                      disabled={!detail?.manual_review_required || isApprovingReview}
                      className="flex items-center gap-2 border border-brand-300 bg-white px-4 py-2 text-xs font-bold text-brand-700 hover:bg-brand-100 disabled:opacity-60"
                    >
                      {isApprovingReview ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Info className="h-3.5 w-3.5" />}
                      Manuel inceleme onayı
                    </button>

                    {lastSyncAt ? (
                      <span className="text-xs text-brand-400" style={monoStyle}>
                        Son: {formatDate(lastSyncAt)}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-2 text-xs italic text-brand-400">Not: Woo satış kontrolü son 30 gün siparişlerini tarar.</p>
                </div>
              </div>

              <div className="overflow-hidden border border-brand-300">
                <div className="flex items-center justify-between border-b border-brand-700 bg-brand-800 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="h-3.5 w-3.5 text-brand-400" />
                    <span className="text-xs font-black uppercase tracking-widest text-brand-300">Fotoğraflar</span>
                  </div>
                  <span className="text-xs text-brand-500" style={monoStyle}>
                    {detail?.photos.length || 0} fotoğraf
                  </span>
                </div>
                <div className="bg-white px-4 py-3">
                  <p className="mb-3 text-xs text-brand-500">Ürün görselleri burada tutulur. Yükleme sonrası Woo medya akışı bu kayıt üstünden çalışır.</p>

                  {detail?.photos.length ? (
                    <div className="mb-3 grid grid-cols-4 gap-3">
                      {detail.photos.map((photo, index) => (
                        <div key={photo.id || photo.url} className="group relative overflow-hidden border border-brand-200">
                          <img src={photo.avif_url || photo.url} alt={detail.display_name || secilen.urun} className="aspect-square w-full object-cover" />
                          {primaryPhotoLabel(index, photo.is_primary) ? (
                            <div className="absolute left-1 top-1 flex items-center gap-0.5 bg-amber-500 px-1 py-0.5">
                              <Star className="h-2.5 w-2.5 text-white" />
                              <span className="text-[9px] font-black text-white">Birincil</span>
                            </div>
                          ) : null}
                          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                            <button type="button" onClick={() => openExternal(photo.original_url || photo.url)} className="border border-white/40 bg-white/20 p-1.5 hover:bg-white/40">
                              <Eye className="h-3.5 w-3.5 text-white" />
                            </button>
                            {photo.id ? (
                              <button type="button" onClick={() => deletePhoto(photo.id!)} className="bg-red-500/80 p-1.5 hover:bg-red-600">
                                {isDeletingPhoto ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-white" /> : <Trash2 className="h-3.5 w-3.5 text-white" />}
                              </button>
                            ) : null}
                          </div>
                          <p className="truncate border-t border-brand-200 bg-brand-50 px-1.5 py-1 text-[10px] text-brand-500">{photo.filename || 'Fotoğraf'}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mb-3 border-2 border-dashed border-brand-200 px-6 py-8 text-center">
                      <CloudUpload className="mx-auto mb-2 h-8 w-8 text-brand-300" />
                      <p className="text-xs text-brand-400">Henüz fotoğraf yüklenmedi</p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => uploadInputRef.current?.click()}
                    className="flex items-center gap-2 border border-brand-800 bg-brand-700 px-4 py-2 text-xs font-bold text-white hover:bg-brand-800"
                  >
                    {isUploadingPhotos ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    Fotoğraf Yükle
                  </button>
                  <input ref={uploadInputRef} type="file" multiple className="hidden" onChange={onFilesSelected} />
                </div>
              </div>

              <div className="overflow-hidden border border-indigo-300">
                <div className="flex items-center gap-2 border-b border-indigo-700 bg-indigo-900 px-4 py-2.5">
                  <Bot className="h-3.5 w-3.5 text-indigo-300" />
                  <span className="text-xs font-black uppercase tracking-widest text-indigo-300">AI Açıklama + WooCommerce</span>
                </div>
                <div className="space-y-4 bg-white px-4 py-3">
                  <p className="text-xs text-brand-500">Önce Danca SEO paketini üretin, düzenleyip onaylayın. Ardından statik fiyatla WooCommerce&apos;e yayınlayın.</p>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={generateAi}
                      className="flex items-center gap-2 border border-indigo-900 bg-indigo-800 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-900"
                    >
                      {isGeneratingAi ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
                      {isGeneratingAi ? 'Üretiliyor...' : 'AI Açıklama Üret'}
                    </button>
                    <button
                      type="button"
                      onClick={() => saveAi(false)}
                      disabled={aiDraft.trim().length < 10}
                      className="flex items-center gap-2 border border-brand-300 bg-white px-4 py-2 text-xs font-bold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
                    >
                      {isSavingAi ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                      Kaydet
                    </button>
                    <button
                      type="button"
                      onClick={() => saveAi(true)}
                      disabled={aiDraft.trim().length < 10}
                      className="flex items-center gap-2 border border-emerald-700 bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                      Onayla
                    </button>
                    {detail?.ai_description_approved ? (
                      <span className="inline-flex items-center gap-1 border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                        <CheckCircle className="h-3 w-3" />
                        Onaylandı
                      </span>
                    ) : null}
                  </div>

                  <textarea
                    value={aiDraft}
                    onChange={(event) => setAiDraft(event.target.value)}
                    rows={5}
                    className="w-full border border-brand-300 px-3 py-2.5 text-sm text-brand-800 outline-none focus:border-indigo-500"
                    placeholder="Danca ürün açıklaması..."
                  />

                  <div className="overflow-hidden border border-brand-300">
                    <button
                      type="button"
                      onClick={() => setSeoGoster((current) => !current)}
                      className="flex w-full items-center justify-between border-b border-brand-300 bg-brand-100 px-4 py-2.5 hover:bg-brand-200"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 text-brand-600" />
                        <span className="text-xs font-black uppercase tracking-wider text-brand-700">SEO Paket Kontrolü</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {seoTamMi ? (
                          <span className="inline-flex items-center gap-1 border border-emerald-300 bg-emerald-100 px-1.5 py-0 text-xs font-bold text-emerald-800">
                            <CheckCircle className="h-3 w-3" />
                            Tam
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 border border-red-300 bg-red-50 px-1.5 py-0 text-xs font-bold text-red-700">
                            <AlertCircle className="h-3 w-3" />
                            {seoEksik.length} eksik
                          </span>
                        )}
                        <ChevronRight className={`h-3.5 w-3.5 text-brand-400 transition-transform ${seoGoster ? 'rotate-90' : ''}`} />
                      </div>
                    </button>

                    {seoGoster ? (
                      <div className="bg-white">
                        {!seoTamMi ? (
                          <div className="bg-red-50 px-4 py-2">
                            <p className="text-xs font-bold text-red-700">Eksik: {seoEksik.join(', ')}</p>
                          </div>
                        ) : null}
                        {(Object.keys(SEO_FIELD_LABELS) as (keyof SeoBundle)[]).map((key) => (
                          <FieldRow key={key} label={SEO_FIELD_LABELS[key]}>
                            {seoBundle[key] ? <p className="text-xs text-brand-800">{seoBundle[key]}</p> : <span className="text-xs font-bold text-red-500">—</span>}
                          </FieldRow>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-3 border border-brand-300 bg-brand-50 px-4 py-3">
                    <p className="text-xs font-black uppercase tracking-wider text-brand-700">Site Satış Fiyatı (DKK)</p>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        step="0.01"
                        value={publishPrice}
                        onChange={(event) => setPublishPrice(event.target.value)}
                        className="w-44 border border-brand-300 bg-white px-3 py-2 text-sm font-black text-brand-900 focus:border-amber-500 focus:outline-none"
                        style={monoStyle}
                      />
                      <span className="text-sm font-bold text-brand-500">DKK</span>
                    </div>

                    {!seoTamMi ? (
                      <div className="flex items-center gap-2 border border-red-200 bg-red-50 px-3 py-2">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                        <p className="text-xs text-red-700">SEO paketi tamamlanmadan yayınlayamazsınız.</p>
                      </div>
                    ) : null}

                    {!publishReady ? (
                      <div className="flex items-center gap-2 border border-amber-200 bg-amber-50 px-3 py-2">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                        <p className="text-xs text-amber-700">Yayın öncesi fotoğraf, AI onayı, manuel review ve fiyat alanlarını kontrol edin.</p>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={publish}
                        disabled={!detail || !publishReady || !seoTamMi || isPublishing}
                        className="flex items-center gap-2 border border-emerald-900 bg-emerald-700 px-5 py-2.5 text-xs font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isPublishing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
                        Siteye Yayınla
                      </button>

                      {detail?.is_published_to_site ? (
                        <button
                          type="button"
                          onClick={unpublish}
                          disabled={isUnpublishing}
                          className="flex items-center gap-2 border border-red-300 bg-white px-4 py-2.5 text-xs font-black text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {isUnpublishing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                          Yayından Kaldır
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="overflow-hidden border border-brand-200 bg-white">
                <div className="flex items-center justify-between border-b border-brand-200 bg-brand-50 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <History className="h-3.5 w-3.5 text-brand-500" />
                    <span className="text-xs font-black uppercase tracking-wider text-brand-500">Geçmiş ve Log</span>
                  </div>
                  <button type="button" onClick={() => setRawOpen((current) => !current)} className="inline-flex items-center gap-1 text-xs font-bold text-brand-700">
                    <Eye className="h-3.5 w-3.5" />
                    {rawOpen ? 'Woo raw gizle' : 'Woo raw aç'}
                  </button>
                </div>

                <div className="space-y-4 p-4">
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <History className="h-3.5 w-3.5 text-brand-500" />
                      <p className="text-xs font-black uppercase tracking-wider text-brand-500">Geçmiş</p>
                    </div>
                    <div className="space-y-2">
                      {history.slice(0, 5).map((entry) => (
                        <div key={entry.id} className="border border-brand-200 bg-brand-50 px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-black uppercase tracking-wider text-brand-700">{entry.action}</span>
                            <span className="text-[11px] text-brand-500" style={monoStyle}>
                              {formatDate(entry.created_at)}
                            </span>
                          </div>
                          {entry.notes ? <p className="mt-2 text-xs text-brand-600">{entry.notes}</p> : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <RefreshCw className="h-3.5 w-3.5 text-brand-500" />
                      <p className="text-xs font-black uppercase tracking-wider text-brand-500">Sync Log</p>
                    </div>
                    <div className="space-y-2">
                      {syncLog.slice(0, 5).map((entry) => (
                        <div key={entry.id} className="border border-brand-200 bg-brand-50 px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-black uppercase tracking-wider text-brand-700">{entry.action}</span>
                            <span className="text-[11px] font-bold text-brand-500">{entry.status}</span>
                          </div>
                          {entry.error_message ? <p className="mt-2 text-xs text-red-700">{entry.error_message}</p> : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  {rawOpen ? (
                    <div className="border border-brand-200 bg-brand-950 p-3 text-xs text-brand-200">
                      <pre className="overflow-auto whitespace-pre-wrap break-words" style={monoStyle}>
                        {JSON.stringify(rawData?.summary || rawData?.raw || {}, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {yeniPanelAcik ? (
        <YeniUrunPanel
          stokList={stokList}
          urunler={urunler}
          pending={isCreatingProduct}
          onKapat={() => setYeniPanelAcik(false)}
          onKaydet={async (draft) => {
            await createProductFromDraft(draft);
          }}
        />
      ) : null}
    </div>
  );
}
