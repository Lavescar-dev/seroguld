import type { ReactNode } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Ban, Loader2 } from 'lucide-react';

import type { TransitionBlockerDescriptor, UnsupportedControlDescriptor } from '@/modern/adapters/types';

export function shellButtonClass(kind: 'primary' | 'secondary' | 'ghost' | 'danger' = 'secondary') {
  if (kind === 'primary') {
    return 'inline-flex items-center justify-center gap-2 rounded-sg-md border border-sg-green bg-sg-green px-4 py-2 text-sm font-semibold text-white transition hover:bg-sg-green-strong disabled:cursor-not-allowed disabled:opacity-50';
  }
  if (kind === 'danger') {
    return 'inline-flex items-center justify-center gap-2 rounded-sg-md border border-sg-red/20 bg-sg-red-soft px-4 py-2 text-sm font-semibold text-sg-red transition hover:bg-sg-red-soft/70 disabled:cursor-not-allowed disabled:opacity-50';
  }
  if (kind === 'ghost') {
    return 'inline-flex items-center justify-center gap-2 rounded-sg-md border border-transparent px-3 py-2 text-sm font-medium text-sg-text-soft transition hover:bg-sg-surface-soft hover:text-sg-text disabled:cursor-not-allowed disabled:opacity-50';
  }
  return 'inline-flex items-center justify-center gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-4 py-2 text-sm font-medium text-sg-text transition hover:bg-sg-surface-soft disabled:cursor-not-allowed disabled:opacity-50';
}

export function toneBadgeClass(tone: 'neutral' | 'success' | 'warning' | 'danger' = 'neutral') {
  if (tone === 'success') return 'border-sg-green/20 bg-sg-green-soft text-sg-green-strong';
  if (tone === 'warning') return 'border-sg-amber/20 bg-sg-amber-soft text-sg-amber';
  if (tone === 'danger') return 'border-sg-red/20 bg-sg-red-soft text-sg-red';
  return 'border-sg-border bg-sg-surface text-sg-text-soft';
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
    <section className="min-h-full font-sg text-sg-text">
      <div className="flex min-w-0 w-full flex-col gap-5">
        <div className="rounded-sg-lg border border-sg-border bg-sg-surface p-5 shadow-sg-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sg-accent">{eyebrow}</p>
              <div className="space-y-1">
                <h1 className="text-xl font-bold tracking-[-0.01em] text-sg-text sm:text-2xl">{title}</h1>
                <p className="max-w-3xl text-sm leading-6 text-sg-text-soft">{subtitle}</p>
              </div>
              {badges ? <div className="flex flex-wrap gap-2">{badges}</div> : null}
            </div>
            {actions ? <div className="flex flex-wrap gap-2 lg:justify-end">{actions}</div> : null}
          </div>
        </div>

        {blocker?.when ? <ModernBlocker blocker={blocker} /> : null}
        {unsupportedControls && unsupportedControls.length > 0 ? (
          <div className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-4">
            <div className="flex items-center gap-2 text-sg-text-soft">
              <Ban className="h-4 w-4" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">Yol haritasındaki kontroller</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {unsupportedControls.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled
                  title={item.reason}
                  className="cursor-not-allowed rounded-full border border-sg-border bg-sg-surface px-3 py-1.5 text-[11px] font-semibold text-sg-text-soft opacity-70"
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-sg-text-soft">
              Bu kontroller gerçek cihaz/OS kontratı tamamlanana kadar dürüst biçimde pasif tutulur; sahte başarı gösterilmez.
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
      ? 'border-sg-red/20 bg-sg-red-soft text-sg-text'
      : blocker.severity === 'warning'
        ? 'border-sg-amber/20 bg-sg-amber-soft text-sg-text'
        : 'border-sg-blue/20 bg-sg-blue-soft text-sg-text';

  return (
    <div className={clsx('rounded-sg-lg border-l-4 p-4 shadow-sg-sm', toneClass)}>
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">{blocker.title}</p>
          <p className="mt-1 text-sm font-medium">{blocker.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {blocker.reasons.map((reason) => (
              <span key={reason} className="rounded-full border border-current/15 bg-sg-surface/70 px-3 py-1 text-[11px] font-semibold">
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
    <div className="rounded-sg-lg border border-sg-border bg-sg-surface p-4 shadow-sg-sm sm:p-5">
      <div className="flex flex-col gap-3 border-b border-sg-border-soft pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-[-0.01em] text-sg-text">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-sg-text-soft">{subtitle}</p> : null}
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
        <div key={item.id} className="rounded-sg-md border border-sg-border bg-sg-surface p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">{item.label}</p>
          <p className="mt-2 text-xl font-semibold tracking-[-0.01em] text-sg-text">{item.value}</p>
          {item.hint ? <p className="mt-1 text-xs text-sg-text-soft">{item.hint}</p> : null}
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
    <div className="rounded-sg-lg border border-dashed border-sg-border bg-sg-surface-soft px-5 py-10 text-center">
      <p className="text-sm font-semibold text-sg-text">{title}</p>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-sg-text-soft">{message}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="rounded-sg-lg border border-sg-border bg-sg-surface px-5 py-12 text-center">
      <Loader2 className="mx-auto h-5 w-5 animate-spin text-sg-accent" />
      <p className="mt-3 text-sm text-sg-text-soft">{label}</p>
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
    <span className={clsx('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold', toneBadgeClass(tone))}>
      <span className="opacity-70">{label}</span>
      <span>{value}</span>
    </span>
  );
}
