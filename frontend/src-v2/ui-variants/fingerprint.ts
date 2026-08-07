import type { UiVariant } from './types';

export type UiVariantRootFingerprintInput = {
  variant: UiVariant;
  route?: string | null;
  hash?: string | null;
  frontendMode?: string | null;
  frontendBuiltAt?: string | null;
};

function sanitizeFingerprintPart(value?: string | null): string {
  const trimmed = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[|]/g, '/');
  return trimmed || '—';
}

export function normalizeHashRoute(hash?: string | null): string {
  const trimmed = String(hash ?? '').trim();
  if (!trimmed || trimmed === '#') return '/';
  if (trimmed.startsWith('#/')) return trimmed.slice(1);
  if (trimmed.startsWith('#')) return `/${trimmed.slice(1)}`;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function getCurrentHash(): string {
  if (typeof window === 'undefined') return '#/';
  return window.location.hash || '#/';
}

export function getCurrentHashRoute(): string {
  return normalizeHashRoute(getCurrentHash());
}

export function buildUiVariantRootFingerprint({
  variant,
  route,
  hash,
  frontendMode,
  frontendBuiltAt,
}: UiVariantRootFingerprintInput): string {
  const resolvedHash = hash ?? (route ? `#${route}` : getCurrentHash());
  const resolvedRoute = route ?? normalizeHashRoute(resolvedHash);

  return [
    `variant:${sanitizeFingerprintPart(variant)}`,
    `route:${sanitizeFingerprintPart(resolvedRoute)}`,
    `hash:${sanitizeFingerprintPart(resolvedHash)}`,
    `frontend:${sanitizeFingerprintPart(frontendMode)}`,
    `built:${sanitizeFingerprintPart(frontendBuiltAt)}`,
  ].join('|');
}

export function getUiVariantRootAttributes(input: UiVariantRootFingerprintInput) {
  return {
    'data-ui-variant': input.variant,
    'data-ui-fingerprint': buildUiVariantRootFingerprint(input),
  };
}
