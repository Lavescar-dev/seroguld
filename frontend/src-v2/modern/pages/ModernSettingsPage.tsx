import { useMemo } from 'react';
import { Download, Eye, EyeOff, Save, Upload } from 'lucide-react';

import {
  ModernBadge,
  ModernButton,
  ModernCard,
  ModernField,
  ModernPage,
  ModernSection,
  ModernSectionHeader,
  ModernTextInput,
} from '@/modern/design-system';

import { AvailabilityBanner, StatusGrid } from './shared';
import type { ModernSettingsPageProps } from './types';

function SecretField({
  value,
  onChange,
}: {
  value: string;
  onChange?: (value: string) => void;
}) {
  const concealed = useMemo(() => !value || /^(\*|•)+$/.test(value) ? value : '••••••••••••', [value]);
  return (
    <div className="relative">
      <ModernTextInput type="password" value={value || concealed} onChange={(event) => onChange?.(event.target.value)} />
      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-slate-300">
        {value ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </span>
    </div>
  );
}

export function ModernSettingsPage({
  config,
  runtime,
  secretFieldKeys = [],
  uiVariantSlot,
  onFieldChange,
  onSave,
  onImport,
  onExport,
  saveAvailability,
  isSaving,
  savedLabel,
}: ModernSettingsPageProps) {
  const groups = [
    {
      title: 'Şirket ve runtime',
      fields: [
        ['firma_adi', 'Firma adı'],
        ['firma_email', 'Firma e-postası'],
        ['firma_telefon', 'Telefon'],
        ['firma_adres', 'Adres'],
        ['firma_cvr', 'CVR'],
      ] as const,
    },
    {
      title: 'AI ve OPMC',
      fields: [
        ['openai_model', 'OpenAI model'],
        ['openai_max_tokens', 'Token sınırı'],
        ['openai_api_key', 'OpenAI anahtarı'],
        ['opmc_api_url', 'OPMC URL'],
        ['opmc_api_key', 'OPMC anahtarı'],
        ['opmc_webhook_secret', 'OPMC webhook secret'],
      ] as const,
    },
    {
      title: 'WooCommerce ve WordPress',
      fields: [
        ['woo_store_url', 'Woo store URL'],
        ['woo_consumer_key', 'Woo consumer key'],
        ['woo_consumer_secret', 'Woo consumer secret'],
        ['woo_webhook_secret', 'Woo webhook secret'],
        ['wp_site_url', 'WordPress URL'],
        ['wp_username', 'WP kullanıcı adı'],
        ['wp_app_password', 'WP app password'],
      ] as const,
    },
    {
      title: 'Uniconta ve piyasa',
      fields: [
        ['uniconta_api_url', 'Uniconta URL'],
        ['uniconta_username', 'Uniconta kullanıcı adı'],
        ['uniconta_password', 'Uniconta şifre'],
        ['uniconta_company_id', 'Company ID'],
        ['uniconta_api_key', 'Uniconta API key'],
        ['market_gold', 'Altın'],
        ['market_silver', 'Gümüş'],
        ['market_platin', 'Platin'],
        ['market_palladyum', 'Palladyum'],
      ] as const,
    },
  ];

  return (
    <ModernPage>
      <ModernSection>
        <ModernSectionHeader
          eyebrow="Ayarlar"
          title="Entegrasyon ve görünüm tercihi"
          description="Bu yüzey yerel tercih ve mevcut config değerlerini aynı masaüstü dilinde gösterir. Kaydetme davranışı gerçek hook bağlanana kadar açıkça sınırlandırılır."
          action={
            <div className="flex flex-wrap items-center gap-2">
              {savedLabel ? <ModernBadge tone="success">{savedLabel}</ModernBadge> : null}
              {onImport ? <ModernButton tone="ghost" icon={Upload} onClick={onImport}>İçe aktar</ModernButton> : null}
              {onExport ? <ModernButton tone="ghost" icon={Download} onClick={onExport}>Dışa aktar</ModernButton> : null}
              <ModernButton tone="primary" icon={Save} onClick={onSave} disabled={isSaving || saveAvailability?.state === 'unavailable'}>
                {isSaving ? 'Kaydediliyor' : 'Kaydet'}
              </ModernButton>
            </div>
          }
        />
        <div className="mt-5">
          <StatusGrid items={runtime} />
        </div>
      </ModernSection>

      <AvailabilityBanner availability={saveAvailability} />

      {uiVariantSlot ? (
        <ModernSection>
          <ModernSectionHeader
            title="Arayüz deneyimi"
            description="Klasik ve modern yüzey seçimi bu cihaza özeldir; veri ve açık taslaklar korunur."
          />
          <div className="mt-4">{uiVariantSlot}</div>
        </ModernSection>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        {groups.map((group) => (
          <ModernSection key={group.title}>
            <ModernSectionHeader title={group.title} />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {group.fields.map(([key, label]) => (
                <ModernField key={key} label={label}>
                  {secretFieldKeys.includes(key) ? (
                    <SecretField value={config[key]} onChange={(value) => onFieldChange?.(key, value)} />
                  ) : (
                    <ModernTextInput value={config[key]} onChange={(event) => onFieldChange?.(key, event.target.value)} />
                  )}
                </ModernField>
              ))}
            </div>
          </ModernSection>
        ))}
      </div>

      <ModernCard className="bg-slate-50/80">
        <p className="text-sm font-semibold text-slate-900">Güvenlik notu</p>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Secret alanları maskeleyen gerçek PATCH akışı bu yüzeye daha sonra bağlanmalı. Bu export yalnız typed sunum katmanıdır.
        </p>
      </ModernCard>
    </ModernPage>
  );
}
