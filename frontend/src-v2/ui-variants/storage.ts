import {
  UI_VARIANT_MODERN_BANNER_DISMISSED_KEY,
  UI_VARIANT_STORAGE_KEY,
  type UiVariant,
  type UiVariantStorageLike,
} from './types';

export type UiVariantStorageAdapter = {
  readVariant: () => UiVariant;
  writeVariant: (variant: UiVariant) => void;
  isModernBannerDismissed: () => boolean;
  dismissModernBanner: () => void;
  resetModernBannerDismissal: () => void;
};

export function isUiVariant(value: unknown): value is UiVariant {
  return value === 'classic' || value === 'modern';
}

function getBrowserStorage(): UiVariantStorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readRaw(storage?: UiVariantStorageLike | null, key?: string): string | null {
  if (!storage || !key) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(storage: UiVariantStorageLike | null | undefined, key: string, value: string) {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage write failures and keep runtime state in memory.
  }
}

function removeRaw(storage: UiVariantStorageLike | null | undefined, key: string) {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage removal failures and keep runtime state in memory.
  }
}

export function readStoredUiVariant(storage: UiVariantStorageLike | null = getBrowserStorage()): UiVariant {
  const value = readRaw(storage, UI_VARIANT_STORAGE_KEY);
  // v1/v2 belong to older builds and are deliberately ignored. Only an
  // explicit v3 choice can override the modern default in this build.
  if (isUiVariant(value)) return value;
  return 'modern';
}

export function persistUiVariant(
  variant: UiVariant,
  storage: UiVariantStorageLike | null = getBrowserStorage(),
) {
  writeRaw(storage, UI_VARIANT_STORAGE_KEY, variant);
}

export function isModernBannerDismissed(
  storage: UiVariantStorageLike | null = getBrowserStorage(),
): boolean {
  return readRaw(storage, UI_VARIANT_MODERN_BANNER_DISMISSED_KEY) === 'true';
}

export function persistModernBannerDismissed(
  storage: UiVariantStorageLike | null = getBrowserStorage(),
) {
  writeRaw(storage, UI_VARIANT_MODERN_BANNER_DISMISSED_KEY, 'true');
}

export function clearModernBannerDismissed(
  storage: UiVariantStorageLike | null = getBrowserStorage(),
) {
  removeRaw(storage, UI_VARIANT_MODERN_BANNER_DISMISSED_KEY);
}

export function createUiVariantStorage(
  storage: UiVariantStorageLike | null = getBrowserStorage(),
): UiVariantStorageAdapter {
  return {
    readVariant: () => readStoredUiVariant(storage),
    writeVariant: (variant) => persistUiVariant(variant, storage),
    isModernBannerDismissed: () => isModernBannerDismissed(storage),
    dismissModernBanner: () => persistModernBannerDismissed(storage),
    resetModernBannerDismissal: () => clearModernBannerDismissed(storage),
  };
}
