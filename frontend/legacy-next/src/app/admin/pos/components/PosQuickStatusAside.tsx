'use client';

import { Button } from '@/components/ui/button';

type PosQuickStatusAsideProps = {
  flowLabel: string;
  wizardStep: number;
  totalWizardSteps: number;
  sessionCode?: string | null;
  customerName?: string | null;
  statusLabel: string;
  finalAmountLabel: string;
  activeRateLabel: string;
  confirmBlockersCount: number;
  hasSession: boolean;
  canGoToConfirm: boolean;
  onOpenDisplay: () => void;
  onGoToConfirm: () => void;
};

export function PosQuickStatusAside({
  flowLabel,
  wizardStep,
  totalWizardSteps,
  sessionCode,
  customerName,
  statusLabel,
  finalAmountLabel,
  activeRateLabel,
  confirmBlockersCount,
  hasSession,
  canGoToConfirm,
  onOpenDisplay,
  onGoToConfirm,
}: PosQuickStatusAsideProps) {
  return (
    <aside className="space-y-4 2xl:sticky 2xl:top-4 2xl:h-fit">
      <div className="card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Hızlı Durum</p>
        <p className="mt-1 text-sm font-semibold text-brand-900">{flowLabel}</p>
        <div className="mt-3 grid gap-1 text-xs text-brand-700">
          <p>
            Adım: <strong>{wizardStep + 1}</strong> / {totalWizardSteps}
          </p>
          <p>
            Oturum: <strong>{sessionCode || '-'}</strong>
          </p>
          <p>
            Müşteri: <strong>{customerName || '-'}</strong>
          </p>
          <p>
            Durum: <strong>{statusLabel}</strong>
          </p>
          <p>
            Nihai Tutar: <strong>{finalAmountLabel}</strong>
          </p>
          <p>
            Aktif Kur: <strong>{activeRateLabel}</strong>
          </p>
        </div>
        {confirmBlockersCount > 0 && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
            Onay için {confirmBlockersCount} eksik alan var.
          </p>
        )}
        {hasSession && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onOpenDisplay}>
              Müşteri Ekranı
            </Button>
            <Button variant="ghost" onClick={onGoToConfirm} disabled={!canGoToConfirm}>
              Onay Adımına Git
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
