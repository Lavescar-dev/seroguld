import type { AfgWorkspaceDocument, AfgWorkspaceLine } from '@/types';

import { defaultClassification, defaultDestination, type LineDraft, type SplitGroupKey } from './types';

// Klasik LogPage'ten çıkarılan saf yardımcılar — klasik ve modern yüzey aynı
// taslak çözümleme/ayrıştırma mantığını paylaşır.

export function toFloat(value?: string | number | null) {
  if (typeof value === 'number') return value;
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sumLines(lines: AfgWorkspaceLine[]) {
  return lines.reduce(
    (sum, line) => ({
      weight: sum.weight + toFloat(line.weight_grams),
      amount: sum.amount + toFloat(line.line_total_dkk),
      pure: sum.pure + toFloat(line.pure_gold_grams),
    }),
    { weight: 0, amount: 0, pure: 0 },
  );
}

export function resolveLineDraft(line: AfgWorkspaceLine, drafts: Record<string, LineDraft>): LineDraft {
  return (
    drafts[line.id] || {
      classification: defaultClassification(line),
      note: line.product_notes || '',
      destination: defaultDestination(line),
    }
  );
}

export function lineHasPendingChange(line: AfgWorkspaceLine, drafts: Record<string, LineDraft>) {
  const draft = resolveLineDraft(line, drafts);
  return (
    draft.classification !== defaultClassification(line) ||
    draft.destination !== defaultDestination(line) ||
    draft.note.trim() !== (line.product_notes || '').trim()
  );
}

export function splitGroupKeyForDraft(draft: LineDraft): SplitGroupKey | null {
  if (draft.destination !== 'inventory') return null;
  if (draft.classification === 'white_gold') return 'white_gold';
  if (draft.classification === 'separate_storage') return 'separate_storage';
  return 'jewelry_cleaning';
}

export function buildBucketGroups(documents: AfgWorkspaceDocument[], drafts: Record<string, LineDraft>) {
  const groups: Record<SplitGroupKey, AfgWorkspaceLine[]> = {
    jewelry_cleaning: [],
    white_gold: [],
    separate_storage: [],
  };

  for (const document of documents) {
    for (const line of document.lines) {
      const splitKey = splitGroupKeyForDraft(resolveLineDraft(line, drafts));
      if (splitKey === 'jewelry_cleaning') {
        groups.jewelry_cleaning.push(line);
      } else if (splitKey === 'white_gold') {
        groups.white_gold.push(line);
      } else if (splitKey === 'separate_storage') {
        groups.separate_storage.push(line);
      }
    }
  }

  return groups;
}
