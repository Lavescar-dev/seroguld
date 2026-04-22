import type { PosWorkspaceMarketRates } from '@/types';

export const AFG_UI_INPUT_PARITY = {
  customer: ['name', 'cpr_number', 'identity_doc_number', 'phone', 'email', 'address', 'postal_code', 'city'],
  payment: ['payment_method', 'reg_number', 'account_number'],
  marketRates: ['eur_dkk_fx', 'gold_24k_dkk', 'silver_dkk'],
  rowInputs: ['gram', 'avance_percent'],
} as const;

export const AFG_MARKET_RATE_FIELDS: ReadonlyArray<{
  key: keyof PosWorkspaceMarketRates;
  shortLabel: string;
  label: string;
  badgeClassName: string;
  valueClassName: string;
}> = [
  {
    key: 'gold_24k_dkk',
    shortLabel: 'Au',
    label: 'Altin 24K (DKK/g)',
    badgeClassName: 'mono bg-amber-100 px-1.5 py-0.5 font-black text-amber-800',
    valueClassName: 'mono font-bold text-brand-700',
  },
  {
    key: 'silver_dkk',
    shortLabel: 'Ag',
    label: 'Gumus (DKK/g)',
    badgeClassName: 'mono bg-slate-100 px-1.5 py-0.5 font-black text-slate-600',
    valueClassName: 'mono font-bold text-brand-700',
  },
] as const;
