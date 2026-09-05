import { useState, type FormEventHandler } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';

import { getLocale, t } from '@/lib/locale';

type MakeLoginPageProps = {
  email: string;
  password: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  errorMessage: string | null;
  isPending: boolean;
  remember: boolean;
  onRememberChange: (value: boolean) => void;
  credentialWarning: string | null;
};

function BrandMark() {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-brand-200 bg-white shadow-sm">
      <img src="/seroguld-logo.png" alt="Sero Guld" className="h-full w-full scale-[1.35] object-cover object-left" />
    </div>
  );
}

export function MakeLoginPage({
  email,
  password,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  errorMessage,
  isPending,
  remember,
  onRememberChange,
  credentialWarning,
}: MakeLoginPageProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="min-h-svh bg-brand-50 px-4 py-5 text-brand-950 sm:px-6 sm:py-8">
      <div className="login-surface-enter mx-auto grid min-h-[min(720px,calc(100svh-2.5rem))] w-full max-w-5xl overflow-hidden border border-brand-200 border-t-4 border-t-amber-500 bg-white shadow-[0_18px_55px_rgba(82,64,46,0.12)] lg:grid-cols-[1.04fr_0.96fr]">
        <section className="relative hidden overflow-hidden bg-[#fbf6ed] px-8 py-9 lg:flex lg:flex-col lg:px-11 lg:py-11">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-amber-100/70 blur-3xl"
          />
          <div className="relative flex items-start gap-4">
            <BrandMark />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-600">Sero Guld ERP</p>
              <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-[-0.03em] text-brand-950">
                Güvenli çalışma alanı
              </h1>
            </div>
          </div>

          <div className="relative mt-8 max-w-md">
            <p className="text-lg leading-8 text-brand-800">
              Alış, stok, müşteri ve entegrasyon işlemlerine tek güvenilir oturumdan devam edin.
            </p>
          </div>

          <div className="relative mt-auto space-y-4 border-t border-brand-200 pt-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-semibold text-brand-900">Korunaklı operasyon oturumu</p>
                <p className="mt-1 text-sm leading-6 text-brand-600">
                  ERP ayarları ve entegrasyon bağlantıları yalnız yetkili oturumdan yönetilir.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ArrowRight className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-semibold text-brand-900">Tek operasyon hesabı</p>
                <p className="mt-1 text-sm leading-6 text-brand-600">
                  Giriş sonrasında aynı çalışma alanından günlük operasyonunuza dönersiniz.
                </p>
              </div>
            </div>
            <p className="pt-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-brand-500">
              Alış · Depolama · Log · Woo · Uniconta
            </p>
          </div>
        </section>

        <section className="flex flex-col justify-center bg-white px-6 py-8 sm:px-10 sm:py-11">
          <div className="lg:hidden">
            <div className="flex items-center gap-3">
              <BrandMark />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-600">Sero Guld ERP</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-brand-950">Güvenli giriş</h1>
              </div>
            </div>
          </div>

          <div className="mt-7 lg:mt-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-600">Oturum aç</p>
            <h2 className="mt-2 text-3xl font-semibold leading-tight tracking-[-0.03em] text-brand-950">
              Operasyon paneline giriş
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-brand-600">
              Sero Guld çalışma alanına devam etmek için şifrenizi girin.
            </p>
          </div>

          <form className="mt-8 space-y-5" onSubmit={onSubmit}>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">Hesap</span>
              <div className="relative">
                {/* Bootstrap başarısızsa form 'info@seroguld.dk' yedeğiyle kalır;
                    readOnly bu durumda kullanıcıyı yanlış hesaba kilitler. */}
                <input
                  type="email"
                  name="username"
                  value={email}
                  onChange={(event) => onEmailChange(event.target.value)}
                  autoComplete="username"
                  className="min-h-11 w-full border border-brand-300 bg-white px-4 pr-11 text-sm font-medium text-brand-950 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-100"
                />
                <LockKeyhole
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-400"
                />
              </div>
            </label>

            <div>
              <label
                htmlFor="classic-login-password"
                className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-brand-600"
              >
                Şifre
              </label>
              <div className="relative">
                <input
                  id="classic-login-password"
                  name="password"
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  className="min-h-11 w-full border border-brand-300 bg-white px-4 pr-12 text-sm text-brand-950 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-100"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  autoFocus
                  aria-invalid={Boolean(errorMessage)}
                  aria-describedby={errorMessage ? 'classic-login-error' : undefined}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center text-brand-500 transition hover:text-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                >
                  {showPassword ? (
                    <EyeOff aria-hidden="true" className="h-4 w-4" />
                  ) : (
                    <Eye aria-hidden="true" className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {errorMessage ? (
              <p
                id="classic-login-error"
                role="alert"
                className="border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800"
              >
                {errorMessage}
              </p>
            ) : (
              <p className="border-t border-brand-200 pt-4 text-xs leading-5 text-brand-500">
                Yetkili kullanıcı hesabı ile güvenli bağlantı kurulur.
              </p>
            )}

            {/* Modern yüzeydeki gibi gerçek checkbox — {...state} spread'i bu
                prop'ları zaten taşıyordu; bileşen onları sessizce düşürüyordu. */}
            <label className="flex min-h-8 items-center gap-2 text-sm font-medium text-brand-700">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => onRememberChange(event.target.checked)}
                className="h-4 w-4 accent-blue-600"
              />
              {t('auth.login.remember', getLocale())}
            </label>

            {credentialWarning ? (
              <p
                role="status"
                className="border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800"
              >
                {credentialWarning}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isPending}
              className="group flex min-h-12 w-full items-center justify-center gap-2 bg-brand-900 px-4 text-sm font-semibold text-white transition hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShieldCheck aria-hidden="true" className="h-4 w-4 text-amber-300" />
              {isPending ? 'Giriş yapılıyor…' : 'Giriş Yap'}
              {!isPending ? (
                <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              ) : null}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
