import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';

import {
  ModernButton,
  ModernField,
  ModernSection,
  ModernTextInput,
} from '@/modern/design-system';

import type { ModernLoginPageProps, ModernStatusItem } from './types';

function BrandMark() {
  return (
    <img src="/seroguld-logo.png" alt="Sero Guld" className="h-9 w-auto max-w-[220px] object-contain object-left" />
  );
}

function diagnosticValue(item: ModernStatusItem) {
  if (item.label.toLocaleLowerCase('tr-TR') !== 'build') return item.value;
  return item.value.replace('T', ' ').replace('Z', '').slice(0, 19);
}

export function ModernLoginPage({ runtime, form }: ModernLoginPageProps) {
  const [showPassword, setShowPassword] = useState(false);
  const diagnostics = runtime.filter((item) => ['frontend', 'build'].includes(item.label.toLocaleLowerCase('tr-TR')));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    form.onSubmit();
  }

  return (
    <main data-ui-variant="modern" className="min-h-svh bg-sg-bg px-4 py-6 font-sg text-sg-text sm:px-6 sm:py-10">
      <div className="login-surface-enter mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-[440px] flex-col justify-center sm:min-h-[calc(100svh-5rem)]">
        <ModernSection className="p-6 shadow-sg-md sm:p-8">
          <div className="border-b border-sg-border-soft pb-6">
            <BrandMark />
            <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-sg-accent">Güvenli erişim</p>
            <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-[-0.03em] text-sg-text">Operasyon paneline giriş</h1>
            <p className="mt-2 text-sm leading-6 text-sg-text-soft">Sero Guld çalışma alanına devam etmek için hesabınızı doğrulayın.</p>
          </div>

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <ModernField label="Hesap">
              <div className="relative">
                <ModernTextInput
                  type="email"
                  name="username"
                  value={form.email}
                  readOnly
                  autoComplete="username"
                  aria-readonly="true"
                  className="bg-sg-surface-soft pr-10 font-medium"
                />
                <LockKeyhole aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sg-text-soft" />
              </div>
            </ModernField>

            <div className="flex flex-col gap-2">
              <label htmlFor="modern-login-password" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Şifre</label>
              <div className="relative">
                <ModernTextInput
                  id="modern-login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(event) => form.onPasswordChange(event.target.value)}
                  placeholder="Şifrenizi girin"
                  autoComplete="current-password"
                  autoFocus
                  aria-invalid={Boolean(form.errorMessage)}
                  aria-describedby={form.errorMessage ? 'modern-login-error' : undefined}
                  className="pr-11"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-sg-sm text-sg-text-soft transition hover:bg-sg-surface-soft hover:text-sg-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent"
                >
                  {showPassword ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {form.errorMessage ? (
              <div id="modern-login-error" role="alert" className="border border-sg-red/20 bg-sg-red-soft px-4 py-3 text-sm leading-6 text-sg-red">
                {form.errorMessage}
              </div>
            ) : null}

            <ModernButton
              type="submit"
              tone="primary"
              size="md"
              icon={LockKeyhole}
              trailingIcon={form.isSubmitting ? undefined : ArrowRight}
              disabled={form.isSubmitting}
              className="min-h-11 w-full"
            >
              {form.isSubmitting ? 'Oturum açılıyor…' : 'Güvenli giriş yap'}
            </ModernButton>
          </form>
        </ModernSection>

        {diagnostics.length > 0 ? (
          <footer className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[10px] font-medium uppercase tracking-[0.14em] text-sg-text-soft/80">
            {diagnostics.map((item, index) => (
              <span key={item.label} className="inline-flex items-center gap-2">
                {index > 0 ? <span aria-hidden="true" className="text-sg-border">·</span> : null}
                <span>{item.label}: {diagnosticValue(item)}</span>
              </span>
            ))}
          </footer>
        ) : null}
      </div>
    </main>
  );
}
