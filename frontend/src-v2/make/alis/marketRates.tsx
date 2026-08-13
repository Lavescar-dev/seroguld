import { type Dispatch, type SetStateAction, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

import { formatNumber } from '@/lib/format';
import type { PosWorkspaceMarketRates } from '@/types';

export const GOLD_MATRIX_ROWS = [
  { key: '8', label: '8K', lodighed: '333' },
  { key: '14', label: '14K', lodighed: '585' },
  { key: '18', label: '18K', lodighed: '750' },
  { key: '21', label: '21K', lodighed: '875' },
  { key: '21.6', label: '21.6K', lodighed: '900' },
  { key: '22', label: '22K', lodighed: '917' },
  { key: '24', label: '24K', lodighed: '999' },
] as const;

export const SILVER_MATRIX_ROWS = [
  { key: '999', label: 'Finsølv', lodighed: '999' },
  { key: '925', label: 'Sterling sølv', lodighed: '925' },
  { key: '830', label: '3 tårnet sølv', lodighed: '830' },
  { key: '800', label: 'Sølv', lodighed: '800' },
] as const;

const GOLD_RATE_ORDER = ['8', '14', '18', '21', '21.6', '22', '24'] as const;
const SILVER_RATE_ORDER = ['999', '925', '830', '800'] as const;
type MatrixRateDrafts = { fx: string; gold: Record<string, string>; silver: Record<string, string> };

export function normalizeTextInput(value: string): string {
  // Virgül -> nokta + işaret (minus) karakterini kaldır.
  // Alış akışında negatif gram/oran anlamlı değil; kullanıcı UI'da '-' yazsa bile
  // state'e sayısal olarak yazılır, downstream hesaplar pozitif/sıfır olur.
  return value.replace(',', '.').replace(/-/g, '');
}

export function parseDecimalValue(value: string | number | null | undefined) {
  const numeric = Number(normalizeTextInput(String(value ?? '0')));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function formatDecimalFixed(value: string | number | null | undefined) {
  return parseDecimalValue(value).toFixed(2);
}

function formatMatrixRate(value: string | number | null | undefined) {
  return parseDecimalValue(value).toFixed(4);
}

function formatRatePlaceholder(value: string | number | null | undefined) {
  const text = String(value ?? '').trim();
  if (!text || parseDecimalValue(text) === 0) {
    return '0.0000';
  }
  return text;
}

function buildEmptyMatrixRateDrafts(): MatrixRateDrafts {
  return {
    fx: '',
    gold: Object.fromEntries(GOLD_RATE_ORDER.map((key) => [key, ''])) as Record<string, string>,
    silver: Object.fromEntries(SILVER_RATE_ORDER.map((key) => [key, ''])) as Record<string, string>,
  };
}

export function syncMarketRateState(
  current: PosWorkspaceMarketRates,
  overrides?: Partial<Pick<PosWorkspaceMarketRates, 'eur_dkk_fx' | 'gold_24k_dkk' | 'gold_rates_eur' | 'silver_rates_eur'>>,
): PosWorkspaceMarketRates {
  const eur_dkk_fx = normalizeTextInput(String(overrides?.eur_dkk_fx ?? current.eur_dkk_fx ?? '7.45'));
  const fx = parseDecimalValue(eur_dkk_fx) || 1;
  const gold24DkkOverride = overrides?.gold_24k_dkk;
  const gold24EurOverride = gold24DkkOverride === undefined
    ? null
    : parseDecimalValue(gold24DkkOverride) / fx;
  const goldRates = Object.fromEntries(
    GOLD_RATE_ORDER.map((key) => [
      key,
      formatMatrixRate(
        gold24EurOverride === null
          ? overrides?.gold_rates_eur?.[key] ?? current.gold_rates_eur?.[key] ?? '0'
          : gold24EurOverride * (parseDecimalValue(key) / 24),
      ),
    ]),
  ) as Record<string, string>;
  const silverRates = Object.fromEntries(
    SILVER_RATE_ORDER.map((key) => [
      key,
      formatMatrixRate(overrides?.silver_rates_eur?.[key] ?? current.silver_rates_eur?.[key] ?? '0'),
    ]),
  ) as Record<string, string>;
  return {
    ...current,
    eur_dkk_fx,
    gold_rates_eur: goldRates,
    silver_rates_eur: silverRates,
    gold_24k_dkk: formatDecimalFixed(parseDecimalValue(goldRates['24']) * fx),
    silver_dkk: formatDecimalFixed(parseDecimalValue(silverRates['999']) * fx),
    gold_matrix: [
      { row_key: 'gold:8', label: '8K', lodighed: '333', eur_per_gram: goldRates['8'], dkk_per_gram: formatDecimalFixed(parseDecimalValue(goldRates['8']) * fx), karat: '8.00', type_code: '1' },
      { row_key: 'gold:14', label: '14K', lodighed: '585', eur_per_gram: goldRates['14'], dkk_per_gram: formatDecimalFixed(parseDecimalValue(goldRates['14']) * fx), karat: '14.00', type_code: '1' },
      { row_key: 'gold:18', label: '18K', lodighed: '750', eur_per_gram: goldRates['18'], dkk_per_gram: formatDecimalFixed(parseDecimalValue(goldRates['18']) * fx), karat: '18.00', type_code: '1' },
      { row_key: 'gold:21', label: '21K', lodighed: '875', eur_per_gram: goldRates['21'], dkk_per_gram: formatDecimalFixed(parseDecimalValue(goldRates['21']) * fx), karat: '21.00', type_code: '1' },
      { row_key: 'gold:21.6', label: '21.6K', lodighed: '900', eur_per_gram: goldRates['21.6'], dkk_per_gram: formatDecimalFixed(parseDecimalValue(goldRates['21.6']) * fx), karat: '21.60', type_code: '1' },
      { row_key: 'gold:22', label: '22K', lodighed: '917', eur_per_gram: goldRates['22'], dkk_per_gram: formatDecimalFixed(parseDecimalValue(goldRates['22']) * fx), karat: '22.00', type_code: '1' },
      { row_key: 'gold:24', label: '24K', lodighed: '999', eur_per_gram: goldRates['24'], dkk_per_gram: formatDecimalFixed(parseDecimalValue(goldRates['24']) * fx), karat: '24.00', type_code: '1' },
    ],
    silver_matrix: [
      { row_key: 'silver:2', label: 'Finsølv', lodighed: '999', eur_per_gram: silverRates['999'], dkk_per_gram: formatDecimalFixed(parseDecimalValue(silverRates['999']) * fx), karat: null, type_code: '2' },
      { row_key: 'silver:3', label: 'Sterling sølv', lodighed: '925', eur_per_gram: silverRates['925'], dkk_per_gram: formatDecimalFixed(parseDecimalValue(silverRates['925']) * fx), karat: null, type_code: '3' },
      { row_key: 'silver:4', label: '3 tårnet sølv', lodighed: '830', eur_per_gram: silverRates['830'], dkk_per_gram: formatDecimalFixed(parseDecimalValue(silverRates['830']) * fx), karat: null, type_code: '4' },
      { row_key: 'silver:5', label: 'Sølv', lodighed: '800', eur_per_gram: silverRates['800'], dkk_per_gram: formatDecimalFixed(parseDecimalValue(silverRates['800']) * fx), karat: null, type_code: '5' },
    ],
  };
}

export function MarketRatesEditor({
  marketRates,
  setMarketRates,
  priceOpen,
  setPriceOpen,
  variant = 'light',
}: {
  marketRates: PosWorkspaceMarketRates;
  setMarketRates: Dispatch<SetStateAction<PosWorkspaceMarketRates>>;
  priceOpen: boolean;
  setPriceOpen: Dispatch<SetStateAction<boolean>>;
  variant?: 'light' | 'dark';
}) {
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [activeRateField, setActiveRateField] = useState<string | null>(null);
  const [rateDrafts, setRateDrafts] = useState<MatrixRateDrafts>(() => buildEmptyMatrixRateDrafts());

  useEffect(() => {
    if (!activeRateField) {
      setRateDrafts(buildEmptyMatrixRateDrafts());
    }
  }, [activeRateField, marketRates]);

  useEffect(() => {
    if (priceOpen) {
      panelRef.current?.scrollTo({ top: 0, left: 0 });
    }
  }, [priceOpen]);

  const triggerClassName =
    variant === 'dark'
      ? 'flex max-w-full flex-wrap items-center gap-2 border border-brand-600 bg-brand-950/40 px-3 py-2 text-[11px] font-black uppercase tracking-widest transition hover:bg-brand-900'
      : 'flex max-w-full flex-wrap items-center gap-2 border border-brand-300 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest transition hover:bg-brand-50';
  const panelClassName =
    variant === 'dark'
      ? 'fixed inset-x-2 bottom-3 top-[4.75rem] z-[80] overflow-y-auto rounded-lg border border-brand-700 bg-brand-950 p-3 shadow-2xl overscroll-contain sm:inset-x-4 sm:p-4 min-[1180px]:absolute min-[1180px]:inset-auto min-[1180px]:right-0 min-[1180px]:top-full min-[1180px]:mt-2 min-[1180px]:max-h-[min(42rem,calc(100dvh-5rem))] min-[1180px]:w-[min(58rem,calc(100vw-1rem))]'
      : 'fixed inset-x-2 bottom-3 top-[4.75rem] z-[80] overflow-y-auto rounded-lg border border-brand-200 bg-stone-50 p-3 shadow-[0_18px_48px_rgba(61,41,19,0.14)] overscroll-contain sm:inset-x-4 sm:p-4 min-[1180px]:absolute min-[1180px]:inset-auto min-[1180px]:right-0 min-[1180px]:top-full min-[1180px]:mt-2 min-[1180px]:max-h-[min(42rem,calc(100dvh-5rem))] min-[1180px]:w-[min(58rem,calc(100vw-1rem))]';
  const headingClassName =
    variant === 'dark'
      ? 'text-xs font-black uppercase tracking-[0.16em] text-brand-100'
      : 'text-xs font-black uppercase tracking-[0.16em] text-brand-700';
  const submitClassName =
    variant === 'dark'
      ? 'inline-flex min-w-32 items-center justify-center rounded-sm bg-brand-700 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white transition hover:bg-brand-600'
      : 'inline-flex min-w-32 items-center justify-center rounded-sm bg-brand-800 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white transition hover:bg-brand-900';
  const sectionClassName =
    variant === 'dark'
      ? 'rounded-md border border-brand-700 bg-brand-900/70 p-3 sm:p-4'
      : 'rounded-md border border-brand-200 bg-white/80 p-3 sm:p-4';
  const sectionTitleClassName =
    variant === 'dark'
      ? 'text-[11px] font-black uppercase tracking-[0.14em] text-brand-300'
      : 'text-[11px] font-black uppercase tracking-[0.14em] text-brand-600';
  const sectionMetaClassName =
    variant === 'dark'
      ? 'text-[13px] leading-5 text-brand-300'
      : 'text-[13px] leading-5 text-brand-500';
  const fieldCardClassName =
    variant === 'dark'
      ? 'rounded-sm border border-brand-700/90 bg-brand-950/55 px-3 py-3'
      : 'rounded-sm border border-brand-200 bg-white px-3 py-3';
  const fieldCardBodyClassName = 'flex min-w-0 flex-col gap-2.5';
  const fieldInputRowClassName = 'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2';
  const fieldTitleClassName =
    variant === 'dark'
      ? 'text-[15px] font-bold text-white sm:text-[17px]'
      : 'text-[15px] font-bold text-brand-900 sm:text-[17px]';
  const fieldMetaClassName =
    variant === 'dark'
      ? 'mt-1 text-[12px] font-medium text-brand-400'
      : 'mt-1 text-[12px] font-medium text-brand-500';
  const fieldInputClassName =
    variant === 'dark'
      ? 'mono min-w-0 rounded-sm border border-brand-600 bg-brand-900 px-3 py-2 text-right text-base font-semibold text-white outline-none focus:border-brand-400 focus:bg-brand-800'
      : 'mono min-w-0 rounded-sm border border-brand-300 bg-white px-3 py-2 text-right text-base font-semibold text-brand-900 outline-none focus:border-brand-700 focus:bg-brand-50';
  const unitClassName =
    variant === 'dark'
      ? 'inline-flex shrink-0 items-center rounded-sm border border-brand-700 bg-brand-900 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-brand-300'
      : 'inline-flex shrink-0 items-center rounded-sm border border-brand-200 bg-stone-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-brand-500';
  const sectionCountClassName =
    variant === 'dark'
      ? 'inline-flex shrink-0 items-center rounded-sm border border-brand-700 bg-brand-950/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-brand-300'
      : 'inline-flex shrink-0 items-center rounded-sm border border-brand-200 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-brand-500';
  const footerClassName =
    variant === 'dark'
      ? 'flex flex-wrap items-center justify-between gap-3 border-t border-brand-800 pt-3'
      : 'flex flex-wrap items-center justify-between gap-3 border-t border-brand-200 pt-3';

  const updateGoldRate = (rateKey: string, value: string) => {
    setRateDrafts((current) => ({
      ...current,
      gold: {
        ...current.gold,
        [rateKey]: value,
      },
    }));
  };

  const updateSilverRate = (rateKey: string, value: string) => {
    setRateDrafts((current) => ({
      ...current,
      silver: {
        ...current.silver,
        [rateKey]: value,
      },
    }));
  };

  const commitGoldRate = (rateKey: string, value: string) => {
    if (parseDecimalValue(value) <= 0) return false;
    setMarketRates((current) => syncMarketRateState(current, {
      gold_rates_eur: { ...current.gold_rates_eur, [rateKey]: value },
    }));
    return true;
  };

  const commitSilverRate = (rateKey: string, value: string) => {
    if (parseDecimalValue(value) <= 0) return false;
    setMarketRates((current) => syncMarketRateState(current, {
      silver_rates_eur: { ...current.silver_rates_eur, [rateKey]: value },
    }));
    return true;
  };

  const updateFx = (value: string) => {
    setRateDrafts((current) => ({ ...current, fx: value }));
  };

  const commitFx = (value: string) => {
    if (parseDecimalValue(value) <= 0) return false;
    setMarketRates((current) => syncMarketRateState(current, { eur_dkk_fx: value }));
    return true;
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setPriceOpen((current) => !current)}
        className={triggerClassName}
        aria-expanded={priceOpen}
        aria-controls={panelId}
      >
        <span className="inline-flex items-center gap-1">
          <span className="mono bg-sky-100 px-1.5 py-0.5 font-black text-sky-800">FX</span>
          <span className={variant === 'dark' ? 'mono font-bold text-white' : 'mono font-bold text-brand-700'}>
            {formatNumber(marketRates.eur_dkk_fx)}
          </span>
        </span>
        <span className={variant === 'dark' ? 'text-brand-500' : 'text-brand-300'}>·</span>
        <span className="inline-flex items-center gap-1">
          <span className="mono bg-amber-100 px-1.5 py-0.5 font-black text-amber-800">Au 24K</span>
          <span className={variant === 'dark' ? 'mono font-bold text-white' : 'mono font-bold text-brand-700'}>
            {formatNumber(marketRates.gold_rates_eur?.['24'])} EUR
          </span>
        </span>
        <span className={variant === 'dark' ? 'text-brand-500' : 'text-brand-300'}>·</span>
        <span className="inline-flex items-center gap-1">
          <span className="mono bg-slate-100 px-1.5 py-0.5 font-black text-slate-700">Ag 999</span>
          <span className={variant === 'dark' ? 'mono font-bold text-white' : 'mono font-bold text-brand-700'}>
            {formatNumber(marketRates.silver_rates_eur?.['999'])} EUR
          </span>
        </span>
        {priceOpen ? <ChevronUp className="h-3.5 w-3.5 text-brand-500" /> : <ChevronDown className="h-3.5 w-3.5 text-brand-500" />}
      </button>

      {priceOpen ? (
        <div ref={panelRef} id={panelId} className={panelClassName}>
          <div
            className={`sticky top-0 z-10 -mx-3 -mt-3 mb-3 flex items-start justify-between gap-3 border-b px-3 py-3 sm:-mx-4 sm:-mt-4 sm:px-4 ${
              variant === 'dark' ? 'border-brand-700 bg-brand-950' : 'border-brand-200 bg-stone-50'
            }`}
          >
            <div className="min-w-0">
              <p className={headingClassName}>Gunluk Piyasa Fiyatlari</p>
              <p className={`${sectionMetaClassName} mt-1`}>EUR truth burada tutulur. Workbook Variable værdier ve AFG satır fiyatları aynı state&apos;ten beslenir.</p>
            </div>
            <button
              type="button"
              onClick={() => setPriceOpen(false)}
              className={`shrink-0 rounded-sm border p-2 transition ${
                variant === 'dark'
                  ? 'border-brand-700 bg-brand-900 text-brand-200 hover:bg-brand-800'
                  : 'border-brand-200 bg-white text-brand-700 hover:bg-brand-50'
              }`}
              aria-label="Piyasa fiyatları panelini kapat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div className={sectionClassName}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className={fieldTitleClassName}>EUR / DKK FX</p>
                  <p className={fieldMetaClassName}>Canlı dönüşüm kuru</p>
                </div>
                <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:w-[min(100%,18rem)]">
                  <label htmlFor={`${panelId}-fx`} className="sr-only">
                    EUR / DKK FX
                  </label>
                  <input
                    id={`${panelId}-fx`}
                    type="text"
                    value={activeRateField === 'fx' ? rateDrafts.fx : marketRates.eur_dkk_fx}
                    onFocus={() => {
                      setActiveRateField('fx');
                      setRateDrafts((current) => ({ ...current, fx: current.fx || marketRates.eur_dkk_fx }));
                    }}
                    onChange={(event) => updateFx(event.target.value)}
                    onBlur={(event) => {
                      if (commitFx(event.currentTarget.value)) setActiveRateField(null);
                    }}
                    className={fieldInputClassName}
                  />
                  <span className={unitClassName}>FX</span>
                </div>
              </div>
            </div>

            <div className="grid gap-3 min-[1180px]:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]">
              <div className={sectionClassName}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className={sectionTitleClassName}>Gold EUR / G</p>
                    <p className={sectionMetaClassName}>Altın karat fiyatları</p>
                  </div>
                  <span className={sectionCountClassName}>7 karat</span>
                </div>
                <div className="grid gap-2 lg:grid-cols-2">
                  {GOLD_MATRIX_ROWS.map((row) => (
                    <div key={row.key} className={fieldCardClassName}>
                      <div className={fieldCardBodyClassName}>
                        <div className="min-w-0">
                          <p className={fieldTitleClassName}>{row.label}</p>
                          <p className={fieldMetaClassName}>{row.lodighed}‰ saflık</p>
                        </div>
                        <div className={fieldInputRowClassName}>
                          <label htmlFor={`${panelId}-gold-${row.key}`} className="sr-only">
                            {row.label} Gold EUR / G
                          </label>
                          <input
                            id={`${panelId}-gold-${row.key}`}
                            type="text"
                            value={activeRateField === `gold:${row.key}` ? rateDrafts.gold[row.key] ?? '' : marketRates.gold_rates_eur?.[row.key] ?? ''}
                            placeholder={formatRatePlaceholder(marketRates.gold_rates_eur?.[row.key])}
                            onChange={(event) => updateGoldRate(row.key, event.target.value)}
                            onFocus={() => {
                              setActiveRateField(`gold:${row.key}`);
                              setRateDrafts((current) => ({ ...current, gold: { ...current.gold, [row.key]: current.gold[row.key] || marketRates.gold_rates_eur?.[row.key] || '' } }));
                            }}
                            onBlur={(event) => {
                              if (commitGoldRate(row.key, event.currentTarget.value)) setActiveRateField(null);
                            }}
                            className={fieldInputClassName}
                            aria-label={`${row.label} Gold EUR / G`}
                          />
                          <span className={unitClassName}>EUR/g</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={sectionClassName}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className={sectionTitleClassName}>Silver EUR / G</p>
                    <p className={sectionMetaClassName}>Gümüş fineness fiyatları</p>
                  </div>
                  <span className={sectionCountClassName}>4 fineness</span>
                </div>
                <div className="grid gap-2">
                  {SILVER_MATRIX_ROWS.map((row) => (
                    <div key={row.key} className={fieldCardClassName}>
                      <div className={fieldCardBodyClassName}>
                        <div className="min-w-0">
                          <p className={fieldTitleClassName}>{row.label}</p>
                          <p className={fieldMetaClassName}>{row.lodighed}‰ fineness</p>
                        </div>
                        <div className={fieldInputRowClassName}>
                          <label htmlFor={`${panelId}-silver-${row.key}`} className="sr-only">
                            {row.label} EUR / G
                          </label>
                          <input
                            id={`${panelId}-silver-${row.key}`}
                            type="text"
                            value={activeRateField === `silver:${row.key}` ? rateDrafts.silver[row.key] ?? '' : marketRates.silver_rates_eur?.[row.key] ?? ''}
                            placeholder={formatRatePlaceholder(marketRates.silver_rates_eur?.[row.key])}
                            onChange={(event) => updateSilverRate(row.key, event.target.value)}
                            onFocus={() => {
                              setActiveRateField(`silver:${row.key}`);
                              setRateDrafts((current) => ({ ...current, silver: { ...current.silver, [row.key]: current.silver[row.key] || marketRates.silver_rates_eur?.[row.key] || '' } }));
                            }}
                            onBlur={(event) => {
                              if (commitSilverRate(row.key, event.currentTarget.value)) setActiveRateField(null);
                            }}
                            className={fieldInputClassName}
                            aria-label={`${row.label} EUR / G`}
                          />
                          <span className={unitClassName}>EUR/g</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className={footerClassName}>
              <p className={sectionMetaClassName}>Değerler anında uygulanır. Bu buton yalnız paneli kapatır.</p>
              <button
                type="button"
                onClick={() => setPriceOpen(false)}
                className={submitClassName}
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
