import { getActiveLocale, translate } from '@/i18n';
import { translateVisibleCopy } from '@/i18n/copy';

function copy(value: string): string {
  return translateVisibleCopy(value, getActiveLocale());
}

function intlLocale() {
  const locale = getActiveLocale();
  return locale === 'en' ? 'en-GB' : locale === 'da' ? 'da-DK' : 'tr-TR';
}

export function formatMoney(value?: string | number | null): string {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: 'DKK', maximumFractionDigits: 2 }).format(numeric);
}

export function formatNumber(value?: string | number | null, suffix = ''): string {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return `${new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric)}${suffix}`;
}

export function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function formatRelativeTime(value?: string | null, now: Date = new Date()): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const diffMs = now.getTime() - date.getTime();
  const future = diffMs < 0;
  const absSec = Math.abs(Math.floor(diffMs / 1000));
  // Keep dashboard labels deterministic (two days should not become the
  // locale-specific “evvelsi gün” special case).
  const relative = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'always' });
  const direction = future ? 1 : -1;
  if (absSec < 30) return copy('şimdi');
  if (absSec < 60) return relative.format(direction * absSec, 'second');
  const min = Math.floor(absSec / 60);
  if (min < 60) return relative.format(direction * min, 'minute');
  const hr = Math.floor(min / 60);
  if (hr < 24) return relative.format(direction * hr, 'hour');
  const day = Math.floor(hr / 24);
  if (day < 30) return relative.format(direction * day, 'day');
  const month = Math.floor(day / 30);
  if (month < 12) return relative.format(direction * month, 'month');
  const year = Math.floor(day / 365);
  return relative.format(direction * year, 'year');
}

export function labelTradeSide(value?: string | null): string {
  return translate(value === 'sell_to_customer' ? 'labels.trade.sell' : 'labels.trade.buy');
}

export function labelStatus(value?: string | null): string {
  switch (value) {
    case 'confirmed':
      return copy('Onaylandı');
    case 'cancelled':
      return copy('İptal');
    case 'draft':
      return copy('Taslak');
    default:
      return copy('Bekliyor');
  }
}

export function labelProductType(value?: string | null): string {
  const map: Record<string, string> = {
    bracelet: 'Bilezik',
    ring: 'Yüzük',
    necklace: 'Kolye',
    earring: 'Küpe',
    chain: 'Zincir',
    bar: 'Külçe',
    jewelry: 'Takı',
  };
  const label = map[value || ''];
  return label ? copy(label) : value || '-';
}

export function labelMetalType(value?: string | null): string {
  const map: Record<string, string> = {
    yellow_gold: 'Sarı Altın',
    white_gold: 'Beyaz Altın',
    silver: 'Gümüş',
    platinum: 'Platin',
    palladium: 'Palladyum',
  };
  const label = map[value || ''];
  return label ? copy(label) : value || '-';
}

export function labelMetalDanish(value?: string | null): string {
  // Danca metal adları locale'den bağımsız tek gösterim adıdır; copy()
  // çevirisinden geçirilirse tr locale bunları tekrar Türkçeye çevirip
  // "Altın · Guld" ikiliğini geri getirir.
  const map: Record<string, string> = {
    yellow_gold: 'Guld',
    white_gold: 'Hvidguld',
    silver: 'Sølv',
    platinum: 'Platin',
    palladium: 'Palladium',
  };
  return map[value || ''] || value || '-';
}

export function labelDocumentKind(value?: string | null): string {
  return copy(value === 'faktura' ? 'Faktura' : 'Afregningsbilag');
}

export function labelOperationState(value?: string | null): string {
  const map: Record<string, string> = {
    awaiting_decision: 'Karar Bekliyor',
    in_inventory: 'Envanterde',
    undecided: 'Kararsız',
    melted: 'Eritildi',
    mixed: 'Karma',
  };
  const label = map[value || ''];
  return label ? copy(label) : value || '-';
}

export function labelAfgClassification(value?: string | null): string {
  const map: Record<string, string> = {
    standard: 'Standart',
    jewelry_cleaning: 'Takı / Cleaning',
    white_gold: 'Beyaz Altın',
    separate_storage: 'Ayrı Depo',
  };
  const label = map[value || ''];
  return label ? copy(label) : value || '-';
}

export function labelInventoryCategory(value?: string | null): string {
  const map: Record<string, string> = {
    kulce: 'Guldbarrer',
    sikke: 'Guldmønter',
    taki: 'Guldsmykker',
    gumus: 'Sølv',
    platin_pd: 'Platin / Pd',
  };
  const label = map[value || ''];
  return label ? copy(label) : value || '-';
}

export function labelInventorySubcategory(value?: string | null): string {
  const map: Record<string, string> = {
    smykker: 'Smykker',
    barrer: 'Barrer',
    monter: 'Mønter',
    platin: 'Platin',
    palladyum: 'Palladyum',
  };
  const label = map[value || ''];
  return label ? copy(label) : value || '-';
}

export function labelShopSyncStatus(value?: string | null): string {
  const map: Record<string, string> = {
    hazir: 'Hazır',
    mangler_foto: 'Mangler foto',
    listelendi: 'Listelendi',
  };
  const label = map[value || ''];
  return label ? copy(label) : value || '-';
}

export function statusTone(value?: string | null): string {
  switch (value) {
    case 'confirmed':
    case 'in_inventory':
      return 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30';
    case 'cancelled':
    case 'melted':
      return 'bg-rose-500/15 text-rose-200 border-rose-400/30';
    case 'undecided':
      return 'bg-violet-500/15 text-violet-200 border-violet-400/30';
    case 'awaiting_decision':
    case 'draft':
    default:
      return 'bg-amber-500/15 text-amber-200 border-amber-400/30';
  }
}
