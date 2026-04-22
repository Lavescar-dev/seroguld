import { type Dispatch, type SetStateAction, useId } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

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

export function normalizeTextInput(value: string): string {
  return value.replace(',', '.');
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

export function syncMarketRateState(
  current: PosWorkspaceMarketRates,
  overrides?: Partial<Pick<PosWorkspaceMarketRates, 'eur_dkk_fx' | 'gold_rates_eur' | 'silver_rates_eur'>>,
): PosWorkspaceMarketRates {
  const eur_dkk_fx = normalizeTextInput(String(overrides?.eur_dkk_fx ?? current.eur_dkk_fx ?? '7.45'));
  const fx = parseDecimalValue(eur_dkk_fx) || 1;
  const goldRates = Object.fromEntries(
    GOLD_RATE_ORDER.map((key) => [
      key,
      formatMatrixRate(overrides?.gold_rates_eur?.[key] ?? current.gold_rates_eur?.[key] ?? '0'),
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
  const triggerClassName =
    variant === 'dark'
      ? 'flex items-center gap-2 border border-brand-600 bg-brand-950/40 px-3 py-2 text-[11px] font-black uppercase tracking-widest transition hover:bg-brand-900'
      : 'flex items-center gap-2 border border-brand-300 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest transition hover:bg-brand-50';
  const panelClassName =
    variant === 'dark'
      ? 'absolute right-0 top-full z-20 mt-2 w-[min(58rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] rounded-lg border border-brand-700 bg-brand-950 p-4 shadow-2xl'
      : 'absolute right-0 top-full z-20 mt-2 w-[min(58rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] rounded-lg border border-brand-200 bg-stone-50 p-4 shadow-[0_18px_48px_rgba(61,41,19,0.14)]';
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
      ? 'rounded-md border border-brand-700 bg-brand-900/70 p-4'
      : 'rounded-md border border-brand-200 bg-white/80 p-4';
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
  const fieldCardBodyClassName = 'flex flex-col gap-2.5';
  const fieldInputRowClassName = 'flex w-full items-center gap-2';
  const fieldTitleClassName =
    variant === 'dark'
      ? 'text-[17px] font-bold tracking-[-0.01em] text-white'
      : 'text-[17px] font-bold tracking-[-0.01em] text-brand-900';
  const fieldMetaClassName =
    variant === 'dark'
      ? 'mt-1 text-[12px] font-medium text-brand-400'
      : 'mt-1 text-[12px] font-medium text-brand-500';
  const fieldInputClassName =
    variant === 'dark'
      ? 'mono min-w-0 flex-1 rounded-sm border border-brand-600 bg-brand-900 px-3 py-2 text-right text-base font-semibold text-white outline-none focus:border-brand-400 focus:bg-brand-800'
      : 'mono min-w-0 flex-1 rounded-sm border border-brand-300 bg-white px-3 py-2 text-right text-base font-semibold text-brand-900 outline-none focus:border-brand-700 focus:bg-brand-50';
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
    setMarketRates((current) =>
      syncMarketRateState(current, {
        gold_rates_eur: {
          ...current.gold_rates_eur,
          [rateKey]: normalizeTextInput(value),
        },
      }),
    );
  };

  const updateSilverRate = (rateKey: string, value: string) => {
    setMarketRates((current) =>
      syncMarketRateState(current, {
        silver_rates_eur: {
          ...current.silver_rates_eur,
          [rateKey]: normalizeTextInput(value),
        },
      }),
    );
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
        <div id={panelId} className={panelClassName}>
          <div className="mb-3">
            <p className={headingClassName}>Gunluk Piyasa Fiyatlari</p>
            <p className={sectionMetaClassName}>EUR truth burada tutulur. Workbook Variable værdier ve AFG satır fiyatları aynı state&apos;ten beslenir.</p>
          </div>
          <div className="space-y-3">
            <div className={sectionClassName}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className={fieldTitleClassName}>EUR / DKK FX</p>
                  <p className={fieldMetaClassName}>Canlı dönüşüm kuru</p>
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto sm:min-w-[12rem]">
                  <label htmlFor={`${panelId}-fx`} className="sr-only">
                    EUR / DKK FX
                  </label>
                  <input
                    id={`${panelId}-fx`}
                    type="text"
                    value={marketRates.eur_dkk_fx}
                    onChange={(event) =>
                      setMarketRates((current) =>
                        syncMarketRateState(current, { eur_dkk_fx: normalizeTextInput(event.target.value) }),
                      )
                    }
                    className={fieldInputClassName}
                  />
                  <span className={unitClassName}>FX</span>
                </div>
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]">
              <div className={sectionClassName}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className={sectionTitleClassName}>Gold EUR / G</p>
                    <p className={sectionMetaClassName}>Altın karat fiyatları</p>
                  </div>
                  <span className={sectionCountClassName}>7 karat</span>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
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
                            value={marketRates.gold_rates_eur?.[row.key] || ''}
                            onChange={(event) => updateGoldRate(row.key, event.target.value)}
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
                            value={marketRates.silver_rates_eur?.[row.key] || ''}
                            onChange={(event) => updateSilverRate(row.key, event.target.value)}
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
