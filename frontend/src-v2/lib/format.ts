const money = new Intl.NumberFormat('da-DK', {
  style: 'currency',
  currency: 'DKK',
  maximumFractionDigits: 2,
});

const decimal = new Intl.NumberFormat('da-DK', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const shortDate = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatMoney(value?: string | number | null): string {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return money.format(numeric);
}

export function formatNumber(value?: string | number | null, suffix = ''): string {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return `${decimal.format(numeric)}${suffix}`;
}

export function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return shortDate.format(date);
}

export function labelTradeSide(value?: string | null): string {
  return value === 'sell_to_customer' ? 'Müşteriye Satış' : 'Müşteriden Alış';
}

export function labelStatus(value?: string | null): string {
  switch (value) {
    case 'confirmed':
      return 'Onaylandı';
    case 'cancelled':
      return 'İptal';
    case 'draft':
      return 'Taslak';
    default:
      return 'Bekliyor';
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
  return map[value || ''] || value || '-';
}

export function labelMetalType(value?: string | null): string {
  const map: Record<string, string> = {
    yellow_gold: 'Sarı Altın',
    white_gold: 'Beyaz Altın',
    silver: 'Gümüş',
    platinum: 'Platin',
    palladium: 'Palladyum',
  };
  return map[value || ''] || value || '-';
}

export function labelDocumentKind(value?: string | null): string {
  return value === 'faktura' ? 'Faktura' : 'Afregningsbilag';
}

export function labelOperationState(value?: string | null): string {
  const map: Record<string, string> = {
    awaiting_decision: 'Karar Bekliyor',
    in_inventory: 'Envanterde',
    undecided: 'Kararsız',
    melted: 'Eritildi',
    mixed: 'Karma',
  };
  return map[value || ''] || value || '-';
}

export function labelAfgClassification(value?: string | null): string {
  const map: Record<string, string> = {
    standard: 'Standart',
    jewelry_cleaning: 'Takı / Cleaning',
    white_gold: 'Beyaz Altın',
    separate_storage: 'Ayrı Depo',
  };
  return map[value || ''] || value || '-';
}

export function labelInventoryCategory(value?: string | null): string {
  const map: Record<string, string> = {
    kulce: 'Guldbarrer',
    sikke: 'Guldmønter',
    taki: 'Guldsmykker',
    gumus: 'Sølv',
    platin_pd: 'Platin / Pd',
  };
  return map[value || ''] || value || '-';
}

export function labelInventorySubcategory(value?: string | null): string {
  const map: Record<string, string> = {
    smykker: 'Smykker',
    barrer: 'Barrer',
    monter: 'Mønter',
    platin: 'Platin',
    palladyum: 'Palladyum',
  };
  return map[value || ''] || value || '-';
}

export function labelShopSyncStatus(value?: string | null): string {
  const map: Record<string, string> = {
    hazir: 'Hazır',
    mangler_foto: 'Mangler foto',
    listelendi: 'Listelendi',
  };
  return map[value || ''] || value || '-';
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
