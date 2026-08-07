import { AlertTriangle, FileSearch, LoaderCircle, Lock, ShieldAlert } from 'lucide-react';

import { ModernButton, ModernCard, ModernNotice } from './primitives';

export function ModernLoadingState({
  title = 'Yüzey hazırlanıyor',
  description = 'Gerekli görünüm modeli ve runtime bilgileri bekleniyor.',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <ModernCard className="flex min-h-[240px] flex-col items-center justify-center gap-4 bg-white text-center">
      <LoaderCircle className="h-8 w-8 animate-spin text-sky-600 motion-reduce:animate-none" />
      <div>
        <p className="text-base font-semibold text-slate-900">{title}</p>
        <p className="mt-2 max-w-md text-sm text-slate-500">{description}</p>
      </div>
    </ModernCard>
  );
}

export function ModernEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <ModernCard className="flex min-h-[240px] flex-col items-center justify-center gap-4 bg-white text-center">
      <FileSearch className="h-8 w-8 text-slate-300" />
      <div>
        <p className="text-base font-semibold text-slate-900">{title}</p>
        <p className="mt-2 max-w-md text-sm text-slate-500">{description}</p>
      </div>
      {action}
    </ModernCard>
  );
}

export function ModernErrorState({
  title = 'Yüzey açılamadı',
  description,
  retryLabel = 'Tekrar dene',
  onRetry,
}: {
  title?: string;
  description: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <ModernNotice
      tone="danger"
      title={title}
      description={description}
      icon={<ShieldAlert className="h-5 w-5" />}
      action={onRetry ? <ModernButton tone="danger" onClick={onRetry}>{retryLabel}</ModernButton> : undefined}
    />
  );
}

export function ModernUnavailableState({
  title,
  description,
  detail,
}: {
  title: string;
  description: string;
  detail?: string;
}) {
  return (
    <ModernCard className="border-dashed bg-slate-50 text-center">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-6">
        <Lock className="h-8 w-8 text-slate-300" />
        <div>
          <p className="text-base font-semibold text-slate-900">{title}</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
          {detail ? <p className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">{detail}</p> : null}
        </div>
      </div>
    </ModernCard>
  );
}

export function ModernReadonlyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <ModernNotice
      tone="warning"
      title={title}
      description={description}
      icon={<AlertTriangle className="h-5 w-5" />}
    />
  );
}
