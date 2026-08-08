import { useMemo, useState } from 'react';
import { Download, Eye, EyeOff, Save, ShieldCheck, Upload } from 'lucide-react';

import {
  ModernBadge,
  ModernButton,
  ModernCard,
  ModernField,
  ModernPage,
  ModernSection,
  ModernSectionHeader,
  ModernTextInput,
  cn,
} from '@/modern/design-system';

import { StatusGrid } from './shared';
import type { ModernSettingsPageProps } from './types';

type ConfigKey = keyof ModernSettingsPageProps['config'];

type FieldDef = { key: ConfigKey; label: string };

const PLATFORM_FIELDS: FieldDef[] = [
  { key: 'firma_adi', label: 'Firma adı' },
  { key: 'firma_email', label: 'Firma e-postası' },
  { key: 'firma_telefon', label: 'Telefon' },
  { key: 'firma_adres', label: 'Adres' },
  { key: 'firma_cvr', label: 'CVR' },
];

const INTEGRATION_GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'AI ve OPMC',
    fields: [
      { key: 'openai_model', label: 'OpenAI model' },
      { key: 'openai_max_tokens', label: 'Token sınırı' },
      { key: 'openai_api_key', label: 'OpenAI anahtarı' },
      { key: 'opmc_api_url', label: 'OPMC URL' },
      { key: 'opmc_api_key', label: 'OPMC anahtarı' },
      { key: 'opmc_webhook_secret', label: 'OPMC webhook secret' },
    ],
  },
  {
    title: 'WooCommerce ve WordPress',
    fields: [
      { key: 'woo_store_url', label: 'Woo store URL' },
      { key: 'woo_consumer_key', label: 'Woo consumer key' },
      { key: 'woo_consumer_secret', label: 'Woo consumer secret' },
      { key: 'woo_webhook_secret', label: 'Woo webhook secret' },
      { key: 'wp_site_url', label: 'WordPress URL' },
      { key: 'wp_username', label: 'WP kullanıcı adı' },
      { key: 'wp_app_password', label: 'WP app password' },
    ],
  },
  {
    title: 'Uniconta ve piyasa',
    fields: [
      { key: 'uniconta_api_url', label: 'Uniconta URL' },
      { key: 'uniconta_username', label: 'Uniconta kullanıcı adı' },
      { key: 'uniconta_password', label: 'Uniconta şifre' },
      { key: 'uniconta_company_id', label: 'Company ID' },
      { key: 'uniconta_api_key', label: 'Uniconta API key' },
      { key: 'market_gold', label: 'Altın' },
      { key: 'market_silver', label: 'Gümüş' },
      { key: 'market_platin', label: 'Platin' },
      { key: 'market_palladyum', label: 'Palladyum' },
    ],
  },
];

const TABS = [
  { key: 'platform', label: 'Platform ve Ekran' },
  { key: 'integrations', label: 'Entegrasyonlar' },
  { key: 'security', label: 'Güvenlik' },
  { key: 'appearance', label: 'Görünüm' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

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
      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sg-text-soft/50">
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
  const [activeTab, setActiveTab] = useState<TabKey>('platform');

  const renderField = (field: FieldDef) => (
    <ModernField key={field.key} label={field.label}>
      {secretFieldKeys.includes(field.key) ? (
        <SecretField value={config[field.key]} onChange={(value) => onFieldChange?.(field.key, value)} />
      ) : (
        <ModernTextInput value={config[field.key]} onChange={(event) => onFieldChange?.(field.key, event.target.value)} />
      )}
    </ModernField>
  );

  const secretFields = useMemo(
    () => INTEGRATION_GROUPS.flatMap((group) => group.fields).filter((field) => secretFieldKeys.includes(field.key)),
    [secretFieldKeys],
  );

  return (
    <ModernPage>
      <ModernSection>
        <ModernSectionHeader
          eyebrow="Sistem yapılandırması"
          title="Ayarlar"
          description="Secret değerler tarayıcıya geri dönmez; kaydetme mevcut yapılandırma akışıyla yapılır ve sonuç bu yüzeyde görünür."
          action={
            <div className="flex flex-wrap items-center gap-2">
              {savedLabel ? <ModernBadge tone="success">{savedLabel}</ModernBadge> : null}
              {onImport ? <ModernButton tone="ghost" icon={Upload} onClick={onImport}>İçe aktar</ModernButton> : null}
              {onExport ? <ModernButton tone="ghost" icon={Download} onClick={onExport}>Dışa aktar</ModernButton> : null}
              <ModernButton tone="success" icon={Save} onClick={onSave} disabled={isSaving || saveAvailability?.state === 'unavailable'}>
                {isSaving ? 'Kaydediliyor' : 'Değişiklikleri kaydet'}
              </ModernButton>
            </div>
          }
        />
        <div className="mt-4 flex flex-wrap gap-1 border-b border-sg-border-soft pb-px" role="tablist" aria-label="Ayar bölümleri">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                '-mb-px border-b-2 px-3.5 py-2.5 text-sm font-medium transition motion-reduce:transition-none',
                activeTab === tab.key
                  ? 'border-sg-accent text-sg-accent-dark'
                  : 'border-transparent text-sg-text-soft hover:text-sg-text',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </ModernSection>

      {activeTab === 'platform' ? (
        <>
          <ModernSection>
            <ModernSectionHeader title="Entegrasyon durumu" description="Yapılandırılan bağlantıların mevcut readiness görünümü." />
            <div className="mt-4">
              <StatusGrid items={runtime} />
            </div>
          </ModernSection>
          <ModernSection>
            <ModernSectionHeader title="Şirket ve runtime" />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {PLATFORM_FIELDS.map(renderField)}
            </div>
          </ModernSection>
        </>
      ) : null}

      {activeTab === 'integrations' ? (
        <div className="grid gap-5 xl:grid-cols-2">
          {INTEGRATION_GROUPS.map((group) => (
            <ModernSection key={group.title}>
              <ModernSectionHeader title={group.title} />
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {group.fields.map(renderField)}
              </div>
            </ModernSection>
          ))}
        </div>
      ) : null}

      {activeTab === 'security' ? (
        <>
          <ModernSection>
            <ModernSectionHeader title="Secret alanları" description="Maskeli tutulan gizli değerler; yalnızca yeni değer girilirse güncellenir." />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {secretFields.map(renderField)}
            </div>
          </ModernSection>
          <ModernCard className="bg-sg-surface-soft">
            <div className="flex items-center gap-2 text-sg-text">
              <ShieldCheck className="h-4 w-4 text-sg-green" />
              <p className="text-sm font-semibold">Güvenlik notu</p>
            </div>
            <p className="mt-2 text-sm leading-6 text-sg-text-soft">
              Secret değerler maskeli gösterilir; kaydetme mevcut yapılandırma akışı (PATCH) üzerinden yapılır ve sonuç bu yüzeyde rozetiyle görünür.
            </p>
          </ModernCard>
        </>
      ) : null}

      {activeTab === 'appearance' && uiVariantSlot ? (
        <ModernSection>
          <ModernSectionHeader
            title="Arayüz deneyimi"
            description="Klasik ve yeni arayüz seçimi bu cihaza özeldir; veri ve açık taslaklar korunur."
          />
          <div className="mt-4">{uiVariantSlot}</div>
        </ModernSection>
      ) : null}
    </ModernPage>
  );
}
