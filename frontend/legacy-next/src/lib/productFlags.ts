import { Product } from '@/types';

const COIN_SOURCE_TAG = '[SOURCE_TYPE:coin]';
const MANUAL_REVIEW_PREFIX = '[MANUAL_REVIEW:';

export function isCoinSourceProduct(product: Product): boolean {
  if ((product.import_source_type || '').toLowerCase() === 'coin') return true;
  const notes = String(product.notes || '').toLowerCase();
  return notes.includes(COIN_SOURCE_TAG.toLowerCase());
}

export function getManualReviewReasons(product: Product): string[] {
  if (Array.isArray(product.manual_review_reasons) && product.manual_review_reasons.length) {
    return product.manual_review_reasons;
  }
  const text = String(product.notes || '');
  const start = text.indexOf(MANUAL_REVIEW_PREFIX);
  if (start < 0) return [];
  const end = text.indexOf(']', start);
  if (end < 0) return [];
  const marker = text.slice(start, end + 1);
  const raw = marker.replace(MANUAL_REVIEW_PREFIX, '').replace(']', '').trim();
  if (!raw) return ['manual_review'];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isManualReviewRequired(product: Product): boolean {
  if (typeof product.manual_review_required === 'boolean') return product.manual_review_required;
  return getManualReviewReasons(product).length > 0;
}

