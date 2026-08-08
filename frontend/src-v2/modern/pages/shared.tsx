import { AlertTriangle, CheckCircle2, Clock3, Info, ShieldAlert } from 'lucide-react';

import { formatDate, formatMoney, formatNumber, formatRelativeTime, labelDocumentKind, labelMetalType, labelProductType, labelStatus } from '@/lib/format';
import {
  ModernBadge,
  ModernButton,
  ModernCard,
  ModernKeyValueList,
  ModernNotice,
  ModernSection,
  ModernSectionHeader,
  type ModernTone,
} from '@/modern/design-system';

import type { ModernAvailability, ModernStatusItem, ModernTimelineItem } from './types';

export { formatDate, formatMoney, formatNumber, formatRelativeTime, labelDocumentKind, labelMetalType, labelProductType, labelStatus };

export function toneForRisk(value?: number | null): ModernTone {
  if (value === null || value === undefined) return 'neutral';
  if (value >= 75) return 'danger';
  if (value >= 45) return 'warning';
  if (value > 0) return 'success';
  return 'neutral';
}

export function toneForText(value?: string | null): ModernTone {
  const normalized = (value || '').toLowerCase();
  if (/(broken|error|kritik|blocked|offline|hata|failed|danger|yüksek)/.test(normalized)) return 'danger';
  if (/(pending|warning|bekliyor|paused|fragile|medium|orta|readonly)/.test(normalized)) return 'warning';
  if (/(healthy|success|active|implemented|ready|live|ok|düşük|synced)/.test(normalized)) return 'success';
  if (/(info|review|manual|preview)/.test(normalized)) return 'info';
  return 'neutral';
}

export function AvailabilityBanner({
  availability,
  action,
}: {
  availability?: ModernAvailability;
  action?: React.ReactNode;
}) {
  if (!availability || availability.state === 'available') return null;
  const tone = availability.state === 'readonly' ? 'warning' : 'danger';
  const title =
    availability.title ||
    (availability.state === 'readonly' ? 'Bu yüzey şimdilik yalnız okunur.' : 'Bu yüzey henüz güvenli şekilde açılamıyor.');

  return (
    <ModernNotice
      tone={tone}
      title={title}
      description={availability.description || 'Gerçek backend veya Tauri kontratı doğrulanana kadar aksiyonlar sınırlandırıldı.'}
      icon={availability.state === 'readonly' ? <Clock3 className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
      action={action}
    />
  );
}

export function StatusGrid({ items }: { items: ModernStatusItem[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <ModernCard key={`${item.label}-${item.value}`} className="bg-sg-surface">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">{item.label}</p>
          <div className="mt-2 flex items-center gap-2">
            <ModernBadge tone={item.tone || toneForText(item.value)}>{item.value}</ModernBadge>
          </div>
          {item.detail ? <p className="mt-3 text-sm text-sg-text-soft">{item.detail}</p> : null}
        </ModernCard>
      ))}
    </div>
  );
}

export function TimelineList({
  items,
  title = 'Son olaylar',
  description,
}: {
  items: ModernTimelineItem[];
  title?: string;
  description?: string;
}) {
  return (
    <ModernSection>
      <ModernSectionHeader title={title} description={description} />
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div key={item.id} className="flex gap-3 rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3">
            <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sg-surface ring-1 ring-sg-border">
              {item.tone === 'danger' ? (
                <AlertTriangle className="h-4 w-4 text-sg-red" />
              ) : item.tone === 'success' ? (
                <CheckCircle2 className="h-4 w-4 text-sg-green" />
              ) : item.tone === 'warning' ? (
                <Clock3 className="h-4 w-4 text-sg-amber" />
              ) : (
                <Info className="h-4 w-4 text-sg-blue" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-sg-text">{item.title}</p>
                {item.timestamp ? <span className="text-xs text-sg-text-soft">{item.timestamp}</span> : null}
              </div>
              {item.detail ? <p className="mt-1 text-sm leading-6 text-sg-text-soft">{item.detail}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </ModernSection>
  );
}

export function DetailGrid({
  title,
  description,
  items,
}: {
  title: string;
  description?: string;
  items: Array<{ label: string; value: React.ReactNode; accent?: boolean }>;
}) {
  return (
    <ModernSection>
      <ModernSectionHeader title={title} description={description} />
      <div className="mt-4">
        <ModernKeyValueList items={items} />
      </div>
    </ModernSection>
  );
}

export function ReadonlyAction({
  label,
  reason,
}: {
  label: string;
  reason: string;
}) {
  return (
    <ModernButton tone="ghost" disabled title={reason}>
      {label}
    </ModernButton>
  );
}
