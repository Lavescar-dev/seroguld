import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, AlertCircle, HelpCircle, X } from 'lucide-react';

export type ConfirmVariant = 'default' | 'warning' | 'danger';

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
};

type ConfirmContextValue = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

type PendingConfirm = ConfirmOptions & {
  id: number;
  resolve: (value: boolean) => void;
};

const VARIANT_STYLES: Record<ConfirmVariant, { icon: ReactNode; confirmBtn: string }> = {
  default: {
    icon: <HelpCircle className="h-5 w-5 shrink-0 text-brand-700" />,
    confirmBtn: 'border-brand-700 bg-brand-700 text-white hover:bg-brand-800',
  },
  warning: {
    icon: <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />,
    confirmBtn: 'border-amber-600 bg-amber-600 text-white hover:bg-amber-700',
  },
  danger: {
    icon: <AlertCircle className="h-5 w-5 shrink-0 text-rose-600" />,
    confirmBtn: 'border-rose-600 bg-rose-600 text-white hover:bg-rose-700',
  },
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const counterRef = useRef(0);

  const confirm = useCallback<ConfirmContextValue>((options) => {
    return new Promise<boolean>((resolve) => {
      counterRef.current += 1;
      setPending({ id: counterRef.current, resolve, ...options });
    });
  }, []);

  const close = useCallback(
    (value: boolean) => {
      setPending((current) => {
        if (current) current.resolve(value);
        return null;
      });
    },
    [],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? <ConfirmModal pending={pending} onClose={close} /> : null}
    </ConfirmContext.Provider>
  );
}

function ConfirmModal({
  pending,
  onClose,
}: {
  pending: PendingConfirm;
  onClose: (value: boolean) => void;
}) {
  const variant = pending.variant ?? 'default';
  const styles = VARIANT_STYLES[variant];
  const confirmText = pending.confirmText ?? 'Onayla';
  const cancelText = pending.cancelText ?? 'İptal';

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose(false);
      if (event.key === 'Enter') onClose(true);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`confirm-title-${pending.id}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(false);
      }}
    >
      <div className="relative flex w-full max-w-md flex-col border border-brand-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-brand-200 bg-brand-50 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {styles.icon}
            <p
              id={`confirm-title-${pending.id}`}
              className="truncate text-sm font-black uppercase tracking-widest text-brand-800"
            >
              {pending.title}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onClose(false)}
            className="shrink-0 rounded-sm p-0.5 text-brand-600 opacity-70 transition hover:opacity-100"
            aria-label="Kapat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {pending.message ? (
          <div className="px-5 py-5">
            <p className="whitespace-pre-line text-sm leading-relaxed text-brand-800">
              {pending.message}
            </p>
          </div>
        ) : (
          <div className="py-3" />
        )}
        <div className="flex shrink-0 justify-end gap-2 border-t border-brand-100 bg-brand-50/50 px-4 py-3">
          <button
            type="button"
            onClick={() => onClose(false)}
            autoFocus
            className="border border-brand-300 bg-white px-4 py-1.5 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-100"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={() => onClose(true)}
            className={`border px-4 py-1.5 text-xs font-black uppercase tracking-widest transition ${styles.confirmBtn}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    return (options) => {
      console.warn('[confirm] provider not mounted:', options.title);
      return Promise.resolve(window.confirm(`${options.title}\n\n${options.message ?? ''}`));
    };
  }
  return ctx;
}
