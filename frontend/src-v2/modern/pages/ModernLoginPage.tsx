import { ArrowRight, Inbox, LockKeyhole, ShieldCheck, Store, Workflow } from 'lucide-react';

import {
  ModernBadge,
  ModernButton,
  ModernCard,
  ModernCheckboxField,
  ModernField,
  ModernSection,
  ModernTextInput,
  cn,
  type ModernTone,
} from '@/modern/design-system';

import type { ModernLoginPageProps } from './types';

const toneDotClasses: Record<ModernTone, string> = {
  neutral: 'bg-sg-text-soft/50',
  primary: 'bg-sg-accent',
  success: 'bg-sg-green',
  warning: 'bg-sg-amber',
  danger: 'bg-sg-red',
  info: 'bg-sg-blue',
};

function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-sg-md bg-sg-surface ring-1 ring-sg-border', box)}>
      <img src="/seroguld-logo.png" alt="Sero Guld" className="h-full w-full scale-[1.35] object-cover object-left" />
    </span>
  );
}

export function ModernLoginPage({
  runtime,
  form,
  workInboxPreview = [],
  helperNote,
}: ModernLoginPageProps) {
  return (
    <div data-ui-variant="modern" className="relative min-h-screen overflow-x-hidden bg-sg-bg font-sg text-sg-text">
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-sg-accent-soft/50 blur-3xl" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1180px] items-center px-4 py-8 sm:px-6">
        <div className="grid w-full gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          {/* Sol: ürün çerçevesi */}
          <ModernSection className="p-5 sm:p-7">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sg-accent">Sero Guld ERP · Güvenli erişim</p>
            <h1 className="mt-3 text-2xl font-bold leading-tight tracking-[-0.02em] text-sg-text sm:text-3xl">
              Operasyon, müşteri, Excel aynası ve muhasebe tek giriş akışında.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-sg-text-soft">
              Oturum açıldığında shell, entegrasyonlar ve operasyon ekranları aynı masaüstü akışı içinde yüklenir.
              V1 için ayrıntılı rol matrisi yerine basit ve güvenilir tek kullanıcı akışı hedeflenir.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {runtime.map((item) => (
                <ModernCard key={item.label} className="bg-sg-surface">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">
                    <span className={cn('h-1.5 w-1.5 rounded-full', toneDotClasses[item.tone ?? 'neutral'])} />
                    {item.label}
                  </p>
                  <p className="mt-2 truncate text-sm font-semibold text-sg-text" title={item.value}>{item.value}</p>
                  {item.detail ? <p className="mt-1 text-xs text-sg-text-soft">{item.detail}</p> : null}
                </ModernCard>
              ))}
            </div>

            <div className="mt-6">
              <p className="text-sm font-semibold text-sg-text">V1 başlangıç çerçevesi</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <ModernCard className="bg-sg-surface">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-sg-md bg-sg-accent-soft text-sg-accent-dark"><ShieldCheck className="h-4 w-4" /></span>
                    <p className="text-sm font-semibold text-sg-text">Tek kullanıcı akışı</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-sg-text-soft">İlk sürümde ayrıntılı rol matrisi yok. Menü ve işlem akışları tek güvenilir operasyon kullanıcısı için sadeleştirildi.</p>
                </ModernCard>
                <ModernCard className="bg-sg-surface">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-sg-md bg-sg-green-soft text-sg-green-strong"><Store className="h-4 w-4" /></span>
                    <p className="text-sm font-semibold text-sg-text">Mağaza ve ortam</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-sg-text-soft">Aktif ortam, runtime ve entegrasyon durumu girişten sonra topbar ve Ayarlar üzerinde görünür kalır.</p>
                </ModernCard>
                <ModernCard className="bg-sg-surface">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-sg-md bg-sg-amber-soft text-sg-amber"><Inbox className="h-4 w-4" /></span>
                    <p className="text-sm font-semibold text-sg-text">İş kutusu</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-sg-text-soft">Excel conflict, Uniconta farkı, GDPR manuel işleri ve müşteri ekranı sorunları tek görev merkezinde toplanır.</p>
                </ModernCard>
                <ModernCard className="bg-sg-surface">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-sg-md bg-sg-blue-soft text-sg-accent-dark"><Workflow className="h-4 w-4" /></span>
                    <p className="text-sm font-semibold text-sg-text">Aynı veri, iki arayüz</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-sg-text-soft">Klasik ve yeni arayüz aynı API ve domain state'i kullanır; geçiş Ayarlar'dan cihaz bazlı yapılır.</p>
                </ModernCard>
              </div>
            </div>

            {workInboxPreview.length > 0 ? (
              <div className="mt-5 rounded-sg-lg border border-sg-border bg-sg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-sg-text">Giriş öncesi dikkat alanları</p>
                    <p className="mt-1 text-sm text-sg-text-soft">Son operasyondan taşınan işler.</p>
                  </div>
                  <ModernBadge tone="warning">{workInboxPreview.length} açık iş</ModernBadge>
                </div>
                <div className="mt-4 space-y-3">
                  {workInboxPreview.map((item) => (
                    <div key={item.id} className="rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3">
                      <ModernBadge tone={item.tone || 'warning'}>{item.meta}</ModernBadge>
                      <p className="mt-2 text-sm font-medium text-sg-text">{item.title}</p>
                      <p className="mt-1 text-sm text-sg-text-soft">{item.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </ModernSection>

          {/* Sağ: giriş kartı */}
          <ModernSection className="h-fit p-5 sm:p-7 lg:sticky lg:top-8">
            <div className="flex items-center gap-3">
              <BrandMark size="lg" />
              <div>
                <p className="text-base font-bold tracking-[0.04em] text-sg-text">Sero Guld ERP</p>
                <p className="mt-0.5 text-sm text-sg-text-soft">Güvenli oturum açın ve operasyona devam edin.</p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <ModernField label="E-posta">
                <ModernTextInput
                  autoComplete="username"
                  placeholder="info@seroguld.dk"
                  value={form.email}
                  onChange={(event) => form.onEmailChange?.(event.target.value)}
                />
              </ModernField>
              <ModernField label="Şifre">
                <ModernTextInput
                  type="password"
                  autoComplete="current-password"
                  placeholder="Şifrenizi girin"
                  value={form.password}
                  onChange={(event) => form.onPasswordChange?.(event.target.value)}
                />
              </ModernField>
              <ModernCheckboxField
                label="Bu cihazda oturumu koru"
                description="Yerel tercih ve son arayüz seçimi bu cihazda saklanabilir."
                checked={form.remember}
                onChange={form.onRememberChange}
              />
              {form.errorMessage ? (
                <div className="rounded-sg-md border border-sg-red/20 bg-sg-red-soft px-4 py-3 text-sm text-sg-red">
                  {form.errorMessage}
                </div>
              ) : null}
              <ModernButton
                tone="success"
                size="md"
                icon={LockKeyhole}
                trailingIcon={ArrowRight}
                onClick={form.onSubmit}
                disabled={form.isSubmitting}
                className="min-h-11 w-full"
              >
                {form.isSubmitting ? 'Oturum açılıyor' : 'Güvenli giriş yap'}
              </ModernButton>
              <p className="text-sm leading-6 text-sg-text-soft">
                {helperNote || 'Rol matrisi bu fazda genişletilmedi. Yüzey tek güvenilir operasyon kullanıcısı için hazırlanmıştır.'}
              </p>
            </div>
          </ModernSection>
        </div>
      </div>
    </div>
  );
}
