import type { ReactNode } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Ban, Loader2 } from 'lucide-react';

import type { TransitionBlockerDescriptor, UnsupportedControlDescriptor } from '@/modern/adapters/types';

export function shellButtonClass(kind: 'primary' | 'secondary' | 'ghost' | 'danger' = 'secondary') {
  if (kind === 'primary') {
    return 'inline-flex items-center justify-center gap-2 rounded-2xl border border-brand-900 bg-brand-900 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50';
  }
  if (kind === 'danger') {
    return 'inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50';
  }
  if (kind === 'ghost') {
    return 'inline-flex items-center justify-center gap-2 rounded-2xl border border-transparent px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50';
  }
  return 'inline-flex items-center justify-center gap-2 rounded-2xl border border-brand-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50';
}

export function toneBadgeClass(tone: 'neutral' | 'success' | 'warning' | 'danger' = 'neutral') {
  if (tone === 'success') return 'border-emerald-300 bg-emerald-50 text-emerald-800';
  if (tone === 'warning') return 'border-amber-300 bg-amber-50 text-amber-800';
  if (tone === 'danger') return 'border-rose-300 bg-rose-50 text-rose-800';
  return 'border-brand-200 bg-white text-brand-700';
}

export function ModernModuleShell({
  eyebrow,
  title,
  subtitle,
  badges,
  actions,
  blocker,
  unsupportedControls,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  badges?: ReactNode;
  actions?: ReactNode;
  blocker?: TransitionBlockerDescriptor | null;
  unsupportedControls?: UnsupportedControlDescriptor[];
  children: ReactNode;
}) {
  return (
    <section className="min-h-full bg-stone-100 text-brand-950">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6">
        <div className="rounded-[28px] border border-brand-200 bg-[linear-gradient(135deg,#fffefb_0%,#f5efe5_100%)] p-5 shadow-[0_20px_60px_-40px_rgba(30,41,59,0.35)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-brand-500">{eyebrow}</p>
              <div className="space-y-1">
                <h1 className="text-2xl font-black uppercase tracking-[0.16em] text-brand-950 sm:text-3xl">{title}</h1>
                <p className="max-w-3xl text-sm leading-6 text-brand-700">{subtitle}</p>
              </div>
              {badges ? <div className="flex flex-wrap gap-2">{badges}</div> : null}
            </div>
            {actions ? <div className="flex flex-wrap gap-2 lg:justify-end">{actions}</div> : null}
          </div>
        </div>

        {blocker?.when ? <ModernBlocker blocker={blocker} /> : null}
        {unsupportedControls && unsupportedControls.length > 0 ? (
          <div className="rounded-[24px] border border-brand-200 bg-white p-4">
            <div className="flex items-center gap-2 text-brand-800">
              <Ban className="h-4 w-4" />
              <p className="text-xs font-black uppercase tracking-[0.18em]">Desteklenmeyen Kontroller</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {unsupportedControls.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled
                  title={item.reason}
                  className="cursor-not-allowed rounded-full border border-brand-200 bg-stone-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-brand-500 opacity-80"
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-brand-500">
              Bu kontroller bilerek pasif tutuldu; gerçek akış için route, Office veya OS seviyesinde doğrulanmış callback gerekiyor.
            </p>
          </div>
        ) : null}

        {children}
      </div>
    </section>
  );
}

function ModernBlocker({ blocker }: { blocker: TransitionBlockerDescriptor }) {
  const toneClass =
    blocker.severity === 'danger'
      ? 'border-rose-300 bg-rose-50 text-rose-900'
      : blocker.severity === 'warning'
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : 'border-sky-300 bg-sky-50 text-sky-900';

  return (
    <div className={clsx('rounded-[24px] border p-4 shadow-sm', toneClass)}>
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.22em]">{blocker.title}</p>
          <p className="mt-1 text-sm font-medium">{blocker.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {blocker.reasons.map((reason) => (
              <span key={reason} className="rounded-full border border-current/15 bg-white/70 px-3 py-1 text-[11px] font-semibold">
                {reason}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ModernSection({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-brand-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 border-b border-brand-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-brand-900">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-brand-600">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="pt-4">{children}</div>
    </div>
  );
}

export function ModernStatGrid({
  items,
}: {
  items: Array<{ id: string; label: string; value: string; hint?: string }>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.id} className="rounded-[20px] border border-brand-200 bg-stone-50 p-4">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-500">{item.label}</p>
          <p className="mt-2 text-xl font-black text-brand-950">{item.value}</p>
          {item.hint ? <p className="mt-1 text-xs text-brand-500">{item.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-dashed border-brand-200 bg-stone-50 px-5 py-10 text-center">
      <p className="text-[11px] font-black uppercase tracking-[0.24em] text-brand-500">{title}</p>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-brand-600">{message}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="rounded-[24px] border border-brand-200 bg-white px-5 py-12 text-center">
      <Loader2 className="mx-auto h-5 w-5 animate-spin text-brand-500" />
      <p className="mt-3 text-[11px] font-black uppercase tracking-[0.22em] text-brand-500">{label}</p>
    </div>
  );
}

export function DataPill({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return (
    <span className={clsx('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em]', toneBadgeClass(tone))}>
      <span className="opacity-70">{label}</span>
      <span>{value}</span>
    </span>
  );
}
