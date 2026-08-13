import { useState } from 'react';
import { LogOut, RotateCcw, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { clearAuth } from '@/lib/auth';
import {
  closeManagedExcelSession,
  discardManagedExcelSession,
  focusManagedExcelSession,
  isTauriRuntime,
  setCustomerDisplayIdle,
} from '@/lib/desktop';
import { getLocale, t, useLocale } from '@/lib/locale';
import {
  discardPendingSaves,
  flushPendingSaves,
  PendingSaveError,
  resetPendingSaveDiscard,
} from '@/lib/saveCoordinator';

type SessionLogoutControlProps = {
  variant: 'modern' | 'classic';
};

export function SessionLogoutControl({ variant }: SessionLogoutControlProps) {
  const navigate = useNavigate();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const logout = async (discard = false) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      if (discard) {
        discardPendingSaves();
      } else {
        resetPendingSaveDiscard();
        await flushPendingSaves({ timeoutMs: 10_000 });
      }
      if (isTauriRuntime()) {
        if (discard) {
          // Discard is an explicit escape hatch: a stale Excel bridge must not
          // trap the operator in the authenticated shell.  Try to clean it up,
          // but always continue to the login screen when the user chose discard.
          try {
            await discardManagedExcelSession();
          } catch {
            // Cleanup is best effort on the discard path. The explicit user
            // decision must still clear the session and navigate to login.
          }
        } else {
          const closed = await closeManagedExcelSession();
          if (!closed) throw new Error(t('auth.logout.excelFailed', getLocale()));
        }
        // Keep the customer-facing monitor from showing the last customer's
        // data after the operator leaves the session.  This is best effort;
        // logout should not be blocked by an unavailable display window.
        try {
          await setCustomerDisplayIdle(variant, locale);
        } catch {
          // The native display window may already be closed or unavailable.
        }
      }
      clearAuth();
      navigate('/login', { replace: true });
    } catch (error) {
      if (discard) resetPendingSaveDiscard();
      setFailure(error instanceof PendingSaveError ? t('auth.logout.failed', locale) : error instanceof Error ? error.message : t('auth.logout.failed', locale));
    } finally {
      setBusy(false);
    }
  };

  const modern = variant === 'modern';
  const buttonClass = modern
    ? 'inline-flex min-h-8 items-center gap-1.5 rounded-sg-sm border-0 bg-transparent px-2.5 text-xs font-semibold text-sg-text-soft transition hover:bg-sg-surface-soft hover:text-sg-text disabled:opacity-50'
    : 'inline-flex min-h-8 items-center gap-1.5 border border-brand-200 bg-white px-2.5 text-[10px] font-black uppercase tracking-widest text-brand-600 transition hover:bg-brand-50 hover:text-brand-950 disabled:opacity-50';

  return (
    <>
      <button type="button" onClick={() => void logout(false)} disabled={busy} className={buttonClass} aria-label={t('auth.logout', locale)}>
        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        {busy ? t('auth.logout.pending', locale) : t('auth.logout', locale)}
      </button>
      {failure ? (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/25 px-4 py-6 backdrop-blur-[2px]">
          <section role="dialog" aria-modal="true" className="w-full max-w-md rounded-sg-lg border border-sg-border bg-sg-surface p-5 shadow-sg-md">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-sg-text">{t('auth.logout.failed', locale)}</h2>
                <p className="mt-2 text-sm leading-6 text-sg-text-soft">{failure}</p>
              </div>
              <button type="button" onClick={() => { resetPendingSaveDiscard(); setFailure(null); }} className="rounded-sg-sm p-1 text-sg-text-soft hover:bg-sg-surface-soft" aria-label={t('close.return', locale)}>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={() => void logout(false)} className="inline-flex items-center gap-1.5 rounded-sg-sm bg-sg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{t('close.retry', locale)}
              </button>
              <button type="button" onClick={() => void logout(true)} className="rounded-sg-sm border border-sg-red/30 bg-sg-red-soft px-3 py-2 text-sm font-semibold text-sg-red">
                {t('close.discard', locale)}
              </button>
              <button type="button" onClick={() => void focusManagedExcelSession()} className="rounded-sg-sm border border-sg-border bg-sg-surface px-3 py-2 text-sm font-semibold text-sg-text">
                {t('workbook.showExcel', locale)}
              </button>
              <button type="button" onClick={() => { resetPendingSaveDiscard(); setFailure(null); }} className="rounded-sg-sm border border-sg-border bg-sg-surface px-3 py-2 text-sm font-semibold text-sg-text-soft">
                {t('close.return', locale)}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
