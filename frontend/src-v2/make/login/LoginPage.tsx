import type { FormEventHandler } from 'react';
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';

type MakeLoginPageProps = {
  email: string;
  password: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  errorMessage: string | null;
  isPending: boolean;
};

export function MakeLoginPage({
  email,
  password,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  errorMessage,
  isPending,
}: MakeLoginPageProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#3a2d21_0%,#120f0c_56%,#07080c_100%)] px-6 py-10 text-white">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[36px] border border-amber-400/20 bg-[#120f0c]/95 shadow-[0_30px_90px_rgba(0,0,0,0.45)] lg:grid-cols-[1.1fr_0.9fr]">
        <section className="hidden border-r border-amber-400/10 bg-[linear-gradient(180deg,rgba(33,26,20,0.98)_0%,rgba(16,13,10,0.98)_100%)] px-10 py-12 lg:flex lg:flex-col">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3">
              <ShieldCheck className="h-7 w-7 text-amber-300" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.32em] text-brand-400">Seroguld Desktop</p>
              <h1
                className="mt-2 text-3xl font-black uppercase tracking-[0.18em] text-[#c0b296]"
                style={{ fontFamily: "'IBM Plex Mono', monospace" }}
              >
                ERP SYSTEM
              </h1>
            </div>
          </div>

          <div className="mt-10 space-y-6">
            <div className="border border-brand-800 bg-brand-950/70 px-5 py-4">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-400">Admin Access</p>
              <p className="mt-3 max-w-md text-sm leading-7 text-brand-200">
                Masaustu operasyonlari, piyasa oranlari, entegrasyonlar ve musterili alim akislari bu oturumdan
                yonetilir.
              </p>
            </div>

            <div className="grid gap-3 text-sm text-brand-300">
              <div className="flex items-start gap-3 border border-brand-800 bg-brand-900/40 px-4 py-3">
                <LockKeyhole className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
                <div>
                  <p className="font-semibold text-brand-100">Güvenli admin oturumu</p>
                  <p className="mt-1 text-xs leading-6 text-brand-400">
                    API anahtarlari, entegrasyon baglantilari ve ERP ayarlari yalniz bu oturumdan duzenlenir.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 border border-brand-800 bg-brand-900/40 px-4 py-3">
                <ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
                <div>
                  <p className="font-semibold text-brand-100">Hazir giris bilgileri</p>
                  <p className="mt-1 text-xs leading-6 text-brand-400">
                    Demo admin bilgileri formda onceden dolduruldu; istersen bu ekran uzerinden dogrudan giris
                    yapabilirsin.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-auto border-t border-brand-800 pt-5">
            <p
              className="text-[10px] uppercase tracking-[0.26em] text-brand-500"
              style={{ fontFamily: "'IBM Plex Mono', monospace" }}
            >
              Alis · Depolama · Log · Woo · Uniconta
            </p>
          </div>
        </section>

        <section className="px-7 py-8 sm:px-10 sm:py-10">
          <div className="flex items-center gap-3 lg:hidden">
            <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3">
              <ShieldCheck className="h-6 w-6 text-amber-300" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.32em] text-brand-300">Sero Guld</p>
              <h1 className="mt-1 text-2xl font-semibold">Desktop Sign In</h1>
            </div>
          </div>

          <div className="hidden lg:block">
            <p className="text-[11px] uppercase tracking-[0.3em] text-brand-400">Admin Login</p>
            <h2 className="mt-3 text-3xl font-semibold text-white">Desktop Sign In</h2>
            <p className="mt-3 max-w-md text-sm leading-7 text-brand-300">
              Sero Guld operasyon paneline erismek icin admin hesabinizla oturum acin.
            </p>
          </div>

          <form className="mt-8 space-y-4" onSubmit={onSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-brand-200">E-posta</span>
              <input
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-amber-400/40 focus:bg-white/10"
                type="email"
                autoComplete="username"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-brand-200">Şifre</span>
              <input
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-amber-400/40 focus:bg-white/10"
                type="password"
                autoComplete="current-password"
              />
            </label>

            {errorMessage ? (
              <p className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {errorMessage}
              </p>
            ) : (
              <div className="rounded-2xl border border-brand-800 bg-brand-950/70 px-4 py-3 text-xs leading-6 text-brand-400">
                Admin oturumu acildiginda shell, entegrasyonlar ve admin ekranlari ayni masaustu akisi icinde yuklenir.
              </div>
            )}

            <button
              type="submit"
              disabled={isPending}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 px-4 py-3 font-semibold text-white transition hover:bg-brand-400 disabled:opacity-60"
            >
              <ShieldCheck className="h-4 w-4" />
              {isPending ? 'Giriş yapılıyor...' : 'Giriş Yap'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
