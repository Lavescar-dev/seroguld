import { ArrowRight, LockKeyhole, ShieldCheck, Workflow } from 'lucide-react';

import {
  ModernBadge,
  ModernButton,
  ModernCard,
  ModernCheckboxField,
  ModernField,
  ModernPage,
  ModernSection,
  ModernSectionHeader,
  ModernTextInput,
} from '@/modern/design-system';

import type { ModernLoginPageProps } from './types';

export function ModernLoginPage({
  runtime,
  form,
  workInboxPreview = [],
  helperNote,
}: ModernLoginPageProps) {
  return (
    <ModernPage className="bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(239,246,255,0.82))]">
      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <ModernSection className="overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_38%),linear-gradient(180deg,#ffffff,#f8fbff)]">
          <ModernSectionHeader
            eyebrow="Yeni Sero Guld"
            title="Tek kullanıcı akışı, sakin giriş yüzeyi"
            description="Mağaza, runtime ve görev görünürlüğünü giriş anında açık bırakan modern önizleme katmanı."
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {runtime.map((item) => (
              <ModernCard key={item.label} className="bg-white">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                <p className="mt-3 text-sm font-medium text-slate-900">{item.value}</p>
                {item.detail ? <p className="mt-2 text-sm text-slate-500">{item.detail}</p> : null}
              </ModernCard>
            ))}
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            <ModernCard className="bg-white">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-50 text-sky-700">
                  <Workflow className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">İş kutusu görünürlüğü</p>
                  <p className="mt-1 text-sm text-slate-500">Excel conflict, Uniconta farkı ve GDPR manuel işleri tek yerde izleyin.</p>
                </div>
              </div>
            </ModernCard>
            <ModernCard className="bg-white">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Aynı veri, yeni görünüm</p>
                  <p className="mt-1 text-sm text-slate-500">UI değişir; açık taslaklar, entegrasyon durumları ve domain state aynı kalır.</p>
                </div>
              </div>
            </ModernCard>
          </div>
          {workInboxPreview.length > 0 ? (
            <div className="mt-5 rounded-[24px] border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Giriş öncesi dikkat alanları</p>
                  <p className="mt-1 text-sm text-slate-500">Son operasyondan taşınan işler.</p>
                </div>
                <ModernBadge tone="warning">{workInboxPreview.length} açık iş</ModernBadge>
              </div>
              <div className="mt-4 space-y-3">
                {workInboxPreview.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ModernBadge tone={item.tone || 'warning'}>{item.meta}</ModernBadge>
                    </div>
                    <p className="mt-2 text-sm font-medium text-slate-900">{item.title}</p>
                    <p className="mt-1 text-sm text-slate-500">{item.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </ModernSection>

        <ModernSection className="bg-white">
          <ModernSectionHeader
            eyebrow="Oturum"
            title="Sero Guld CRM erişimi"
            description="Önizleme yüzeyine geçmek yalnız sunumu değiştirir; oturum ve API bağlamı aynı kalır."
          />
          <div className="mt-5 space-y-4">
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
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {form.errorMessage}
              </div>
            ) : null}
            <ModernButton
              tone="primary"
              icon={LockKeyhole}
              trailingIcon={ArrowRight}
              onClick={form.onSubmit}
              disabled={form.isSubmitting}
            >
              {form.isSubmitting ? 'Oturum açılıyor' : 'Giriş yap'}
            </ModernButton>
            <p className="text-sm leading-6 text-slate-500">
              {helperNote || 'Rol matrisi bu fazda genişletilmedi. Yüzey tek güvenilir operasyon kullanıcısı için hazırlanmıştır.'}
            </p>
          </div>
        </ModernSection>
      </div>
    </ModernPage>
  );
}
