import { type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, HelpCircle } from 'lucide-react';

export const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;

export type RiskFilter = 'all' | 'high' | 'medium' | 'low' | 'unknown';

export function normalizeRiskLevel(value?: string | null): RiskFilter {
  const normalized = (value || '').toLowerCase();
  if (normalized.includes('high') || normalized.includes('yüksek')) return 'high';
  if (normalized.includes('medium') || normalized.includes('orta')) return 'medium';
  if (normalized.includes('low') || normalized.includes('düşük')) return 'low';
  return 'unknown';
}

export function riskTone(level?: string | null) {
  switch (normalizeRiskLevel(level)) {
    case 'high':
      return {
        card: 'bg-red-50 border-red-300 text-red-800',
        soft: 'bg-red-50 text-red-700 border-red-300',
        icon: <AlertTriangle className="h-3.5 w-3.5 text-red-600" />,
        label: 'Yüksek',
      };
    case 'medium':
      return {
        card: 'bg-amber-50 border-amber-300 text-amber-800',
        soft: 'bg-amber-50 text-amber-700 border-amber-300',
        icon: <AlertCircle className="h-3.5 w-3.5 text-amber-600" />,
        label: 'Orta',
      };
    case 'low':
      return {
        card: 'bg-emerald-50 border-emerald-300 text-emerald-800',
        soft: 'bg-emerald-50 text-emerald-700 border-emerald-300',
        icon: <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />,
        label: 'Düşük',
      };
    default:
      return {
        card: 'bg-slate-50 border-slate-300 text-slate-700',
        soft: 'bg-slate-50 text-slate-600 border-slate-300',
        icon: <HelpCircle className="h-3.5 w-3.5 text-slate-400" />,
        label: 'Belirsiz',
      };
  }
}

export function formatOrderStatus(value?: string | null): string {
  const normalized = (value || '').replace(/_/g, ' ').trim();
  if (!normalized) return 'Bilinmiyor';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function SummaryBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'brand' | 'high' | 'medium' | 'low' | 'unknown' | 'manual';
}) {
  const className =
    tone === 'high'
      ? 'bg-red-50 text-red-700'
      : tone === 'medium'
        ? 'bg-amber-50 text-amber-700'
        : tone === 'low'
          ? 'bg-emerald-50 text-emerald-700'
          : tone === 'unknown'
            ? 'bg-slate-50 text-slate-700'
            : tone === 'manual'
              ? 'bg-violet-50 text-violet-700'
              : 'bg-white text-brand-900';

  return (
    <div className={`border-r border-brand-200 px-4 py-3 last:border-r-0 ${className.split(' ')[0]}`}>
      <p className="text-xs font-black uppercase tracking-wider text-brand-500">{label}</p>
      <p className={`mt-2 text-2xl font-black ${className.split(' ')[1]}`} style={monoStyle}>
        {value}
      </p>
    </div>
  );
}

export function FieldRow({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex items-start border-r border-brand-200 last:border-r-0">
      <div className="w-32 flex-shrink-0 border-r border-brand-200 bg-brand-50 px-3 py-2.5">
        <span className="text-xs font-black uppercase tracking-wider text-brand-500">{label}</span>
      </div>
      <div className="flex-1 px-3 py-2.5 text-sm font-semibold text-brand-800">{children}</div>
    </div>
  );
}

export function DetailBlock({
  title,
  tone,
  children,
}: {
  title: string;
  tone: 'risk' | 'meta' | 'notes' | 'ai' | 'default';
  children: ReactNode;
}) {
  const headerClass =
    tone === 'risk'
      ? 'bg-red-50 text-red-700 border-red-200'
      : tone === 'meta'
        ? 'bg-brand-100 text-brand-700 border-brand-200'
        : tone === 'notes'
          ? 'bg-amber-50 text-amber-700 border-amber-200'
          : tone === 'ai'
            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
            : 'bg-brand-100 text-brand-700 border-brand-200';

  return (
    <section className="border border-brand-200 bg-white">
      <div className={`border-b px-4 py-2.5 ${headerClass}`}>
        <p className="text-xs font-black uppercase tracking-widest">{title}</p>
      </div>
      <div className="space-y-2 p-4">{children}</div>
    </section>
  );
}

export function EmptyLine({ label }: { label: string }) {
  return <p className="text-sm text-brand-500">{label}</p>;
}
