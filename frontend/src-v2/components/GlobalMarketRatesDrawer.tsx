import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, LockKeyhole, Save, X } from 'lucide-react';

import { apiRequest } from '@/lib/api';
import { GOLD_MATRIX_ROWS, SILVER_MATRIX_ROWS, formatDecimalFixed, parseDecimalValue, syncMarketRateState } from '@/make/alis/marketRates';
import type { PosWorkspaceMarketRates } from '@/types';

export interface GlobalRateMeta {
  source: 'manual' | 'live' | 'fallback' | string;
  observed_at?: string | null;
  stale?: boolean;
}

// Kanonik operatör birimi DKK/g. Canlı mod yalnız oto değerleri (fx, Pt, Pd)
// besler; altın/gümüş/bar/Plet alanları her zaman elle düzenlenebilir.
export interface GlobalMarketRateProfile {
  eur_dkk_fx: string;
  gold_rates_dkk: Record<string, string>;
  silver_rates_dkk: Record<string, string>;
  gold_24k_dkk: string;
  silver_dkk: string;
  plet_dkk: string;
  gold_bar_dkk: string;
  silver_bar_dkk: string;
  platinum_dkk: string;
  palladium_dkk: string;
  live_enabled: boolean;
  source: 'manual' | 'live' | 'mixed' | string;
  // Alan bazında oto durumu (eur_dkk_fx / platinum_dkk / palladium_dkk).
  live_fields?: Record<string, boolean>;
  rate_meta?: Record<string, GlobalRateMeta>;
}

export interface GlobalMarketRateDraft extends GlobalMarketRateProfile {
  gold_matrix: PosWorkspaceMarketRates['gold_matrix'];
  silver_matrix: PosWorkspaceMarketRates['silver_matrix'];
}

export interface GlobalMarketRatesController {
  profile: GlobalMarketRateProfile;
  draft: GlobalMarketRateDraft;
  isOpen: boolean;
  isLoading: boolean;
  isSaving: boolean;
  errorMessage: string | null;
  open: () => void;
  close: () => void;
  save: () => void;
  updateFx: (value: string) => void;
  updateGoldRate: (key: string, value: string) => void;
  updateSilverRate: (key: string, value: string) => void;
  updatePlatinum: (value: string) => void;
  updatePalladium: (value: string) => void;
  updatePlet: (value: string) => void;
  updateGoldBar: (value: string) => void;
  updateSilverBar: (value: string) => void;
}

const SILVER_PROFILE_ROWS = SILVER_MATRIX_ROWS.filter((row) => row.key !== '800');

function buildFallbackProfile(): GlobalMarketRateProfile {
  const gold24 = 615.5;
  const silver999 = 7.8;
  return {
    eur_dkk_fx: '7.45',
    gold_rates_dkk: Object.fromEntries(GOLD_MATRIX_ROWS.map((row) => [row.key, ((gold24 * Number(row.key)) / 24).toFixed(2)])),
    silver_rates_dkk: Object.fromEntries(SILVER_PROFILE_ROWS.map((row) => [row.key, ((silver999 * Number(row.key)) / 999).toFixed(2)])),
    gold_24k_dkk: gold24.toFixed(2),
    silver_dkk: silver999.toFixed(2),
    plet_dkk: '0.02',
    gold_bar_dkk: gold24.toFixed(2),
    silver_bar_dkk: silver999.toFixed(2),
    platinum_dkk: '280.00',
    palladium_dkk: '335.00',
    live_enabled: false,
    source: 'manual',
    rate_meta: {},
  };
}

function toDraft(profile: GlobalMarketRateProfile): GlobalMarketRateDraft {
  const workspace = syncMarketRateState({
    eur_dkk_fx: profile.eur_dkk_fx,
    gold_rates_dkk: profile.gold_rates_dkk,
    silver_rates_dkk: profile.silver_rates_dkk,
    gold_24k_dkk: profile.gold_24k_dkk,
    silver_dkk: profile.silver_dkk,
    gold_matrix: [],
    silver_matrix: [],
  });
  return { ...profile, ...workspace, silver_rates_dkk: { ...profile.silver_rates_dkk } };
}

function validPositive(value: string) {
  return parseDecimalValue(value) > 0;
}

function toTopbarValue(value: string) {
  const parsed = parseDecimalValue(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2).replace(/\.00$/, '') : '—';
}

export function useGlobalMarketRates(): GlobalMarketRatesController {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['market-rates', 'defaults'],
    queryFn: () => apiRequest<GlobalMarketRateProfile>('/api/v2/market-rates/defaults'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const fallback = useMemo(buildFallbackProfile, []);
  const profile = query.data ? { ...fallback, ...query.data } : fallback;
  const [draft, setDraft] = useState<GlobalMarketRateDraft>(() => toDraft(fallback));
  const [isOpen, setIsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen && query.data) {
      setDraft(toDraft({ ...fallback, ...query.data }));
    }
  }, [fallback, isOpen, query.data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const committed = syncMarketRateState(draft as PosWorkspaceMarketRates, {
        eur_dkk_fx: draft.eur_dkk_fx,
        gold_rates_dkk: draft.gold_rates_dkk,
        silver_rates_dkk: draft.silver_rates_dkk,
      });
      return apiRequest<GlobalMarketRateProfile>('/api/v2/market-rates/defaults', {
        method: 'PUT',
        body: JSON.stringify({
          eur_dkk_fx: committed.eur_dkk_fx,
          gold_rates_dkk: committed.gold_rates_dkk,
          silver_rates_dkk: Object.fromEntries(
            SILVER_PROFILE_ROWS.map((row) => [row.key, committed.silver_rates_dkk[row.key] || '0']),
          ),
          plet_dkk: parseDecimalValue(draft.plet_dkk).toFixed(2),
          gold_bar_dkk: parseDecimalValue(draft.gold_bar_dkk).toFixed(2),
          silver_bar_dkk: parseDecimalValue(draft.silver_bar_dkk).toFixed(2),
          platinum_dkk: parseDecimalValue(draft.platinum_dkk).toFixed(2),
          palladium_dkk: parseDecimalValue(draft.palladium_dkk).toFixed(2),
        }),
      });
    },
    onSuccess: (nextProfile) => {
      queryClient.setQueryData(['market-rates', 'defaults'], nextProfile);
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['settings-v2'] });
      setErrorMessage(null);
      setIsOpen(false);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Oranlar kaydedilemedi.');
    },
  });

  const open = () => {
    setDraft(toDraft(profile));
    setErrorMessage(null);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setErrorMessage(null);
  };

  const updateFx = (value: string) => {
    setDraft((current) => ({ ...current, eur_dkk_fx: value }));
  };

  const updateGoldRate = (key: string, value: string) => {
    setDraft((current) => ({ ...current, gold_rates_dkk: { ...current.gold_rates_dkk, [key]: value } }));
  };

  const updateSilverRate = (key: string, value: string) => {
    setDraft((current) => ({ ...current, silver_rates_dkk: { ...current.silver_rates_dkk, [key]: value } }));
  };

  // Canlı mod manuel alanları kilitlemez; yalnız fx/Pt/Pd oto olur.
  const canSave = validPositive(draft.eur_dkk_fx)
    && validPositive(draft.platinum_dkk)
    && validPositive(draft.palladium_dkk)
    && validPositive(draft.plet_dkk)
    && validPositive(draft.gold_bar_dkk)
    && validPositive(draft.silver_bar_dkk)
    && GOLD_MATRIX_ROWS.every((row) => validPositive(draft.gold_rates_dkk[row.key]))
    && SILVER_PROFILE_ROWS.every((row) => validPositive(draft.silver_rates_dkk[row.key]));

  return {
    profile,
    draft,
    isOpen,
    isLoading: query.isLoading,
    isSaving: saveMutation.isPending,
    errorMessage: errorMessage || (query.isError ? 'Global oran profiline ulaşılamadı.' : null),
    open,
    close,
    save: () => {
      if (canSave) saveMutation.mutate();
    },
    updateFx,
    updateGoldRate,
    updateSilverRate,
    updatePlatinum: (value) => setDraft((current) => ({ ...current, platinum_dkk: value })),
    updatePalladium: (value) => setDraft((current) => ({ ...current, palladium_dkk: value })),
    updatePlet: (value) => setDraft((current) => ({ ...current, plet_dkk: value })),
    updateGoldBar: (value) => setDraft((current) => ({ ...current, gold_bar_dkk: value })),
    updateSilverBar: (value) => setDraft((current) => ({ ...current, silver_bar_dkk: value })),
  };
}

function TextRateInput({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <input
      type="text"
      inputMode="decimal"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-sg-sm border border-sg-border bg-sg-surface px-3 py-2 text-sm font-semibold text-sg-text outline-none transition focus:border-sg-accent disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}

function RateMetaChip({ meta, dark }: { meta: GlobalRateMeta | undefined; dark: boolean }) {
  if (!meta) return null;
  const stale = Boolean(meta.stale) || meta.source === 'fallback';
  const label = meta.source === 'manual'
    ? 'manuel'
    : stale
      ? `bayat${meta.observed_at ? ` · ${meta.observed_at}` : ''}`
      : `canlı${meta.observed_at ? ` · ${meta.observed_at}` : ''}`;
  const tone = stale
    ? (dark ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-amber-300 bg-amber-50 text-amber-800')
    : meta.source === 'manual'
      ? (dark ? 'border-brand-200 bg-white text-brand-600' : 'border-sg-border bg-sg-surface text-sg-text-soft')
      : 'border-emerald-300 bg-emerald-50 text-emerald-800';
  return <span className={`inline-flex max-w-full items-center truncate rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}>{label}</span>;
}

export function GlobalMarketRatesDrawer({ controller, variant = 'modern' }: { controller: GlobalMarketRatesController; variant?: 'modern' | 'classic' }) {
  if (!controller.isOpen) return null;
  const { draft } = controller;
  const dark = variant === 'classic';
  const panelClass = dark
    ? 'fixed inset-y-0 right-0 z-[100] flex w-full max-w-[680px] flex-col border-l-2 border-brand-300 bg-[#f8f3eb] text-brand-900 shadow-2xl'
    : 'fixed inset-y-0 right-0 z-[100] flex w-full max-w-[680px] flex-col border-l border-sg-border bg-sg-surface text-sg-text shadow-2xl';
  const titleClass = dark ? 'text-lg font-black uppercase tracking-wider text-brand-900' : 'text-xl font-semibold text-sg-text';
  const sectionClass = dark ? 'border border-brand-200 bg-white p-4' : 'rounded-sg-md border border-sg-border bg-sg-surface-soft p-4';
  const metaClass = dark ? 'text-xs text-brand-600' : 'text-sm text-sg-text-soft';
  // Canlı mod yalnız oto değerleri (fx, Pt, Pd) kilitler — alan bazında:
  // Ayarlar'da otomatikten çıkarılan alan manuel düzenlenebilir kalır.
  const liveFields = draft.live_fields || {};
  const fieldAutoDisabled = (key: 'eur_dkk_fx' | 'platinum_dkk' | 'palladium_dkk') =>
    draft.live_enabled && (liveFields[key] ?? true);
  const anyAutoDisabled =
    fieldAutoDisabled('eur_dkk_fx') || fieldAutoDisabled('platinum_dkk') || fieldAutoDisabled('palladium_dkk');
  const rateMeta = draft.rate_meta || {};

  return (
    <div className="fixed inset-0 z-[99] bg-black/30" onClick={controller.close}>
      <aside className={panelClass} role="dialog" aria-modal="true" aria-labelledby="global-market-rates-title" onClick={(event) => event.stopPropagation()}>
        <header className={`flex items-start justify-between gap-4 border-b px-5 py-4 ${dark ? 'border-brand-200' : 'border-sg-border'}`}>
          <div>
            <p className={dark ? 'text-[10px] font-black uppercase tracking-[0.22em] text-brand-500' : 'text-[11px] font-semibold uppercase tracking-[0.18em] text-sg-accent'}>Global varsayılanlar</p>
            <h2 id="global-market-rates-title" className={`mt-1 ${titleClass}`}>Piyasa oranları</h2>
            <p className={`mt-1 ${metaClass}`}>Tüm alanlar DKK/g. Yeni alışlar bu profili başlangıç snapshot’ı olarak kullanır.</p>
          </div>
          <button type="button" onClick={controller.close} className={dark ? 'border border-brand-300 bg-white p-2 text-brand-700 hover:bg-brand-50' : 'rounded-sg-sm border border-sg-border p-2 text-sg-text-soft hover:bg-sg-surface-soft'} aria-label="Piyasa oranları çekmecesini kapat">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className={`flex items-start gap-3 border p-3 ${anyAutoDisabled ? (dark ? 'border-sky-300 bg-sky-50' : 'rounded-sg-md border-sg-blue/30 bg-sg-blue-soft') : (dark ? 'border-amber-300 bg-amber-50' : 'rounded-sg-md border-sg-accent/30 bg-sg-accent-soft')}`}>
            {anyAutoDisabled ? <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}
            <div>
              <p className="text-sm font-semibold">{anyAutoDisabled ? 'Canlı oto değerler açık' : 'Manuel oran profili'}</p>
              <p className={`mt-1 ${metaClass}`}>{anyAutoDisabled ? 'Otomatik işaretli alanlar (kur/platin/palladyum) canlı gelir; işareti kaldırılanlar ve altın/gümüş/bar/Plet her zaman elle belirlenir.' : 'Değişiklikler yalnız Kaydet düğmesine bastığınızda uygulanır.'}</p>
            </div>
          </div>

          {controller.errorMessage ? (
            <div className={`flex items-start gap-3 border p-3 ${dark ? 'border-red-300 bg-red-50 text-red-800' : 'rounded-sg-md border-red-200 bg-red-50 text-red-800'}`}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-sm">{controller.errorMessage}</p>
            </div>
          ) : null}

          <section className={sectionClass}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><p className="text-sm font-semibold">Altın karatları</p><p className={metaClass}>DKK/g</p></div>
              <span className={metaClass}>24K: {formatDecimalFixed(draft.gold_24k_dkk)} DKK/g</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {GOLD_MATRIX_ROWS.map((row) => (
                <label key={row.key} className="space-y-1">
                  <span className={`block text-xs font-semibold ${dark ? 'text-brand-600' : 'text-sg-text-soft'}`}>{row.label} · {row.lodighed}</span>
                  <TextRateInput value={draft.gold_rates_dkk[row.key] || ''} disabled={false} onChange={(value) => controller.updateGoldRate(row.key, value)} />
                </label>
              ))}
            </div>
          </section>

          <section className={sectionClass}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><p className="text-sm font-semibold">Gümüş saflıkları</p><p className={metaClass}>DKK/g</p></div>
              <span className={metaClass}>999: {formatDecimalFixed(draft.silver_dkk)} DKK/g</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {SILVER_PROFILE_ROWS.map((row) => (
                <label key={row.key} className="space-y-1">
                  <span className={`block text-xs font-semibold ${dark ? 'text-brand-600' : 'text-sg-text-soft'}`}>{row.label} · {row.lodighed}</span>
                  <TextRateInput value={draft.silver_rates_dkk[row.key] || ''} disabled={false} onChange={(value) => controller.updateSilverRate(row.key, value)} />
                </label>
              ))}
            </div>
          </section>

          <section className={sectionClass}>
            <p className="mb-3 text-sm font-semibold">Bar ve Plet fiyatları</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1"><span className={`block text-xs font-semibold ${dark ? 'text-brand-600' : 'text-sg-text-soft'}`}>Guldbarre 999,9 DKK/g</span><TextRateInput value={draft.gold_bar_dkk} disabled={false} onChange={controller.updateGoldBar} /></label>
              <label className="space-y-1"><span className={`block text-xs font-semibold ${dark ? 'text-brand-600' : 'text-sg-text-soft'}`}>Sølvbarre 999 DKK/g</span><TextRateInput value={draft.silver_bar_dkk} disabled={false} onChange={controller.updateSilverBar} /></label>
              <label className="space-y-1"><span className={`block text-xs font-semibold ${dark ? 'text-brand-600' : 'text-sg-text-soft'}`}>Pletsølv DKK/g</span><TextRateInput value={draft.plet_dkk} disabled={false} onChange={controller.updatePlet} /></label>
            </div>
            <p className={`mt-2 ${metaClass}`}>Bar fiyatları normal karat/saflık fiyatlarından bağımsızdır; Plet saflık oranıyla hesaplanmaz.</p>
          </section>

          <section className={sectionClass}>
            <p className="mb-3 text-sm font-semibold">Oto değerler (kur ve diğer metaller)</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1">
                <span className={`flex items-center justify-between gap-2 text-xs font-semibold ${dark ? 'text-brand-600' : 'text-sg-text-soft'}`}><span>EUR / DKK</span><RateMetaChip meta={rateMeta.eur_dkk_fx} dark={dark} /></span>
                <TextRateInput value={draft.eur_dkk_fx} disabled={fieldAutoDisabled('eur_dkk_fx')} onChange={controller.updateFx} />
              </label>
              <label className="space-y-1">
                <span className={`flex items-center justify-between gap-2 text-xs font-semibold ${dark ? 'text-brand-600' : 'text-sg-text-soft'}`}><span>Platin DKK/g</span><RateMetaChip meta={rateMeta.platinum_dkk} dark={dark} /></span>
                <TextRateInput value={draft.platinum_dkk} disabled={fieldAutoDisabled('platinum_dkk')} onChange={controller.updatePlatinum} />
              </label>
              <label className="space-y-1">
                <span className={`flex items-center justify-between gap-2 text-xs font-semibold ${dark ? 'text-brand-600' : 'text-sg-text-soft'}`}><span>Palladyum DKK/g</span><RateMetaChip meta={rateMeta.palladium_dkk} dark={dark} /></span>
                <TextRateInput value={draft.palladium_dkk} disabled={fieldAutoDisabled('palladium_dkk')} onChange={controller.updatePalladium} />
              </label>
            </div>
          </section>

          {anyAutoDisabled ? <a href="/settings" className={dark ? 'inline-flex border border-brand-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-wider text-brand-700' : 'inline-flex rounded-sg-sm border border-sg-border px-3 py-2 text-sm font-semibold text-sg-accent-dark'}>Ayarları aç</a> : null}
        </div>

        <footer className={`flex items-center justify-end gap-2 border-t px-5 py-4 ${dark ? 'border-brand-200' : 'border-sg-border'}`}>
          <button type="button" onClick={controller.close} className={dark ? 'border border-brand-300 bg-white px-4 py-2 text-sm font-bold text-brand-700' : 'rounded-sg-sm border border-sg-border px-4 py-2 text-sm font-semibold text-sg-text'}>Vazgeç</button>
          <button type="button" onClick={controller.save} disabled={controller.isSaving} className={dark ? 'inline-flex items-center gap-2 bg-brand-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-50' : 'inline-flex items-center gap-2 rounded-sg-sm bg-sg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50'}>
            <Save className="h-4 w-4" />{controller.isSaving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </footer>
      </aside>
    </div>
  );
}

export { toTopbarValue };
