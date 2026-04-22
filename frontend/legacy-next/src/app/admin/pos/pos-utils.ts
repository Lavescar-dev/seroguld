import type { CSSProperties } from 'react';

import { Customer, MetalType } from '@/types';
import {
  DEFAULT_INTERNAL_MARGIN_PERCENT,
  goldPurityPresets,
  platinumPalladiumPresets,
  silverPurityPresets,
} from './pos-config';
import { PosBulkDraftRow, PosMixDraftRow, PurityPreset } from './pos-types';

let bulkDraftRowSeq = 0;
let mixDraftRowSeq = 0;

export function inputValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

export function toNumberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

export function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function toNonNegativeNumberOrNull(value: string | number | null | undefined): number | null {
  const parsed = toNumberOrNull(value);
  if (parsed === null) return null;
  return parsed >= 0 ? parsed : null;
}

export function toBoundedNumberOrNull(
  value: string | number | null | undefined,
  min: number,
  max: number,
): number | null {
  const parsed = toNumberOrNull(value);
  if (parsed === null) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

export function formatDkk(value: string | number | null | undefined): string {
  const parsed = toNumberOrNull(value);
  if (parsed === null) return '-';
  return parsed.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function digitsOnly(value: string): string {
  return value.replace(/\D+/g, '');
}

export function isValidPhoneInput(value: string): boolean {
  const digits = digitsOnly(value);
  return digits.length >= 7 && digits.length <= 15;
}

export function isValidCprInput(value: string): boolean {
  return digitsOnly(value).length === 10;
}

export function normalizePurityInput(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(',', '.').replace('%', '').replace('‰', '');
}

export function purityPresetsForMetal(metal: MetalType | '' | null | undefined): PurityPreset[] {
  if (metal === 'yellow_gold' || metal === 'white_gold') return goldPurityPresets;
  if (metal === 'silver') return silverPurityPresets;
  if (metal === 'platinum' || metal === 'palladium') return platinumPalladiumPresets;
  return goldPurityPresets;
}

export function findPurityPreset(metal: MetalType | '' | null | undefined, rawValue: string): PurityPreset | null {
  const normalized = normalizePurityInput(rawValue);
  if (!normalized) return null;
  const presets = purityPresetsForMetal(metal);
  for (const preset of presets) {
    if (preset.aliases.some((alias) => normalizePurityInput(alias) === normalized)) {
      return preset;
    }
  }
  return null;
}

function normalizeText(value: string | null | undefined): string {
  return (value || '').toLocaleLowerCase('tr-TR').trim();
}

function fuzzyScoreText(target: string, query: string): number {
  const t = normalizeText(target);
  const q = normalizeText(query);
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 60;

  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i += 1) {
    if (t[i] === q[qi]) qi += 1;
  }
  if (qi === q.length) return 30;
  return 0;
}

export function customerFuzzyScore(customer: Customer, query: string): number {
  const nameScore = fuzzyScoreText(customer.name, query);
  const phoneScore = fuzzyScoreText(customer.phone || '', query);
  const emailScore = fuzzyScoreText(customer.email || '', query);
  const cprScore = fuzzyScoreText(customer.cpr_number_masked || '', query);

  return Math.max(nameScore + 15, phoneScore + 10, emailScore + 6, cprScore);
}

export function parseLooseNumber(raw: string | null | undefined): number | null {
  const text = (raw || '').trim();
  if (!text) return null;
  const normalized = text.replace(/\s+/g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return value;
}

export function normalizePurityPercentage(raw: string | null | undefined): number | null {
  const parsed = parseLooseNumber(raw);
  if (parsed === null) return null;
  let value = parsed;
  if (value > 100 && value <= 1000) {
    value = value / 10;
  }
  if (value <= 0 || value > 100) return null;
  return Number(value.toFixed(2));
}

export function defaultPuritySeedForMetal(metal: MetalType | '' | null | undefined): { karat: string; purity: string } {
  if (metal === 'silver') return { karat: '925', purity: '92.5' };
  if (metal === 'platinum' || metal === 'palladium') return { karat: '950', purity: '95' };
  return { karat: '18K', purity: '75' };
}

export function bulkRowColorClass(metal: MetalType | '' | null | undefined): string {
  if (metal === 'yellow_gold') return 'bg-amber-50';
  if (metal === 'white_gold') return 'bg-slate-50';
  if (metal === 'silver') return 'bg-zinc-50';
  if (metal === 'platinum') return 'bg-indigo-50';
  if (metal === 'palladium') return 'bg-emerald-50';
  return '';
}

export function metalSelectToneClass(metal: MetalType | '' | null | undefined): string {
  if (metal === 'yellow_gold') return 'border-amber-300 bg-amber-50 text-amber-800 focus:border-amber-400 focus:ring-amber-200';
  if (metal === 'white_gold') return 'border-slate-300 bg-slate-50 text-slate-700 focus:border-slate-400 focus:ring-slate-200';
  if (metal === 'silver') return 'border-zinc-300 bg-zinc-50 text-zinc-800 focus:border-zinc-400 focus:ring-zinc-200';
  if (metal === 'platinum') return 'border-indigo-300 bg-indigo-50 text-indigo-800 focus:border-indigo-400 focus:ring-indigo-200';
  if (metal === 'palladium') return 'border-emerald-300 bg-emerald-50 text-emerald-800 focus:border-emerald-400 focus:ring-emerald-200';
  return '';
}

export function metalOptionPrefix(metal: MetalType): string {
  if (metal === 'yellow_gold') return '●';
  if (metal === 'white_gold') return '◉';
  if (metal === 'silver') return '◍';
  if (metal === 'platinum') return '◆';
  return '⬢';
}

export function metalOptionStyle(metal: MetalType): CSSProperties {
  if (metal === 'yellow_gold') return { color: '#b45309' };
  if (metal === 'white_gold') return { color: '#475569' };
  if (metal === 'silver') return { color: '#3f3f46' };
  if (metal === 'platinum') return { color: '#4338ca' };
  return { color: '#047857' };
}

export function makeBulkDraftRow(
  seed?: Partial<Omit<PosBulkDraftRow, 'id'>>,
): PosBulkDraftRow {
  const seedMetal = seed?.metal_type || '';
  const seedPurity = defaultPuritySeedForMetal(seedMetal);
  bulkDraftRowSeq += 1;
  return {
    id: `bulk-row-${bulkDraftRowSeq}`,
    product_type: '',
    metal_type: seedMetal,
    weight_grams: '',
    purity_karat: seedPurity.karat,
    purity_percentage: seedPurity.purity,
    default_rate_dkk: '',
    rate_dkk: '',
    margin_percent_internal: String(DEFAULT_INTERNAL_MARGIN_PERCENT),
    notes: '',
    ...(seed || {}),
  };
}

export function makeMixDraftRow(seed?: Partial<Omit<PosMixDraftRow, 'id'>>): PosMixDraftRow {
  const seedMetal = seed?.metal_type || '';
  const seedPurity = defaultPuritySeedForMetal(seedMetal);
  mixDraftRowSeq += 1;
  return {
    id: `mix-row-${mixDraftRowSeq}`,
    metal_type: seedMetal,
    purity_karat: seedPurity.karat,
    purity_percentage: seedPurity.purity,
    weight_grams: '',
    notes: '',
    ...(seed || {}),
  };
}
