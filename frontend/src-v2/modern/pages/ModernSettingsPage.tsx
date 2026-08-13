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
      { key: 'uniconta_purchase_vat_code_25', label: '%25 alış KDV kodu' },
      { key: 'uniconta_purchase_vat_code_0', label: '%0 alış KDV kodu' },
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
  configured,
  onChange,
}: {
  value: string;
  configured: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="relative">
      <ModernTextInput
        type="password"
        value={value}
        autoComplete="new-password"
        placeholder={configured ? 'Yapılandırıldı · değiştirmek için yeni değer girin' : 'Yeni değer girin'}
        onChange={(event) => onChange?.(event.target.value)}
      />
      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sg-text-soft/50">
        {configured ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </span>
    </div>
  );
}

export function ModernSettingsPage({
  config,
  runtime,
  secretFieldKeys = [],
  uiVariantSlot,
  languageSettingsSlot,
  customerDisplayMonitorSlot,
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
        <SecretField
          value={String(config[field.key] ?? '')}
          configured={Boolean(config.secret_fields_configured?.includes(String(field.key)))}
          onChange={(value) => onFieldChange?.(field.key, value)}
        />
      ) : (
        <ModernTextInput value={String(config[field.key] ?? '')} onChange={(event) => onFieldChange?.(field.key, event.target.value)} />
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
        <div className="mt-5 grid grid-cols-2 gap-2 rounded-sg-lg border border-sg-border bg-sg-surface-soft p-2 lg:grid-cols-4" role="tablist" aria-label="Ayar bölümleri">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'rounded-sg-md border px-3.5 py-3 text-sm font-semibold transition motion-reduce:transition-none',
                activeTab === tab.key
                  ? 'border-sg-accent/30 bg-white text-sg-accent-dark shadow-sm'
                  : 'border-transparent text-sg-text-soft hover:border-sg-border hover:bg-white/70 hover:text-sg-text',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </ModernSection>

      {activeTab === 'platform' ? (
        <>
          <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
            <ModernSection>
              <ModernSectionHeader title="Entegrasyon durumu" description="Bağlantıların güncel hazır olma durumu." />
              <div className="mt-4">
                <StatusGrid items={runtime} />
              </div>
            </ModernSection>
            <ModernSection>
              <ModernSectionHeader title="Firma bilgileri" description="Belge, çıktı ve operasyon ekranlarında kullanılan temel bilgiler." />
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {PLATFORM_FIELDS.map(renderField)}
              </div>
            </ModernSection>
          </div>
          <ModernSection>
            <ModernSectionHeader title="Piyasa oranları" description="Global oran profili ve canlı piyasa kaynağı." />
            <div className="mt-4 space-y-4">
              <label className="flex items-start gap-3 rounded-sg-md border border-sg-border bg-sg-surface-soft p-4">
                <input
                  type="checkbox"
                  checked={Boolean(config.market_rates_live_enabled)}
                  onChange={(event) => onFieldChange?.('market_rates_live_enabled', event.target.checked)}
                  className="mt-1 h-4 w-4 accent-sg-accent"
                />
                <span>
                  <span className="block text-sm font-semibold text-sg-text">Canlı piyasa fiyatlarını otomatik kullan</span>
                  <span className="mt-1 block text-sm leading-6 text-sg-text-soft">Kapalıyken topbardaki oran editöründe kaydedilen global profil kullanılır.</span>
                </span>
              </label>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['Au 24K', config.market_gold],
                  ['Ag 999', config.market_silver],
                  ['Pt', config.market_platin],
                  ['Pd', config.market_palladyum],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-sg-md border border-sg-border bg-sg-surface-soft p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">{label}</p>
                    <p className="mt-1 text-sm font-semibold text-sg-text">{value} DKK/g</p>
                  </div>
                ))}
              </div>
              <p className="text-sm text-sg-text-soft">Detaylı karat ve gümüş oranları topbardaki Au/Ag alanından açılan global editörden düzenlenir.</p>
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

      {activeTab === 'appearance' ? (
        <>
          {uiVariantSlot ? (
            <ModernSection>
              <ModernSectionHeader
                title="Arayüz deneyimi"
                description="Klasik ve yeni arayüz seçimi bu cihaza özeldir; veri ve açık taslaklar korunur."
              />
              <div className="mt-4">{uiVariantSlot}</div>
            </ModernSection>
          ) : null}
          {languageSettingsSlot ? <ModernSection><ModernSectionHeader title="Dil tercihleri" description="Operatör arayüzü ve müşteri ekranı için ayrı dil seçin." /><div className="mt-4">{languageSettingsSlot}</div></ModernSection> : null}
          {customerDisplayMonitorSlot}
        </>
      ) : null}
    </ModernPage>
  );
}
