import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X, AlertTriangle } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export type ToastInput = {
  message: string;
  tone?: ToastTone;
  description?: string;
  durationMs?: number;
};

type ToastInternal = ToastInput & { id: number; createdAt: number };

type ToastContextValue = {
  show: (input: ToastInput | string) => void;
  success: (message: string, description?: string) => void;
  error: (message: string, description?: string) => void;
  warning: (message: string, description?: string) => void;
  info: (message: string, description?: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 4500;
const ERROR_DURATION_MS = 7000;

const TONE_STYLES: Record<ToastTone, { container: string; icon: ReactNode }> = {
  success: {
    container: 'border-emerald-400 bg-emerald-50 text-emerald-900',
    icon: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />,
  },
  error: {
    container: 'border-rose-400 bg-rose-50 text-rose-900',
    icon: <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />,
  },
  warning: {
    container: 'border-amber-400 bg-amber-50 text-amber-900',
    icon: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />,
  },
  info: {
    container: 'border-sky-400 bg-sky-50 text-sky-900',
    icon: <Info className="h-4 w-4 shrink-0 text-sky-600" />,
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastInternal[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((input: ToastInput | string) => {
    counterRef.current += 1;
    const id = counterRef.current;
    const payload: ToastInput = typeof input === 'string' ? { message: input } : input;
    const tone: ToastTone = payload.tone ?? 'info';
    const duration = payload.durationMs ?? (tone === 'error' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS);
    setToasts((current) => [
      ...current,
      { id, createdAt: Date.now(), tone, durationMs: duration, ...payload },
    ]);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (m, d) => show({ tone: 'success', message: m, description: d }),
      error: (m, d) => show({ tone: 'error', message: m, description: d }),
      warning: (m, d) => show({ tone: 'warning', message: m, description: d }),
      info: (m, d) => show({ tone: 'info', message: m, description: d }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-toast flex w-full max-w-sm flex-col gap-2 print:hidden">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastInternal; onDismiss: () => void }) {
  const tone = toast.tone ?? 'info';
  const styles = TONE_STYLES[tone];

  useEffect(() => {
    const timer = window.setTimeout(onDismiss, toast.durationMs ?? DEFAULT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast.durationMs, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto flex items-start gap-3 border-l-4 bg-white px-4 py-3 shadow-lg ${styles.container}`}
    >
      {styles.icon}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-snug">{toast.message}</p>
        {toast.description ? (
          <p className="mt-0.5 text-xs leading-snug opacity-80">{toast.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-sm p-0.5 opacity-60 transition hover:opacity-100"
        aria-label="Kapat"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback: provider yoksa console + window.alert (graceful degradation)
    return {
      show: (input) => {
        const msg = typeof input === 'string' ? input : input.message;
        console.warn('[toast] provider not mounted:', msg);
      },
      success: (m) => console.info('[toast.success]', m),
      error: (m) => console.error('[toast.error]', m),
      warning: (m) => console.warn('[toast.warning]', m),
      info: (m) => console.info('[toast.info]', m),
    };
  }
  return ctx;
}
