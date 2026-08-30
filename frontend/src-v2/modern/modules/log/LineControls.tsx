// Log satır kontrol parçaları — DocumentPipeline ve SplitBoard aynı
// rota/sınıf/not kontrol setini paylaşır (iki katmanlı uygulama modeli:
// rota tıklaması anında, sınıf + not inceleme barından toplu).
import { labelAfgClassification } from '@/lib/format';
import { classificationOptions, type LineDraft, type RouteDestination } from '@/make/log/types';
import { toneBadgeClass } from '@/modern/modules/shared';
import type { AfgWorkspaceLine } from '@/types';

import { labelLineState, lineTone } from './labels';

export type RouteLineHandler = (line: AfgWorkspaceLine, destination: RouteDestination) => void;

const ROUTE_OPTIONS: Array<{ destination: RouteDestination; label: string; activeClass: string }> = [
  { destination: 'inventory', label: 'Depo', activeClass: 'border-sg-green bg-sg-green-soft text-sg-green-strong' },
  { destination: 'undecided', label: 'Kararsız', activeClass: 'border-sg-amber/50 bg-sg-amber-soft text-sg-amber' },
  { destination: 'melt', label: 'Erit', activeClass: 'border-sg-red/40 bg-sg-red-soft text-sg-red' },
];

export function RouteButtonGroup({
  line,
  draft,
  busy,
  onRoute,
}: {
  line: AfgWorkspaceLine;
  draft: LineDraft;
  busy: boolean;
  onRoute: RouteLineHandler;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="log-route-group">
      {ROUTE_OPTIONS.map((option) => {
        const active = draft.destination === option.destination;
        return (
          <button
            key={option.destination}
            type="button"
            disabled={busy}
            onClick={() => onRoute(line, option.destination)}
            aria-pressed={active}
            data-destination={option.destination}
            className={`rounded-sg-md border px-2.5 py-1 text-[11px] font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
              active
                ? `${option.activeClass} ring-1 ring-current`
                : 'border-sg-border bg-sg-surface-soft text-sg-text hover:border-sg-accent hover:bg-sg-surface'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function LineStateBadge({ line }: { line: AfgWorkspaceLine }) {
  return (
    <span
      className={`cursor-default rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${toneBadgeClass(lineTone(line))}`}
      data-testid="log-line-state"
    >
      {labelLineState(line)}
    </span>
  );
}

export function LinePendingBadge() {
  return (
    <span className="rounded-full border border-sg-amber/40 bg-sg-amber-soft px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sg-amber" data-testid="log-line-pending">
      İnceleme
    </span>
  );
}

export function LineClassificationSelect({
  lineId,
  draft,
  onChange,
}: {
  lineId: string;
  draft: LineDraft;
  onChange: (lineId: string, patch: Partial<LineDraft>) => void;
}) {
  return (
    <select
      value={draft.classification}
      onChange={(event) => onChange(lineId, { classification: event.target.value as LineDraft['classification'] })}
      aria-label="Depo sınıfı"
      data-testid="log-line-classification"
      className="w-full rounded-sg-md border border-sg-border bg-sg-surface px-2 py-1.5 text-xs text-sg-text outline-none focus:border-sg-accent"
    >
      {classificationOptions.map((option) => (
        <option key={option} value={option}>
          {labelAfgClassification(option)}
        </option>
      ))}
    </select>
  );
}

export function LineNoteInput({
  lineId,
  draft,
  onChange,
}: {
  lineId: string;
  draft: LineDraft;
  onChange: (lineId: string, patch: Partial<LineDraft>) => void;
}) {
  return (
    <input
      value={draft.note}
      onChange={(event) => onChange(lineId, { note: event.target.value })}
      placeholder="Operasyon notu"
      aria-label="Operasyon notu"
      data-testid="log-line-note"
      className="w-full rounded-sg-md border border-sg-border bg-sg-surface px-2 py-1.5 text-xs text-sg-text outline-none focus:border-sg-accent"
    />
  );
}

export function LineGdprNote() {
  return <p className="text-[11px] text-sg-amber">GDPR süresi devam ediyor (bilgi).</p>;
}
