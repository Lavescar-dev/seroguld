// Seçili AFG belgesinin pipeline'ı — Classic LogPage.tsx:1020-1108 paritesi:
// bekleyen satır incelemesi, Ayrılan/Kalan şeridi ve belgeyi modalda açma.
import { FileText } from 'lucide-react';
import { useMemo } from 'react';

import { formatMoney, formatNumber, labelMetalType, labelProductType } from '@/lib/format';
import { lineHasPendingChange, resolveLineDraft } from '@/make/log/lineHelpers';
import type { LineDraft, RouteDestination } from '@/make/log/types';
import type { ModernLogSelectedDocument } from '@/modern/adapters/log';
import { EmptyState, ModernSection, shellButtonClass } from '@/modern/modules/shared';
import type { AfgWorkspaceLine } from '@/types';

import {
  LineClassificationSelect,
  LineGdprNote,
  LineNoteInput,
  LinePendingBadge,
  LineStateBadge,
  RouteButtonGroup,
} from './LineControls';

export interface DocumentPipelineProps {
  selected: ModernLogSelectedDocument;
  lineDrafts: Record<string, LineDraft>;
  routeBusy: boolean;
  pureUnit: 'has' | 'saf';
  onDraftChange: (lineId: string, patch: Partial<LineDraft>) => void;
  onRoute: (line: AfgWorkspaceLine, destination: RouteDestination) => void;
  onOpenDocument: (sessionId: string, documentNumber: string) => void;
}

export function DocumentPipeline({
  selected,
  lineDrafts,
  routeBusy,
  pureUnit,
  onDraftChange,
  onRoute,
  onOpenDocument,
}: DocumentPipelineProps) {
  const { document, pending, routedWeight, routedAmount, routedPure, remainingPure } = selected;
  const showStrip = useMemo(() => selected.groupedCount > 0 || pending.length > 0, [selected.groupedCount, pending.length]);

  return (
    <ModernSection
      title="Belge Pipeline"
      subtitle="Bekleyen satırları inceleyin; kararlar önce inceleme barında birikir ve toplu uygulanır."
      actions={
        <button
          type="button"
          onClick={() => onOpenDocument(document.session_id, document.document_number)}
          className={shellButtonClass('secondary')}
        >
          <FileText className="h-4 w-4" />
          Belgeyi Aç
        </button>
      }
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-sg-md border border-sg-border bg-sg-surface-soft px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Bekleyen Satırlar</p>
          <p className="text-xs text-sg-text-soft">
            {pending.length} satır · {formatNumber(document.total_weight_grams, ' g')} · <span className="font-semibold text-sg-amber">{formatNumber(document.total_pure_gold_grams, ` ${pureUnit}`)}</span>
          </p>
        </div>

        {pending.length === 0 ? (
          <EmptyState
            title="Bekleyen satır yok"
            message="Bu belgede standart sınıflandırmada bekleyen satır kalmadı; satırlar aşağıdaki ayrım board'unda."
          />
        ) : (
          <div className="grid gap-2">
            {pending.map((line) => {
              const pendingChange = lineHasPendingChange(line, lineDrafts);
              return (
                <div key={line.id} className="rounded-sg-lg border border-sg-border bg-sg-surface p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-sg-text">
                      L{line.line_no} · {formatNumber(line.weight_grams, ' g')} · {formatNumber(line.pure_gold_grams, ` ${pureUnit}`)} · {formatMoney(line.line_total_dkk)}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {pendingChange ? <LinePendingBadge /> : null}
                      <LineStateBadge line={line} />
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] text-sg-text-soft">
                    {labelProductType(line.product_type)} · {labelMetalType(line.metal_type)} · {line.product_number || line.reference_number || 'Ref yok'}
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] sm:items-center">
                    <LineClassificationSelect lineId={line.id} draft={resolveLineDraft(line, lineDrafts)} onChange={onDraftChange} />
                    <LineNoteInput lineId={line.id} draft={resolveLineDraft(line, lineDrafts)} onChange={onDraftChange} />
                    <RouteButtonGroup line={line} draft={resolveLineDraft(line, lineDrafts)} busy={routeBusy} onRoute={onRoute} />
                  </div>
                  {line.is_gdpr_locked ? <div className="mt-2"><LineGdprNote /></div> : null}
                </div>
              );
            })}
          </div>
        )}

        {showStrip ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-sg-md border border-sg-border bg-sg-surface-accent px-3 py-2 text-xs" data-testid="log-document-strip">
            <span className="font-semibold uppercase tracking-[0.12em] text-sg-text-soft">AFG #{document.document_number}</span>
            <span className="text-sg-text-soft">
              Ayrılan: <span className="font-semibold text-sg-text">{formatNumber(routedWeight, ' g')}</span> · {formatMoney(routedAmount)} ·{' '}
              <span className="font-semibold text-sg-amber">{formatNumber(routedPure, ` ${pureUnit}`)}</span>
            </span>
            <span className="text-sg-text-soft">
              Kalan: <span className="font-semibold text-sg-text">{formatNumber(remainingPure, ` ${pureUnit}`)}</span>
            </span>
          </div>
        ) : null}
      </div>
    </ModernSection>
  );
}
