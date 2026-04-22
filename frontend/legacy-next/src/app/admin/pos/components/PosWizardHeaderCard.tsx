'use client';

import { Button } from '@/components/ui/button';
import type { WizardStep } from '../pos-types';

type PhaseCard = {
  key: 'A' | 'B' | 'C';
  title: string;
  hint: string;
  completed: boolean;
  active: boolean;
  entryStep: WizardStep;
  locked: boolean;
};

type FlowAwareStep = {
  id: WizardStep;
  title: string;
};

type PosWizardHeaderCardProps = {
  flowLabel: string;
  wizardStep: number;
  totalWizardSteps: number;
  currentStepTitle: string;
  currentStepHint: string;
  busy: boolean;
  phaseCards: PhaseCard[];
  flowAwareWizardSteps: FlowAwareStep[];
  stepCompletion: Record<WizardStep, boolean>;
  showDetailedSteps: boolean;
  showAdvancedTools: boolean;
  onOpenDisplay: () => void;
  onGoPrevStep: () => void;
  onGoToStep: (step: WizardStep) => void;
  onToggleDetailedSteps: () => void;
  onToggleAdvancedTools: () => void;
  canEnterStep: (step: WizardStep) => { ok: true } | { ok: false; reason: string };
  onPrimaryAction: () => void;
  stepPrimaryActionLabel: string;
};

export function PosWizardHeaderCard({
  flowLabel,
  wizardStep,
  totalWizardSteps,
  currentStepTitle,
  currentStepHint,
  busy,
  phaseCards,
  flowAwareWizardSteps,
  stepCompletion,
  showDetailedSteps,
  showAdvancedTools,
  onOpenDisplay,
  onGoPrevStep,
  onGoToStep,
  onToggleDetailedSteps,
  onToggleAdvancedTools,
  canEnterStep,
  onPrimaryAction,
  stepPrimaryActionLabel,
}: PosWizardHeaderCardProps) {
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{flowLabel}</p>
          <h2 className="text-lg font-semibold text-brand-900">
            Adım {wizardStep + 1}/{totalWizardSteps}: {currentStepTitle}
          </h2>
          <p className="mt-1 text-xs text-brand-700">{currentStepHint}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onOpenDisplay} disabled={busy}>
            Müşteri Ekranı
          </Button>
          <Button variant="ghost" onClick={onGoPrevStep} disabled={wizardStep === 0 || busy}>
            Geri
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {phaseCards.map((phase) => (
          <button
            key={phase.key}
            type="button"
            disabled={phase.locked}
            onClick={() => onGoToStep(phase.entryStep)}
            className={`rounded-lg border px-3 py-3 text-left transition ${
              phase.active
                ? 'border-brand-500 bg-brand-100'
                : phase.completed
                  ? 'border-emerald-300 bg-emerald-50'
                  : phase.locked
                    ? 'cursor-not-allowed border-amber-200 bg-amber-50 opacity-70'
                    : 'border-brand-200 bg-white hover:bg-brand-50'
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{phase.title}</p>
            <p className="text-sm font-semibold text-brand-900">{phase.hint}</p>
            <p className="mt-1 text-[11px] text-brand-700">
              {phase.completed ? 'Tamamlandı' : phase.active ? 'Aktif' : 'Bekliyor'}
            </p>
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={onToggleDetailedSteps} disabled={busy}>
          {showDetailedSteps ? 'Adım Detayını Gizle' : 'Adım Detayını Göster'}
        </Button>
        <Button variant="ghost" onClick={onToggleAdvancedTools} disabled={busy}>
          {showAdvancedTools ? 'İleri Araçları Gizle' : 'İleri Araçları Göster'}
        </Button>
      </div>

      {showDetailedSteps && (
        <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          {flowAwareWizardSteps.map((step) => {
            const completed = stepCompletion[step.id];
            const active = wizardStep === step.id;
            const reachability = canEnterStep(step.id);
            const locked = !reachability.ok && !active;
            return (
              <button
                key={step.id}
                type="button"
                disabled={locked}
                onClick={() => onGoToStep(step.id)}
                className={`rounded-lg border px-3 py-2 text-left transition ${
                  active
                    ? 'border-brand-500 bg-brand-100'
                    : completed
                      ? 'border-emerald-300 bg-emerald-50'
                      : locked
                        ? 'cursor-not-allowed border-amber-200 bg-amber-50 opacity-70'
                        : 'border-brand-200 bg-white hover:bg-brand-50'
                }`}
              >
                <p className="text-xs font-semibold text-brand-700">Adım {step.id + 1}</p>
                <p className="text-sm font-medium text-brand-900">{step.title}</p>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 p-3">
        <p className="text-xs text-brand-700">Kısayol: Enter = bu adımın ana aksiyonu.</p>
        <Button onClick={onPrimaryAction} disabled={busy} className="px-6 py-3 text-base">
          {stepPrimaryActionLabel}
        </Button>
      </div>
    </div>
  );
}
