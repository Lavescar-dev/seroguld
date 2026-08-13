import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  Database,
  FileWarning,
  FolderOpen,
  LoaderCircle,
  LogOut,
  RotateCcw,
  ServerCog,
} from 'lucide-react';

import {
  confirmDesktopClose,
  consumeDesktopCloseRequest,
  focusManagedExcelSession,
  getDesktopStartupState,
  isTauriRuntime,
  listenDesktopCloseRequest,
  openRuntimeDiagnostics,
  retryDesktopStartup,
  type DesktopStartupState,
} from '@/lib/desktop';
import { t, useLocale } from '@/lib/locale';
import {
  PendingSaveError,
  discardPendingSaves,
  flushPendingSaves,
  resetPendingSaveDiscard,
} from '@/lib/saveCoordinator';

type DesktopLifecycleProps = { children: ReactNode };

function StartupSplash({ state, onRetry, onDiagnostics, onClose }: {
  state: DesktopStartupState | null;
  onRetry: () => void;
  onDiagnostics: () => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const failed = Boolean(
    state && !['not-started', 'starting', 'ready', 'dev'].includes(state.state),
  );
  return (
    <main data-testid="startup-screen" className="relative flex min-h-screen items-center justify-center overflow-hidden bg-sg-bg px-4 py-8 text-sg-text sm:px-6 sm:py-10">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-28 h-72 w-72 rounded-full bg-sg-accent-soft/70 blur-3xl" />
        <div className="absolute -bottom-36 -right-24 h-80 w-80 rounded-full bg-sg-green-soft/60 blur-3xl" />
      </div>

      <section
        aria-busy={!failed}
        aria-labelledby="desktop-startup-title"
        className="relative w-full max-w-2xl rounded-sg-xl border border-sg-border bg-sg-surface p-5 shadow-sg-lg sm:p-8"
      >
        <header className="flex items-start gap-4 border-b border-sg-border-soft pb-6">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${
              failed
                ? 'border-sg-red/30 bg-sg-red-soft text-sg-red'
                : 'border-sg-accent/20 bg-sg-accent-soft text-sg-accent'
            }`}
          >
            {failed ? <AlertTriangle aria-hidden="true" className="h-6 w-6" /> : <LoaderCircle aria-hidden="true" className="h-6 w-6 animate-spin" />}
          </div>
          <div className="min-w-0 flex-1">
            <img data-testid="startup-logo" src="/seroguld-logo.png" alt="Sero Guld" className="h-8 w-auto max-w-[180px] object-contain object-left" />
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-sg-text-soft">SERO GULD · DESKTOP</p>
            <h1 id="desktop-startup-title" className="mt-2 text-xl font-semibold tracking-tight text-sg-text sm:text-2xl">
              {failed ? t('startup.failed', locale) : t('startup.preparing', locale)}
            </h1>
            <p className="mt-2 text-sm leading-6 text-sg-text-soft">
              {failed ? t('startup.failedDetail', locale) : t('startup.service', locale)}
            </p>
          </div>
        </header>

        {failed ? (
          <div data-testid="startup-error" role="alert" className="mt-6 rounded-sg-md border border-sg-red/30 bg-sg-red-soft/80 p-4">
            <div className="flex gap-3">
              <FileWarning aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-sg-red" />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-6 text-sg-text">{t('startup.failedDetail', locale)}</p>
              </div>
            </div>
            <p className="mt-3 border-t border-sg-red/20 pt-3 text-xs leading-5 text-sg-red">{t('startup.technicalLog', locale)}</p>
          </div>
        ) : (
          <ol data-testid="startup-phases" aria-label={t('startup.preparing', locale)} className="mt-6 grid gap-3 sm:grid-cols-2">
            <li className="flex items-center gap-3 rounded-sg-md border border-sg-border-soft bg-sg-surface-soft px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sg-md bg-sg-surface text-sg-accent shadow-sm ring-1 ring-sg-border-soft">
                <Database aria-hidden="true" className="h-4 w-4" />
              </span>
              <span className="min-w-0 text-sm font-semibold text-sg-text">{t('startup.database', locale)}</span>
              <LoaderCircle aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 animate-spin text-sg-accent" />
            </li>
            <li className="flex items-center gap-3 rounded-sg-md border border-sg-border-soft bg-sg-surface-soft px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sg-md bg-sg-surface text-sg-green shadow-sm ring-1 ring-sg-border-soft">
                <ServerCog aria-hidden="true" className="h-4 w-4" />
              </span>
              <span className="min-w-0 text-sm font-semibold text-sg-text">{t('startup.service', locale)}</span>
              <LoaderCircle aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 animate-spin text-sg-green" />
            </li>
          </ol>
        )}

        {failed ? (
          <div className="mt-7 grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sg-md bg-sg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sg-accent-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-2"
            >
              <RotateCcw aria-hidden="true" className="h-4 w-4" />
              {t('startup.retry', locale)}
            </button>
            <button
              type="button"
              onClick={onDiagnostics}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-4 py-2.5 text-sm font-semibold text-sg-text transition hover:border-sg-accent hover:bg-sg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-2"
            >
              <FolderOpen aria-hidden="true" className="h-4 w-4" />
              {t('startup.diagnostics', locale)}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sg-md border border-sg-red/30 bg-sg-red-soft px-4 py-2.5 text-sm font-semibold text-sg-red transition hover:border-sg-red hover:bg-sg-red/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-red focus-visible:ring-offset-2"
            >
              <LogOut aria-hidden="true" className="h-4 w-4" />
              {t('startup.close', locale)}
            </button>
          </div>
        ) : (
          <p data-testid="startup-status" role="status" aria-live="polite" className="mt-6 flex items-center gap-2 text-xs font-medium text-sg-text-soft">
            <Check aria-hidden="true" className="h-4 w-4 text-sg-green" />
            {t('startup.preparing', locale)}
          </p>
        )}
      </section>
    </main>
  );
}

function DesktopStartupGate({ children }: DesktopLifecycleProps) {
  const [startup, setStartup] = useState<DesktopStartupState | null>(null);
  const [native] = useState(() => isTauriRuntime());
  const [startupTimedOut, setStartupTimedOut] = useState(false);

  useEffect(() => {
    if (!native) return undefined;

    let active = true;
    const timeout = window.setTimeout(() => {
      if (active) setStartupTimedOut(true);
    }, 30_000);
    const read = async () => {
      const next = await getDesktopStartupState();
      if (active && next) {
        setStartup(next);
        if (next.state === 'ready' || next.state === 'dev') setStartupTimedOut(false);
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 350);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      window.clearInterval(timer);
    };
  }, [native]);

  if (!native) return <>{children}</>;
  if (startup?.state === 'ready' || startup?.state === 'dev') return <>{children}</>;

  const displayState = startupTimedOut && !startup?.state?.match(/failed|error|unsupported|timeout/)
    ? { state: 'timeout', message: 'Yerel çalışma alanı 30 saniye içinde hazır olmadı.' }
    : startup;

  const retry = () => {
    void retryDesktopStartup().then((next) => {
      if (next) setStartup(next);
    });
  };
  const diagnostics = () => {
    void openRuntimeDiagnostics();
  };
  const close = () => {
    void confirmDesktopClose(true);
  };

  return <StartupSplash state={displayState} onRetry={() => { setStartupTimedOut(false); retry(); }} onDiagnostics={diagnostics} onClose={close} />;
}

function DesktopCloseGuard({ children }: DesktopLifecycleProps) {
  const locale = useLocale();
  const [closing, setClosing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const handlingRef = useRef(false);
  const decisionOpenRef = useRef(false);
  const closeAttemptRef = useRef<(discard: boolean) => void>(() => undefined);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    const runCloseAttempt = async (discard: boolean) => {
      if (handlingRef.current) return;
      handlingRef.current = true;
      decisionOpenRef.current = false;
      setFailure(null);
      setClosing(true);
      try {
        if (discard) {
          discardPendingSaves();
        } else {
          resetPendingSaveDiscard();
          await flushPendingSaves({ timeoutMs: 10_000 });
        }
        const closed = await confirmDesktopClose(discard);
        if (!closed) throw new Error(t('close.failed', locale));
      } catch (error) {
        if (!active) return;
        const message = error instanceof PendingSaveError
          ? t('close.unsaved', locale)
          : t('close.failed', locale);
        decisionOpenRef.current = true;
        setFailure(message);
        setClosing(false);
        handlingRef.current = false;
        if (discard) resetPendingSaveDiscard();
      }
    };
    closeAttemptRef.current = (discard) => {
      void runCloseAttempt(discard);
    };

    const handleNativeCloseRequest = () => {
      // Clear the native pending bit for live events as well as for a request
      // recovered immediately after this listener mounts.
      void consumeDesktopCloseRequest();
      // A failed close is waiting for an explicit retry/discard/return
      // decision. Repeated native X events must not restart the save flow and
      // replace the dialog underneath the user.
      if (handlingRef.current || decisionOpenRef.current) return;
      closeAttemptRef.current(false);
    };

    void listenDesktopCloseRequest(handleNativeCloseRequest).then((cleanup) => {
      if (!active) {
        cleanup();
        return;
      }
      unlisten = cleanup;
      void consumeDesktopCloseRequest().then((pending) => {
        if (active && pending && !handlingRef.current && !decisionOpenRef.current) {
          closeAttemptRef.current(false);
        }
      });
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [locale]);

  const retry = () => {
    resetPendingSaveDiscard();
    decisionOpenRef.current = false;
    closeAttemptRef.current(false);
  };

  const discard = () => {
    decisionOpenRef.current = false;
    closeAttemptRef.current(true);
  };

  const focusExcel = () => {
    void focusManagedExcelSession();
  };

  const returnToApp = () => {
    resetPendingSaveDiscard();
    decisionOpenRef.current = false;
    setFailure(null);
    setClosing(false);
    handlingRef.current = false;
  };

  return (
    <>
      {children}
      {closing || failure ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-sg-text/25 px-4 py-6 backdrop-blur-[2px] sm:px-6 sm:py-8">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="desktop-close-title"
            aria-describedby="desktop-close-description"
            className="w-full max-w-lg rounded-sg-xl border border-sg-border bg-sg-surface p-5 text-sg-text shadow-sg-lg sm:p-7"
          >
            <div className="flex items-start gap-4">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sg-lg ${closing ? 'bg-sg-amber-soft text-sg-amber' : 'bg-sg-red-soft text-sg-red'}`}>
                {closing ? <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" /> : <AlertTriangle aria-hidden="true" className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                <h2 id="desktop-close-title" className="text-lg font-semibold text-sg-text">
                  {closing ? t('close.saving', locale) : t('close.failed', locale)}
                </h2>
                <p id="desktop-close-description" aria-live="polite" className="mt-2 text-sm leading-6 text-sg-text-soft">
                  {failure || t('close.savingDetail', locale)}
                </p>
              </div>
            </div>
            {failure ? (
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={focusExcel}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sg-md border border-sg-blue/30 bg-sg-blue-soft px-4 py-2.5 text-sm font-semibold text-sg-text transition hover:border-sg-blue hover:bg-sg-blue/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-blue focus-visible:ring-offset-2"
                >
                  <FileWarning aria-hidden="true" className="h-4 w-4" />
                  {t('workbook.showExcel', locale)}
                </button>
                <button
                  type="button"
                  onClick={retry}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sg-md bg-sg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sg-accent-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-2"
                >
                  <RotateCcw aria-hidden="true" className="h-4 w-4" />
                  {t('close.retry', locale)}
                </button>
                <button
                  type="button"
                  onClick={discard}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sg-md border border-sg-red/30 bg-sg-red-soft px-4 py-2.5 text-sm font-semibold text-sg-red transition hover:border-sg-red hover:bg-sg-red/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-red focus-visible:ring-offset-2"
                >
                  <LogOut aria-hidden="true" className="h-4 w-4" />
                  {t('close.discard', locale)}
                </button>
                <button
                  type="button"
                  onClick={returnToApp}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-4 py-2.5 text-sm font-semibold text-sg-text-soft transition hover:border-sg-accent hover:bg-sg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-2"
                >
                  {t('close.return', locale)}
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}

export function DesktopLifecycle({ children }: DesktopLifecycleProps) {
  return (
    <DesktopCloseGuard>
      <DesktopStartupGate>{children}</DesktopStartupGate>
    </DesktopCloseGuard>
  );
}
