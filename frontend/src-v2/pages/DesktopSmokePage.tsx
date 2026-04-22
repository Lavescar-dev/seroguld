import { useEffect, useMemo, useState } from 'react';

import {
  DISPLAY_IDLE_ROUTE,
  closeDocumentPreviewWindow,
  ensureCustomerDisplayWindow,
  ensureDocumentPreviewWindow,
  getDesktopMonitorSetup,
  getDesktopRuntimeInfo,
  isTauriRuntime,
  setCustomerDisplayIdle,
  type DesktopDisplayWindowState,
  type DesktopRuntimeInfo,
} from '@/lib/desktop';

type StepState = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

type SmokeStep = {
  key: string;
  label: string;
  state: StepState;
  detail?: string;
};

function StepBadge({ state }: { state: StepState }) {
  const styles: Record<StepState, string> = {
    pending: 'border-brand-300 bg-brand-50 text-brand-600',
    running: 'border-amber-300 bg-amber-50 text-amber-700',
    passed: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    failed: 'border-rose-300 bg-rose-50 text-rose-700',
    skipped: 'border-slate-300 bg-slate-50 text-slate-600',
  };
  return (
    <span className={`inline-flex min-w-[4.5rem] justify-center border px-2 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${styles[state]}`}>
      {state}
    </span>
  );
}

export function DesktopSmokePage() {
  const [runtimeInfo, setRuntimeInfo] = useState<DesktopRuntimeInfo | null>(null);
  const [monitorState, setMonitorState] = useState<DesktopDisplayWindowState | null>(null);
  const [running, setRunning] = useState(false);
  const [runCount, setRunCount] = useState(0);
  const [summary, setSummary] = useState<string>('Hazır');
  const [steps, setSteps] = useState<SmokeStep[]>([
    { key: 'runtime', label: 'Runtime bilgisi', state: 'pending' },
    { key: 'monitor', label: 'Monitor setup', state: 'pending' },
    { key: 'preview-open', label: 'Preview aç', state: 'pending' },
    { key: 'preview-close', label: 'Preview kapat', state: 'pending' },
    { key: 'display-open', label: 'Customer display aç', state: 'pending' },
    { key: 'display-idle', label: 'Customer display idle', state: 'pending' },
  ]);

  const tauriAvailable = useMemo(() => isTauriRuntime(), []);

  function setStep(key: string, patch: Partial<SmokeStep>) {
    setSteps((current) =>
      current.map((step) => (step.key === key ? { ...step, ...patch } : step)),
    );
  }

  async function runSmoke() {
    if (running) return;
    setRunning(true);
    setSummary('Çalışıyor');
    setRunCount((current) => current + 1);
    setSteps((current) =>
      current.map((step) => ({ ...step, state: tauriAvailable ? 'pending' : 'skipped', detail: undefined })),
    );

    if (!tauriAvailable) {
      setSummary('Tauri runtime bulunamadı');
      setRunning(false);
      return;
    }

    try {
      setStep('runtime', { state: 'running' });
      const runtime = await getDesktopRuntimeInfo();
      if (!runtime || !runtime.runtime_mode.includes('tauri')) {
        throw new Error('Tauri runtime bilgisi alınamadı');
      }
      setRuntimeInfo(runtime);
      setStep('runtime', { state: 'passed', detail: runtime.runtime_mode });

      setStep('monitor', { state: 'running' });
      const monitor = await getDesktopMonitorSetup();
      if (!monitor) {
        throw new Error('Monitor setup alınamadı');
      }
      setMonitorState(monitor);
      setStep('monitor', {
        state: 'passed',
        detail: monitor.secondary_monitor?.name || 'single-monitor',
      });

      setStep('preview-open', { state: 'running' });
      const previewRoute = '/desktop-smoke?window=document-preview';
      const preview = await ensureDocumentPreviewWindow(previewRoute, 'Desktop Smoke Preview');
      if (!preview) {
        throw new Error('Preview window açılmadı');
      }
      setStep('preview-open', { state: 'passed', detail: previewRoute });

      setStep('preview-close', { state: 'running' });
      await closeDocumentPreviewWindow();
      setStep('preview-close', { state: 'passed', detail: 'closed' });

      setStep('display-open', { state: 'running' });
      const display = await ensureCustomerDisplayWindow(DISPLAY_IDLE_ROUTE);
      if (!display) {
        throw new Error('Customer display window açılamadı');
      }
      setStep('display-open', {
        state: 'passed',
        detail: display.secondary_monitor?.name || 'graceful-single-monitor',
      });

      setStep('display-idle', { state: 'running' });
      const idleState = await setCustomerDisplayIdle();
      if (!idleState) {
        throw new Error('Customer display idle çağrısı başarısız');
      }
      setStep('display-idle', { state: 'passed', detail: idleState.active_route });
      setSummary('Başarılı');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSummary(message);
      setSteps((current) => {
        const next = [...current];
        const runningIndex = next.findIndex((step) => step.state === 'running');
        if (runningIndex >= 0) {
          next[runningIndex] = { ...next[runningIndex], state: 'failed', detail: message };
        }
        return next;
      });
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void runSmoke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allPassed = tauriAvailable && steps.every((step) => step.state === 'passed');

  return (
    <div className="min-h-screen bg-brand-50 px-6 py-8 text-brand-900">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="border border-brand-300 bg-white px-6 py-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-brand-500">Desktop Smoke</p>
              <h1 className="mt-2 text-2xl font-black uppercase tracking-[0.08em] text-brand-950">
                Tauri Shell Doğrulama
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-brand-700">
                Bu yüzey yalnız desktop smoke için kullanılır. Uygulama davranışı ayrı web smoke ile korunur;
                burada kabuk komutları ve pencere akışı doğrulanır.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div
                data-testid="desktop-smoke-summary"
                className={`border px-3 py-2 text-xs font-black uppercase tracking-[0.18em] ${
                  allPassed
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : running
                      ? 'border-amber-300 bg-amber-50 text-amber-700'
                      : 'border-brand-300 bg-brand-50 text-brand-600'
                }`}
              >
                {summary}
              </div>
              <button
                type="button"
                onClick={() => void runSmoke()}
                disabled={running}
                className="border border-brand-400 bg-brand-900 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Tekrar Çalıştır
              </button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-xs text-brand-500">
            <span>Tauri runtime: {tauriAvailable ? 'var' : 'yok'}</span>
            <span>Run: {runCount}</span>
            {runtimeInfo?.dev_base_url ? <span>Dev URL: {runtimeInfo.dev_base_url}</span> : null}
          </div>
          {allPassed ? <div data-testid="desktop-smoke-shell-ok" className="sr-only">ok</div> : null}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="border border-brand-300 bg-white shadow-sm">
            <div className="border-b border-brand-200 bg-brand-100 px-5 py-3">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-brand-600">Steps</p>
            </div>
            <div className="divide-y divide-brand-100">
              {steps.map((step) => (
                <div key={step.key} className="flex items-start justify-between gap-4 px-5 py-4" data-testid={`desktop-step-${step.key}`}>
                  <div>
                    <p className="text-sm font-bold text-brand-900">{step.label}</p>
                    <p className="mt-1 text-xs text-brand-500">{step.detail || 'Bekliyor'}</p>
                  </div>
                  <StepBadge state={step.state} />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="border border-brand-300 bg-white px-5 py-4 shadow-sm">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-brand-600">Runtime</p>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-brand-500">Mode</dt>
                  <dd className="font-semibold text-brand-900">{runtimeInfo?.runtime_mode || '—'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-brand-500">Binary</dt>
                  <dd className="max-w-[18rem] truncate font-semibold text-brand-900">{runtimeInfo?.binary_path || '—'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-brand-500">Dev Base URL</dt>
                  <dd className="font-semibold text-brand-900">{runtimeInfo?.dev_base_url || '—'}</dd>
                </div>
              </dl>
            </div>

            <div className="border border-brand-300 bg-white px-5 py-4 shadow-sm">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-brand-600">Display State</p>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-brand-500">Window</dt>
                  <dd className="font-semibold text-brand-900">{monitorState?.window_open ? 'open' : 'closed / idle'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-brand-500">Secondary monitor</dt>
                  <dd className="font-semibold text-brand-900">
                    {monitorState?.secondary_monitor?.name || 'single-monitor fallback'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-brand-500">Route</dt>
                  <dd className="font-semibold text-brand-900">{monitorState?.active_route || '—'}</dd>
                </div>
              </dl>
            </div>

            <div className="border border-brand-300 bg-brand-100 px-5 py-4 text-xs text-brand-600 shadow-sm">
              `document-preview` penceresi smoke sırasında `/desktop-smoke?window=document-preview` rotasıyla açılır.
              Böylece auth gerektirmeden shell komutları doğrulanır.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
