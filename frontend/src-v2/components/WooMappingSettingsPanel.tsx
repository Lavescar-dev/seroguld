import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';

import { apiRequest, localizeApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';

type WooMappingSettings = {
  category_map_json: string;
  stonex_meta_map_json: string;
  badge_meta_json: string;
  desc_footer_html: string;
  desc_footer_enabled: boolean;
  primary_term_meta_key: string;
};

const QUERY_KEY = ['settings', 'woocommerce-mappings'] as const;

function prettyJson(raw: string): string {
  if (!raw.trim()) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function validateJsonDraft(raw: string): string | null {
  if (!raw.trim()) return null;
  try {
    JSON.parse(raw);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Geçersiz JSON';
  }
}

export function WooMappingSettingsPanel({ variant }: { variant: 'classic' | 'modern' }) {
  const classic = variant === 'classic';
  const toast = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiRequest<WooMappingSettings>('/api/settings/woocommerce'),
  });

  const [draft, setDraft] = useState<WooMappingSettings | null>(null);
  useEffect(() => {
    if (settingsQuery.data && draft === null) {
      setDraft({
        ...settingsQuery.data,
        category_map_json: prettyJson(settingsQuery.data.category_map_json),
        stonex_meta_map_json: prettyJson(settingsQuery.data.stonex_meta_map_json),
        badge_meta_json: prettyJson(settingsQuery.data.badge_meta_json),
      });
    }
  }, [settingsQuery.data, draft]);

  const saveMutation = useMutation({
    mutationFn: (payload: WooMappingSettings) =>
      apiRequest<WooMappingSettings>('/api/settings/woocommerce', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success('WooCommerce eşlemeleri kaydedildi.');
    },
    onError: (error) => toast.error(localizeApiError(error)),
  });

  if (!draft) return null;

  const jsonErrors = {
    category_map_json: validateJsonDraft(draft.category_map_json),
    stonex_meta_map_json: validateJsonDraft(draft.stonex_meta_map_json),
    badge_meta_json: validateJsonDraft(draft.badge_meta_json),
  };
  const hasJsonError = Object.values(jsonErrors).some(Boolean);

  const inputClass = classic
    ? 'w-full border border-brand-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-700'
    : 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500';
  const areaClass = `${inputClass} min-h-32 font-mono text-xs leading-5`;
  const labelClass = 'text-xs font-semibold uppercase tracking-wide text-slate-500';

  const jsonField = (
    key: 'category_map_json' | 'stonex_meta_map_json' | 'badge_meta_json',
    label: string,
    hint: string,
  ) => (
    <div>
      <label className={labelClass} htmlFor={`woo-map-${key}`}>{label}</label>
      <p className="mb-1 mt-0.5 text-xs text-slate-500">{hint}</p>
      <textarea
        id={`woo-map-${key}`}
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
        className={areaClass}
        spellCheck={false}
        placeholder="{ }"
      />
      {jsonErrors[key] ? <p role="alert" className="mt-1 text-xs text-rose-700">Geçersiz JSON: {jsonErrors[key]}</p> : null}
    </div>
  );

  return (
    <section className={`mt-8 border-t pt-6 ${classic ? 'border-brand-200' : 'border-slate-200'}`}>
      <h3 className="text-sm font-semibold">WooCommerce Eşlemeleri</h3>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
        Site kategori ID'leri ile StoneX / rozet meta anahtarlarının haritaları. Siteye erişimi olan
        bilgisayarda <code className="text-xs">python -m app.tools.probe_woocommerce_site</code> aracını
        çalıştırın ve bastığı JSON taslaklarını buraya yapıştırın. Boş bırakılan harita, yayında ilgili
        özelliği atlar ve uyarı üretir.
      </p>
      <div className="mt-4 grid max-w-4xl gap-5">
        {jsonField('category_map_json', 'Kategori haritası (JSON)', 'Takı/külçe/sikke → site kategori ID\'leri + karat kategorileri.')}
        {jsonField('stonex_meta_map_json', 'StoneX meta haritası (JSON)', 'Mantıksal alan → WP meta anahtarı (metal_type, metal_weight, metal_purity…).')}
        {jsonField('badge_meta_json', 'Yeni ürün rozeti (JSON)', '"Ny vare" rozeti + 30 günlük zamanlama meta anahtarları.')}
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="woo-map-primary-key">Primer kategori meta anahtarı</label>
            <input
              id="woo-map-primary-key"
              value={draft.primary_term_meta_key}
              onChange={(event) => setDraft({ ...draft, primary_term_meta_key: event.target.value })}
              className={`${inputClass} mt-1`}
            />
          </div>
          <label className="mt-5 inline-flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={draft.desc_footer_enabled}
              onChange={(event) => setDraft({ ...draft, desc_footer_enabled: event.target.checked })}
            />
            Takı açıklamalarına sabit Danca blok eklensin
          </label>
        </div>
        <div>
          <label className={labelClass} htmlFor="woo-map-footer">Açıklama alt bloğu (HTML — boş bırakılırsa gömülü varsayılan kullanılır)</label>
          <textarea
            id="woo-map-footer"
            value={draft.desc_footer_html}
            onChange={(event) => setDraft({ ...draft, desc_footer_html: event.target.value })}
            className={areaClass}
            spellCheck={false}
            placeholder="<h3>Vi garanterer altid pæne varer</h3>…"
          />
        </div>
        <div>
          <button
            type="button"
            disabled={saveMutation.isPending || hasJsonError}
            onClick={() => saveMutation.mutate(draft)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-60 ${classic ? 'bg-brand-800 hover:bg-brand-900' : 'rounded-lg bg-blue-600 hover:bg-blue-700'}`}
          >
            <Save className="h-4 w-4" /> {saveMutation.isPending ? 'Kaydediliyor' : 'Eşlemeleri kaydet'}
          </button>
        </div>
      </div>
    </section>
  );
}
