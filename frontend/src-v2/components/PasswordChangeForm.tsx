import { type FormEvent, useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck, Sparkles } from 'lucide-react';

import { apiRequest } from '@/lib/api';
import { getCurrentUser, isAuthRemembered, setAuth } from '@/lib/auth';
import { deleteStoredLoginPassword, saveStoredLoginPassword } from '@/lib/desktop';
import { t, useLocale } from '@/lib/locale';
import type { AuthTokenResponse } from '@/types';

const PASSWORD_LENGTH = 20;
const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%&*+-=?';
const PASSWORD_CHARACTERS = `${UPPERCASE}${LOWERCASE}${DIGITS}${SYMBOLS}`;

function secureIndex(length: number, cryptoSource: Pick<Crypto, 'getRandomValues'>): number {
  if (!Number.isInteger(length) || length < 1 || length > 256) {
    throw new Error('Invalid secure random range');
  }
  const limit = 256 - (256 % length);
  const byte = new Uint8Array(1);
  do {
    cryptoSource.getRandomValues(byte);
  } while (byte[0] >= limit);
  return byte[0] % length;
}

/** Generates a 20-character password without Math.random or modulo bias. */
export function generateSecurePassword(
  cryptoSource: Pick<Crypto, 'getRandomValues'> = globalThis.crypto,
): string {
  if (!cryptoSource?.getRandomValues) {
    throw new Error('Web Crypto API unavailable');
  }
  const characters = [
    UPPERCASE[secureIndex(UPPERCASE.length, cryptoSource)],
    LOWERCASE[secureIndex(LOWERCASE.length, cryptoSource)],
    DIGITS[secureIndex(DIGITS.length, cryptoSource)],
    SYMBOLS[secureIndex(SYMBOLS.length, cryptoSource)],
  ];
  while (characters.length < PASSWORD_LENGTH) {
    characters.push(PASSWORD_CHARACTERS[secureIndex(PASSWORD_CHARACTERS.length, cryptoSource)]);
  }
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = secureIndex(index + 1, cryptoSource);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join('');
}

type PasswordChangeFormProps = {
  variant?: 'classic' | 'modern';
  forced?: boolean;
  onSuccess?: (response: AuthTokenResponse) => void;
};

export function PasswordChangeForm({
  variant = 'modern',
  forced = false,
  onSuccess,
}: PasswordChangeFormProps) {
  const locale = useLocale();
  const user = getCurrentUser();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const classic = variant === 'classic';

  const inputClass = classic
    ? 'w-full border border-brand-300 bg-white px-3.5 py-2.5 text-sm text-brand-950 outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100'
    : 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50';

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setWarning(null);
    if (!currentPassword || !newPassword || !confirmation) {
      setError(t('auth.password.required', locale));
      return;
    }
    if (newPassword !== confirmation) {
      setError(t('auth.password.mismatch', locale));
      return;
    }

    setSaving(true);
    try {
      const response = await apiRequest<AuthTokenResponse>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          new_password_confirmation: confirmation,
        }),
      });
      const remember = isAuthRemembered();
      const email = response.user.email || user?.email || 'info@seroguld.dk';
      if (remember) {
        const stored = await saveStoredLoginPassword(email, newPassword);
        if (!stored) setWarning(t('auth.remember.failed', locale));
      } else {
        await deleteStoredLoginPassword(email);
      }
      setAuth(response.access_token, response.refresh_token, response.user, remember);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setNotice(t('auth.password.changed', locale));
      onSuccess?.(response);
    } catch (caught) {
      setError(caught instanceof Error && caught.message.trim()
        ? caught.message
        : t('auth.password.failed', locale));
    } finally {
      setSaving(false);
    }
  };

  const generate = () => {
    try {
      const generated = generateSecurePassword();
      setNewPassword(generated);
      setConfirmation(generated);
      setError(null);
      setNotice(t('auth.password.generated', locale));
    } catch {
      setError(t('auth.password.generateFailed', locale));
    }
  };

  return (
    <form className="space-y-5" onSubmit={submit} data-testid="password-change-form">
      {!forced ? (
        <header>
          <h3 className="text-sm font-semibold">{t('auth.security.accountTitle', locale)}</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{t('auth.security.accountDescription', locale)}</p>
        </header>
      ) : null}
      <PasswordInput label={t('auth.password.current', locale)} value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" className={inputClass} />
      <div className="grid gap-4 sm:grid-cols-2">
        <PasswordInput label={t('auth.password.new', locale)} value={newPassword} onChange={setNewPassword} autoComplete="new-password" className={inputClass} />
        <PasswordInput label={t('auth.password.confirm', locale)} value={confirmation} onChange={setConfirmation} autoComplete="new-password" className={inputClass} />
      </div>

      <div className={`flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between ${classic ? 'border-brand-200' : 'border-slate-200'}`}>
        <p className="text-xs leading-5 text-slate-500">{t('auth.password.generatorHint', locale)}</p>
        <button type="button" onClick={generate} className={`inline-flex shrink-0 items-center justify-center gap-2 px-3.5 py-2.5 text-sm font-semibold ${classic ? 'border border-brand-300 text-brand-800 hover:bg-brand-50' : 'rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {t('auth.password.generate', locale)}
        </button>
      </div>

      {error ? <p role="alert" className={`border px-4 py-3 text-sm ${classic ? 'border-red-300 bg-red-50 text-red-800' : 'rounded-lg border-rose-200 bg-rose-50 text-rose-700'}`}>{error}</p> : null}
      {warning ? <p role="status" className={`border px-4 py-3 text-sm ${classic ? 'border-amber-300 bg-amber-50 text-amber-800' : 'rounded-lg border-amber-200 bg-amber-50 text-amber-700'}`}>{warning}</p> : null}
      {notice ? <p role="status" className={`border px-4 py-3 text-sm ${classic ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'rounded-lg border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{notice}</p> : null}

      <button type="submit" disabled={saving} className={`inline-flex min-h-11 w-full items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-60 ${classic ? 'bg-brand-800 hover:bg-brand-900' : 'rounded-lg bg-blue-600 hover:bg-blue-700'}`}>
        {forced ? <KeyRound className="h-4 w-4" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
        {saving
          ? t('auth.password.saving', locale)
          : forced
            ? t('auth.password.save', locale)
            : t('auth.password.saveSettings', locale)}
      </button>
    </form>
  );
}

function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  className: string;
}) {
  const locale = useLocale();
  const [visible, setVisible] = useState(false);
  return (
    <label>
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</span>
      <span className="relative block">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          className={`${className} pr-11`}
          required
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-700"
          aria-label={visible ? t('auth.password.hide', locale) : t('auth.password.show', locale)}
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </span>
    </label>
  );
}
