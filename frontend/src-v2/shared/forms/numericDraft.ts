export type NumericDraftRules = {
  kind: 'decimal' | 'integer';
  required: boolean;
  allowNegative: boolean;
  min?: number;
  max?: number;
  precision?: number;
};

export type NumericDraftResult =
  | { ok: true; value: number | null; canonical: string }
  | { ok: false; error: string };

function normaliseDecimalSeparator(value: string) {
  return value.replace(',', '.');
}

export function formatNumericDraftValue(value: string | number | null | undefined, rules: NumericDraftRules) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return '';
  return rules.precision === undefined ? String(value) : value.toFixed(rules.precision);
}

export function parseNumericDraft(raw: string, rules: NumericDraftRules): NumericDraftResult {
  const value = raw.trim();
  if (!value) {
    return rules.required
      ? { ok: false, error: 'Bu alan zorunludur.' }
      : { ok: true, value: null, canonical: '' };
  }

  if (rules.kind === 'integer') {
    const integerPattern = rules.allowNegative ? /^-?\d+$/ : /^\d+$/;
    if (!integerPattern.test(value)) return { ok: false, error: 'Tam sayı girin.' };
  } else {
    const decimalPattern = rules.allowNegative
      ? /^-?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/
      : /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;
    if (!decimalPattern.test(value)) return { ok: false, error: 'Geçerli bir sayı girin.' };
  }

  const numeric = Number(normaliseDecimalSeparator(value));
  if (!Number.isFinite(numeric)) return { ok: false, error: 'Geçerli bir sayı girin.' };
  if (rules.min !== undefined && numeric < rules.min) return { ok: false, error: `En az ${rules.min} girin.` };
  if (rules.max !== undefined && numeric > rules.max) return { ok: false, error: `En fazla ${rules.max} girin.` };

  const canonical = rules.precision === undefined ? String(numeric) : numeric.toFixed(rules.precision);
  return { ok: true, value: numeric, canonical };
}
