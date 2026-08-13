import { KeyRound, LogOut } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { PasswordChangeForm } from '@/components/PasswordChangeForm';
import { clearAuth, getCurrentUser } from '@/lib/auth';
import { t, useLocale } from '@/lib/locale';
import { ModernSection } from '@/modern/design-system';

export function PasswordChangePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const locale = useLocale();
  const user = getCurrentUser();
  const forced = Boolean(user?.must_change_password);
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo || '/dashboard';

  const logout = () => {
    clearAuth();
    navigate('/login', { replace: true });
  };

  return (
    <main data-ui-variant="modern" className="min-h-svh bg-sg-bg px-4 py-6 font-sg text-sg-text sm:px-6 sm:py-10">
      <div className="login-surface-enter mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-[520px] flex-col justify-center sm:min-h-[calc(100svh-5rem)]">
        <ModernSection className="p-6 shadow-sg-md sm:p-8">
          <header className="border-b border-sg-border-soft pb-6">
            <img src="/seroguld-logo.png" alt="Sero Guld" className="h-9 w-auto max-w-[220px] object-contain object-left" />
            <div className="mt-6 flex items-start gap-4">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sg-md bg-sg-blue-soft text-sg-blue">
                <KeyRound aria-hidden="true" className="h-5 w-5" />
              </span>
              <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sg-accent">{t('auth.security.title', locale)}</p>
                <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-[-0.03em] text-sg-text">
                  {forced ? t('auth.password.forcedTitle', locale) : t('auth.password.normalTitle', locale)}
                </h1>
                <p className="mt-2 text-sm leading-6 text-sg-text-soft">
                  {forced
                    ? t('auth.password.forcedDescription', locale)
                    : t('auth.password.normalDescription', locale)}
                </p>
              </div>
            </div>
          </header>

          <div className="mt-6 border border-sg-border-soft bg-sg-surface-soft px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">{t('auth.password.account', locale)}</p>
            <p className="mt-1 text-sm font-semibold text-sg-text">{user?.name || t('auth.password.accountFallback', locale)} · {user?.email || 'info@seroguld.dk'}</p>
          </div>

          <div className="mt-6">
            <PasswordChangeForm forced onSuccess={() => navigate(returnTo, { replace: true })} />
          </div>

          <button type="button" onClick={logout} className="mt-4 flex w-full items-center justify-center gap-2 py-2 text-sm font-medium text-sg-text-soft transition hover:text-sg-text">
            <LogOut aria-hidden="true" className="h-4 w-4" />
            {t('auth.password.logout', locale)}
          </button>
        </ModernSection>
      </div>
    </main>
  );
}
