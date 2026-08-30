// Ayrım Board — Classic SplitGroupCard (LogPage.tsx:1084-1104, 1465-1551) paritesi.
// 3 grup kartı: S (Kuyum/cleaning, amber), H (Beyaz altın, blue), D (Ayrı depo, accent).
// Satırlar staging (draft) değerleriyle canlı gruplanır: splitGroupKeyForDraft.
import { useMemo } from 'react';

import { formatNumber } from '@/lib/format';
import { buildBucketGroups, lineHasPendingChange, resolveLineDraft, sumLines } from '@/make/log/lineHelpers';
import type { LineDraft, RouteDestination, SplitGroupKey } from '@/make/log/types';
import { ModernSection } from '@/modern/modules/shared';
import type { AfgWorkspaceDocument, AfgWorkspaceLine } from '@/types';

import {
  LineClassificationSelect,
  LineGdprNote,
  LineNoteInput,
  LinePendingBadge,
  LineStateBadge,
  RouteButtonGroup,
  type RouteLineHandler,
} from './LineControls';
import { SPLIT_GROUP_META } from './labels';

const SPLIT_KEYS: SplitGroupKey[] = ['jewelry_cleaning', 'white_gold', 'separate_storage'];

export interface SplitBoardProps {
  documents: AfgWorkspaceDocument[];
  lineDrafts: Record<string, LineDraft>;
  routeBusy: boolean;
  /** Has birimi etiketi — gümüş defterinde 'saf' (pureUnit karşılığı). */
  pureUnit?: 'has' | 'saf';
  onDraftChange: (lineId: string, patch: Partial<LineDraft>) => void;
  onRoute: (line: AfgWorkspaceLine, destination: RouteDestination) => void;
}

export function SplitBoard({ documents, lineDrafts, routeBusy, pureUnit = 'has', onDraftChange, onRoute }: SplitBoardProps) {
  const groups = useMemo(() => buildBucketGroups(documents, lineDrafts), [documents, lineDrafts]);

  return (
    <ModernSection
      title="Ayrım Board"
      subtitle="Takı / Cleaning · Beyaz Altın · Ayrı Depo — satır sınıf ve not staging değerleriyle canlı gruplanır."
    >
      <div className="grid gap-3">
        {SPLIT_KEYS.map((key) => (
          <SplitGroupCard
            key={key}
            groupKey={key}
            lines={groups[key]}
            lineDrafts={lineDrafts}
            routeBusy={routeBusy}
            pureUnit={pureUnit}
            onDraftChange={onDraftChange}
            onRoute={onRoute}
          />
        ))}
      </div>
    </ModernSection>
  );
}

function SplitGroupCard({
  groupKey,
  lines,
  lineDrafts,
  routeBusy,
  pureUnit,
  onDraftChange,
  onRoute,
}: {
  groupKey: SplitGroupKey;
  lines: AfgWorkspaceLine[];
  lineDrafts: Record<string, LineDraft>;
  routeBusy: boolean;
  pureUnit: 'has' | 'saf';
  onDraftChange: (lineId: string, patch: Partial<LineDraft>) => void;
  onRoute: RouteLineHandler;
}) {
  const meta = SPLIT_GROUP_META[groupKey];
  const totals = useMemo(() => sumLines(lines), [lines]);

  return (
    <div className={`overflow-hidden rounded-sg-lg border bg-sg-surface ${meta.borderClass}`} data-testid={`log-split-group-${groupKey}`}>
      <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 ${meta.borderClass} ${meta.softClass}`}>
        <div className="flex items-center gap-2">
          <span className={`h-4 w-1.5 ${meta.barClass}`} />
          <span className={`rounded-sg-sm border px-1.5 py-0.5 text-xs font-bold ${meta.badgeClass}`}>{meta.badge}</span>
          <span className={`text-xs font-bold uppercase tracking-[0.12em] ${meta.textClass}`}>{meta.label}</span>
        </div>
        <span className={`text-xs font-semibold ${meta.textClass}`}>
          {lines.length} satır · {totals.weight.toFixed(2)} g · {totals.pure.toFixed(3)} {pureUnit}
        </span>
      </div>

      <div className="grid gap-2 p-3">
        {lines.length === 0 ? (
          <p className="text-center text-xs italic text-sg-text-soft">— boş —</p>
        ) : (
          lines.map((line) => {
            const draft = resolveLineDraft(line, lineDrafts);
            const pendingChange = lineHasPendingChange(line, lineDrafts);
            return (
              <div
                key={line.id}
                className={`grid gap-2 rounded-sg-md border px-3 py-2 lg:grid-cols-[minmax(0,9rem)_minmax(0,7rem)_minmax(0,1fr)] ${pendingChange ? 'border-sg-amber/40 bg-sg-amber-soft' : 'border-sg-border bg-sg-surface-soft'}`}
              >
                <div className="min-w-0">
                  <p className={`truncate text-xs font-bold ${meta.textClass}`}>{line.product_number || line.reference_number || line.document_number}</p>
                  <p className="mt-0.5 text-[11px] text-sg-text-soft">
                    AFG {line.document_number} · L{line.line_no}
                  </p>
                  <p className="mt-1 text-xs text-sg-text">
                    {formatNumber(line.weight_grams, ' g')} · {formatNumber(line.pure_gold_grams, ` ${pureUnit}`)}
                  </p>
                </div>
                <div className="flex flex-wrap items-start gap-1.5">
                  {pendingChange ? <LinePendingBadge /> : null}
                  <LineStateBadge line={line} />
                </div>
                <div className="grid gap-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <LineClassificationSelect lineId={line.id} draft={draft} onChange={onDraftChange} />
                    <LineNoteInput lineId={line.id} draft={draft} onChange={onDraftChange} />
                  </div>
                  <RouteButtonGroup line={line} draft={draft} busy={routeBusy} onRoute={onRoute} />
                  {line.is_gdpr_locked ? <LineGdprNote /> : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      {lines.length > 0 ? (
        <div className={`flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs font-bold ${meta.borderClass} ${meta.softClass} ${meta.textClass}`}>
          <span>I alt</span>
          <span>
            {totals.weight.toFixed(2)} g · {totals.amount.toFixed(0)} kr · {totals.pure.toFixed(3)} {pureUnit}
          </span>
        </div>
      ) : null}
    </div>
  );
}
