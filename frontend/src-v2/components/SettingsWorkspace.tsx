import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  Eye,
  EyeOff,
  Globe2,
  Monitor,
  Plug,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  Trash2,
  TrendingUp,
  Upload,
} from 'lucide-react';

import type { ApiConfig } from '@/make/settings/types';
import { PasswordChangeForm } from '@/components/PasswordChangeForm';
import { BackupSettingsPanel } from '@/components/BackupSettingsPanel';
import { deleteStoredLoginPassword } from '@/lib/desktop';
import { getCurrentUser } from '@/lib/auth';
import { getLocale, t } from '@/lib/locale';

type SettingsVariant = 'classic' | 'modern';
type ConfigKey = keyof ApiConfig;
type CategoryKey = 'general' | 'appearance' | 'market' | 'integrations' | 'data';
type IntegrationKey = 'openai' | 'opmc' | 'woocommerce' | 'wordpress' | 'uniconta';

type SettingsWorkspaceProps = {
  variant: SettingsVariant;
  config: ApiConfig;
  saved: boolean;
  isSaving: boolean;
  confirmReset: boolean;
  apiStatus: Array<{ name: string; ok: boolean }>;
  configuredCount: number;
  onUpdate: (key: ConfigKey, value: string | boolean) => void;
  onSave: () => void;
  onReset: () => void;
  onExport: () => void;
  onImport: () => void;
  uiVariantSlot: ReactNode;
  languageSlot: ReactNode;
  monitorSlot: ReactNode;
};

type FieldDefinition = {
  key: ConfigKey;
  label: string;
  placeholder?: string;
  secret?: boolean;
  wide?: boolean;
};

const CATEGORIES: Array<{ key: CategoryKey; label: string; description: string; icon: typeof Building2 }> = [
  { key: 'general', label: 'Genel', description: 'Firma ve belge bilgileri', icon: Building2 },
  { key: 'appearance', label: 'Görünüm ve ekran', description: 'Arayüz, dil ve monitör', icon: Monitor },
  { key: 'market', label: 'Piyasa oranları', description: 'Canlı kaynak ve metal oranları', icon: TrendingUp },
  { key: 'integrations', label: 'Entegrasyonlar', description: 'Harici servis bağlantıları', icon: Plug },
  { key: 'data', label: 'Hesap ve güvenlik', description: 'Parola, yedekleme ve yerel veriler', icon: Shield },
];

const CATEGORY_COPY: Record<CategoryKey, { eyebrow: string; title: string; description: string }> = {
  general: { eyebrow: 'İşletme profili', title: 'Genel ayarlar', description: 'Belge, çıktı ve operasyon ekranlarında kullanılan firma bilgileri.' },
  appearance: { eyebrow: 'Bu cihaz', title: 'Görünüm ve ekran', description: 'Operatör arayüzünü, dilleri ve müşteri ekranının hangi monitörde açılacağını yönetin.' },
  market: { eyebrow: 'Fiyatlandırma', title: 'Piyasa oranları', description: 'Yeni işlemlerde kullanılacak canlı fiyat kaynağını ve kayıtlı oran profilini yönetin.' },
  integrations: { eyebrow: 'Bağlantılar', title: 'Entegrasyonlar', description: 'Harici servislerin bağlantı bilgilerini ve mevcut yapılandırma durumunu yönetin.' },
  data: { eyebrow: 'Hesap koruması', title: 'Hesap ve güvenlik', description: 'Parolanızı, güvenli cihaz kaydını ve yerel verileri yönetin.' },
};

const COMPANY_FIELDS: FieldDefinition[] = [
  { key: 'firma_adi', label: 'Firma adı', placeholder: 'Sero Guld og Sølv ApS' },
  { key: 'firma_email', label: 'Firma e-postası', placeholder: 'info@seroguld.dk' },
  { key: 'firma_telefon', label: 'Telefon', placeholder: '+45 00 00 00 00' },
  { key: 'firma_cvr', label: 'CVR', placeholder: '34093083' },
  { key: 'firma_adres', label: 'Adres', placeholder: 'Cadde, posta kodu ve şehir', wide: true },
];

const INTEGRATIONS: Array<{
  key: IntegrationKey;
  label: string;
  description: string;
  fields: FieldDefinition[];
}> = [
  {
    key: 'openai',
    label: 'OpenAI',
    description: 'Ürün metni, SEO ve yapay zekâ özellikleri.',
    fields: [
      { key: 'openai_model', label: 'Model', placeholder: 'gpt-4o' },
      { key: 'openai_max_tokens', label: 'Maksimum token', placeholder: '4096' },
      { key: 'openai_api_key', label: 'API anahtarı', placeholder: 'sk-proj-...', secret: true, wide: true },
    ],
  },
  {
    key: 'opmc',
    label: 'OPMC',
    description: 'Risk analizi ve sipariş izleme bağlantısı.',
    fields: [
      { key: 'opmc_api_url', label: 'API URL', placeholder: 'https://api.opmc.dk/v1', wide: true },
      { key: 'opmc_api_key', label: 'API anahtarı', placeholder: 'opmc_...', secret: true },
      { key: 'opmc_webhook_secret', label: 'Webhook gizli anahtarı', placeholder: 'whsec_...', secret: true },
    ],
  },
  {
    key: 'woocommerce',
    label: 'WooCommerce',
    description: 'Ürün yayını, fiyat senkronizasyonu ve siparişler.',
    fields: [
      { key: 'woo_store_url', label: 'Mağaza URL', placeholder: 'https://seroguld.dk', wide: true },
      { key: 'woo_consumer_key', label: 'Consumer key', placeholder: 'ck_...', secret: true },
      { key: 'woo_consumer_secret', label: 'Consumer secret', placeholder: 'cs_...', secret: true },
      { key: 'woo_webhook_secret', label: 'Webhook gizli anahtarı', placeholder: 'whsec_...', secret: true, wide: true },
    ],
  },
  {
    key: 'wordpress',
    label: 'WordPress',
    description: 'İçerik ve medya yönetimi bağlantısı.',
    fields: [
      { key: 'wp_site_url', label: 'Site URL', placeholder: 'https://seroguld.dk', wide: true },
      { key: 'wp_username', label: 'Kullanıcı adı', placeholder: 'admin' },
      { key: 'wp_app_password', label: 'Uygulama parolası', placeholder: 'xxxx xxxx xxxx xxxx', secret: true },
    ],
  },
  {
    key: 'uniconta',
    label: 'Uniconta',
    description: 'Fatura, muhasebe ve ERP bağlantısı.',
    fields: [
      { key: 'uniconta_api_url', label: 'API URL', placeholder: 'https://api.uniconta.com', wide: true },
      { key: 'uniconta_username', label: 'Kullanıcı adı', placeholder: 'user@firma.dk' },
      { key: 'uniconta_company_id', label: 'Şirket kimliği', placeholder: '12345' },
      { key: 'uniconta_password', label: 'Şifre', placeholder: '••••••••', secret: true },
      { key: 'uniconta_api_key', label: 'API anahtarı', placeholder: 'uc_...', secret: true },
      { key: 'uniconta_purchase_vat_code_25', label: '%25 alış KDV kodu', placeholder: 'Købsmoms' },
      { key: 'uniconta_purchase_vat_code_0', label: '%0 alış KDV kodu', placeholder: 'KøbBrugtmoms' },
    ],
  },
];

function SecretInput({ value, placeholder, className, onChange }: { value: string; placeholder?: string; className: string; onChange: (value: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input type={visible ? 'text' : 'password'} value={value} placeholder={placeholder} autoComplete="new-password" onChange={(event) => onChange(event.target.value)} className={`${className} pr-11`} />
      <button type="button" onClick={() => setVisible((current) => !current)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 transition hover:text-slate-700" aria-label={visible ? 'Gizli değeri sakla' : 'Gizli değeri göster'}>
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function LocalStorageManager({ classic }: { classic: boolean }) {
  const [items, setItems] = useState<Array<{ key: string; size: number }>>([]);

  const refresh = () => {
    const next: Array<{ key: string; size: number }> = [];
    try {
      const storage = window.localStorage;
      if (!storage) {
        setItems([]);
        return;
      }
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key) continue;
        next.push({ key, size: new Blob([key, storage.getItem(key) || '']).size });
      }
    } catch {
      setItems([]);
      return;
    }
    setItems(next.sort((left, right) => right.size - left.size));
  };

  useEffect(() => refresh(), []);
  const total = items.reduce((sum, item) => sum + item.size, 0);
  const formatSize = (size: number) => (size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div>
          <p className="text-sm font-semibold">Bu cihazdaki arayüz verileri</p>
          <p className="mt-1 text-sm text-slate-500">{items.length} kayıt · {formatSize(total)}</p>
        </div>
        <button type="button" onClick={refresh} className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold ${classic ? 'border border-brand-300 text-brand-800 hover:bg-brand-50' : 'rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
          <RefreshCw className="h-4 w-4" /> Yenile
        </button>
      </div>
      <div className="divide-y divide-slate-200 border-y border-slate-200">
        {items.length === 0 ? <p className="py-5 text-sm text-slate-500">Yerel arayüz kaydı bulunmuyor.</p> : null}
        {items.map((item) => (
          <div key={item.key} className="flex min-w-0 items-center gap-3 py-3">
            <Database className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700">{item.key}</span>
            <span className="shrink-0 text-xs text-slate-500">{formatSize(item.size)}</span>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`“${item.key}” yerel kaydı silinsin mi?`)) return;
                try {
                  window.localStorage?.removeItem(item.key);
                } catch {
                  return;
                }
                refresh();
              }}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-slate-400 transition hover:text-red-600"
              aria-label={`${item.key} kaydını sil`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsWorkspace({
  variant,
  config,
  saved,
  isSaving,
  confirmReset,
  apiStatus,
  configuredCount,
  onUpdate,
  onSave,
  onReset,
  onExport,
  onImport,
  uiVariantSlot,
  languageSlot,
  monitorSlot,
}: SettingsWorkspaceProps) {
  const [category, setCategory] = useState<CategoryKey>('general');
  const [integration, setIntegration] = useState<IntegrationKey>('openai');
  const classic = variant === 'classic';
  const activeCopy = CATEGORY_COPY[category];
  const selectedIntegration = INTEGRATIONS.find((item) => item.key === integration) || INTEGRATIONS[0];
  const [forgetPasswordStatus, setForgetPasswordStatus] = useState<'idle' | 'saved' | 'failed'>('idle');
  const integrationStatus = useMemo(() => new Map(apiStatus.map((item) => [item.name.toLowerCase(), item.ok])), [apiStatus]);

  const pageClass = classic ? 'bg-brand-50/60 text-brand-950' : 'bg-[#f3f6fb] text-slate-950';
  const surfaceClass = classic ? 'border-brand-200 bg-white' : 'rounded-2xl border-slate-200 bg-white shadow-[0_16px_45px_rgba(15,23,42,0.06)]';
  const inputClass = classic
    ? 'w-full border border-brand-300 bg-white px-3.5 py-2.5 text-sm text-brand-950 outline-none transition focus:border-brand-700 focus:ring-2 focus:ring-brand-100'
    : 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50';

  const renderField = (field: FieldDefinition) => (
    <label key={String(field.key)} className={field.wide ? 'sm:col-span-2' : undefined}>
      <span className={`mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] ${classic ? 'text-brand-600' : 'text-slate-500'}`}>{field.label}</span>
      {field.secret ? (
        <SecretInput
          value={String(config[field.key] ?? '')}
          placeholder={config.secret_fields_configured?.includes(String(field.key)) ? 'Yapılandırıldı · değiştirmek için yeni değer girin' : field.placeholder}
          className={inputClass}
          onChange={(value) => onUpdate(field.key, value)}
        />
      ) : (
        <input value={String(config[field.key] ?? '')} placeholder={field.placeholder} onChange={(event) => onUpdate(field.key, event.target.value)} className={inputClass} />
      )}
    </label>
  );

  const navigation = (
    <nav className="space-y-1" aria-label="Ayar kategorileri">
      {CATEGORIES.map((item) => {
        const Icon = item.icon;
        const active = item.key === category;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => setCategory(item.key)}
            className={`group flex w-full items-center gap-3 px-3 py-3 text-left transition ${
              active
                ? classic
                  ? 'bg-brand-100 text-brand-950'
                  : 'rounded-xl bg-blue-50 text-blue-950'
                : classic
                  ? 'text-brand-600 hover:bg-brand-50 hover:text-brand-950'
                  : 'rounded-xl text-slate-600 hover:bg-slate-50 hover:text-slate-950'
            }`}
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center ${active ? (classic ? 'bg-brand-700 text-white' : 'rounded-lg bg-blue-600 text-white') : classic ? 'border border-brand-200 bg-white text-brand-600' : 'rounded-lg border border-slate-200 bg-white text-slate-500'}`}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{item.label}</span>
              <span className={`mt-0.5 block truncate text-xs ${active ? (classic ? 'text-brand-600' : 'text-blue-700') : 'text-slate-400'}`}>{item.description}</span>
            </span>
            <ChevronRight className={`h-4 w-4 shrink-0 transition ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`} />
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className={`min-h-full ${pageClass}`}>
      <div className="mx-auto max-w-[1480px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={`text-[11px] font-semibold uppercase tracking-[0.22em] ${classic ? 'text-brand-600' : 'text-blue-600'}`}>Sistem yapılandırması</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-0.025em]">Ayarlar</h1>
            <p className="mt-1 text-sm text-slate-500">İşletme, ekran ve bağlantı tercihlerini tek çalışma alanında yönetin.</p>
          </div>
          <div className={`inline-flex w-fit items-center gap-2 px-3 py-2 text-sm ${classic ? 'border border-brand-200 bg-white' : 'rounded-xl border border-slate-200 bg-white shadow-sm'}`}>
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="font-semibold">{configuredCount}/{apiStatus.length}</span>
            <span className="text-slate-500">bağlantı hazır</span>
          </div>
        </header>

        <div className="mb-4 lg:hidden">
          <select value={category} onChange={(event) => setCategory(event.target.value as CategoryKey)} className={inputClass} aria-label="Ayar kategorisi seç">
            {CATEGORIES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className={`sticky top-4 hidden border p-2 lg:block ${surfaceClass}`}>{navigation}</aside>

          <main className={`min-w-0 border ${surfaceClass}`}>
            <div className={`border-b px-5 py-5 sm:px-7 ${classic ? 'border-brand-200' : 'border-slate-200'}`}>
              <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${classic ? 'text-brand-600' : 'text-blue-600'}`}>{activeCopy.eyebrow}</p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em]">{activeCopy.title}</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{activeCopy.description}</p>
            </div>

            <div className="px-5 py-6 sm:px-7">
              {category === 'general' ? (
                <section className="max-w-4xl">
                  <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">{COMPANY_FIELDS.map(renderField)}</div>
                  <div className={`mt-7 flex items-start gap-3 border-t pt-5 text-sm text-slate-500 ${classic ? 'border-brand-200' : 'border-slate-200'}`}>
                    <Globe2 className="mt-0.5 h-4 w-4 shrink-0" />
                    Bu bilgiler AFG belgelerinde, yazdırma çıktılarında ve entegrasyon kayıtlarında kullanılır.
                  </div>
                </section>
              ) : null}

              {category === 'appearance' ? (
                <div className="space-y-8">
                  <section>{uiVariantSlot}</section>
                  <section className={`border-t pt-7 [&>section]:!border-0 [&>section]:!bg-transparent [&>section]:!p-0 [&>section]:!shadow-none ${classic ? 'border-brand-200' : 'border-slate-200'}`}>{languageSlot}</section>
                  <section className={`border-t pt-7 [&>*]:!border-0 [&>*]:!bg-transparent [&>*]:!p-0 [&>*]:!shadow-none ${classic ? 'border-brand-200' : 'border-slate-200'}`}>{monitorSlot}</section>
                </div>
              ) : null}

              {category === 'market' ? (
                <div className="max-w-5xl space-y-7">
                  <label className={`flex cursor-pointer items-start gap-4 p-4 ${classic ? 'border border-brand-200 bg-brand-50' : 'rounded-xl border border-slate-200 bg-slate-50'}`}>
                    <input type="checkbox" checked={Boolean(config.market_rates_live_enabled)} onChange={(event) => onUpdate('market_rates_live_enabled', event.target.checked)} className="mt-1 h-4 w-4 accent-blue-600" />
                    <span>
                      <span className="block text-sm font-semibold">Canlı piyasa fiyatlarını otomatik kullan</span>
                      <span className="mt-1 block text-sm leading-6 text-slate-500">Kapalıyken üst çubuktaki oran editöründe kaydedilen global profil kullanılır.</span>
                    </span>
                  </label>
                  <section>
                    <h3 className="text-sm font-semibold">Mevcut oran özeti</h3>
                    <div className={`mt-3 divide-y ${classic ? 'divide-brand-200 border-y border-brand-200' : 'divide-slate-200 border-y border-slate-200'}`}>
                      {[
                        ['Altın · 24K', config.market_gold],
                        ['Gümüş · 999', config.market_silver],
                        ['Platin', config.market_platin],
                        ['Paladyum', config.market_palladyum],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="flex items-center justify-between gap-4 py-3.5">
                          <span className="text-sm text-slate-600">{label}</span>
                          <span className="font-mono text-sm font-semibold">{String(value)} DKK/g</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-4 text-sm leading-6 text-slate-500">Karat ve gümüş saflıklarının ayrıntılı değerlerini üst çubuktaki <strong className="font-semibold text-slate-700">Au / Ag</strong> düğmesinden düzenleyin.</p>
                  </section>
                </div>
              ) : null}

              {category === 'integrations' ? (
                <div>
                  <div className="flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Entegrasyon seçimi">
                    {INTEGRATIONS.map((item) => {
                      const active = item.key === integration;
                      const status = integrationStatus.get(item.label.toLowerCase());
                      return (
                        <button key={item.key} type="button" role="tab" aria-selected={active} onClick={() => setIntegration(item.key)} className={`inline-flex shrink-0 items-center gap-2 px-3.5 py-2.5 text-sm font-semibold transition ${active ? (classic ? 'bg-brand-800 text-white' : 'rounded-lg bg-blue-600 text-white') : (classic ? 'border border-brand-200 bg-white text-brand-700 hover:bg-brand-50' : 'rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}`}>
                          <span className={`h-2 w-2 rounded-full ${status ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                  <section className={`mt-5 border-t pt-6 ${classic ? 'border-brand-200' : 'border-slate-200'}`}>
                    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold">{selectedIntegration.label}</h3>
                        <p className="mt-1 text-sm text-slate-500">{selectedIntegration.description}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold ${integrationStatus.get(selectedIntegration.label.toLowerCase()) ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'} ${classic ? 'border border-current/20' : 'rounded-full'}`}>
                        {integrationStatus.get(selectedIntegration.label.toLowerCase()) ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                        {integrationStatus.get(selectedIntegration.label.toLowerCase()) ? 'Yapılandırıldı' : 'Eksik'}
                      </span>
                    </div>
                    <div className="grid max-w-4xl gap-x-5 gap-y-5 sm:grid-cols-2">{selectedIntegration.fields.map(renderField)}</div>
                  </section>
                </div>
              ) : null}

              {category === 'data' ? (
                <div className="max-w-5xl space-y-8">
                  <section className="max-w-3xl"><PasswordChangeForm variant={variant} /></section>
                  <BackupSettingsPanel variant={variant} />
                  <section>
                    <h3 className="text-sm font-semibold">Ayar yedeği</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-500">Bu cihazın yapılandırmasını dosya olarak dışa aktarabilir veya daha önce alınmış bir ayar dosyasını geri yükleyebilirsiniz.</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={onImport} className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-semibold ${classic ? 'border border-brand-300 text-brand-800 hover:bg-brand-50' : 'rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50'}`}><Upload className="h-4 w-4" /> İçe aktar</button>
                      <button type="button" onClick={onExport} className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-semibold ${classic ? 'border border-brand-300 text-brand-800 hover:bg-brand-50' : 'rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50'}`}><Download className="h-4 w-4" /> Dışa aktar</button>
                    </div>
                  </section>
                  <section className={`border-t pt-7 ${classic ? 'border-brand-200' : 'border-slate-200'}`}>
                    <LocalStorageManager classic={classic} />
                  </section>
                  <section className={`flex items-start gap-3 border-t pt-6 ${classic ? 'border-brand-200' : 'border-slate-200'}`}>
                    <Shield className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    <div>
                      <p className="text-sm font-semibold">Gizli değerler korunur</p>
                      <p className="mt-1 text-sm leading-6 text-slate-500">API anahtarları backend üzerinden saklanır. Boş bırakılan gizli alanlar mevcut kayıtlı değeri silmez.</p>
                    </div>
                  </section>
                  <section className={`border-t pt-7 ${classic ? 'border-brand-200' : 'border-slate-200'}`}>
                    <h3 className="text-sm font-semibold">{t('auth.security.title', getLocale())}</h3>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{t('auth.security.description', getLocale())}</p>
                    <button
                      type="button"
                      onClick={() => {
                        const email = getCurrentUser()?.email || '';
                        void deleteStoredLoginPassword(email).then((removed) => setForgetPasswordStatus(removed ? 'saved' : 'failed'));
                      }}
                      className={`mt-4 inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-semibold ${classic ? 'border border-brand-300 text-brand-800 hover:bg-brand-50' : 'rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                    >
                      <Shield className="h-4 w-4" /> {t('auth.forgetPassword', getLocale())}
                    </button>
                    {forgetPasswordStatus === 'saved' ? <p role="status" className="mt-2 text-sm text-emerald-700">{t('auth.forgetPassword.saved', getLocale())}</p> : null}
                    {forgetPasswordStatus === 'failed' ? <p role="alert" className="mt-2 text-sm text-rose-700">{t('auth.forgetPassword.failed', getLocale())}</p> : null}
                  </section>
                </div>
              ) : null}
            </div>
          </main>
        </div>

        <div className={`sticky bottom-3 z-20 mt-5 flex flex-col gap-3 border px-4 py-3 shadow-[0_14px_40px_rgba(15,23,42,0.12)] sm:flex-row sm:items-center sm:justify-between ${classic ? 'border-brand-300 bg-white' : 'rounded-2xl border-slate-200 bg-white/95 backdrop-blur'}`}>
          <div className="flex items-center gap-2 text-sm">
            {isSaving ? <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> : saved ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <span className="h-2 w-2 rounded-full bg-slate-300" />}
            <span className={saved ? 'font-semibold text-emerald-700' : 'text-slate-500'}>{isSaving ? 'Değişiklikler kaydediliyor' : saved ? 'Değişiklikler kaydedildi' : 'Ayarlar kaydedilmeye hazır'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onReset} disabled={isSaving} className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${confirmReset ? 'border border-red-300 bg-red-50 text-red-700' : classic ? 'border border-brand-300 text-brand-700 hover:bg-brand-50' : 'rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              <RotateCcw className="h-4 w-4" /> {confirmReset ? 'Sıfırlamayı onayla' : 'Sıfırla'}
            </button>
            <button type="button" onClick={onSave} disabled={isSaving} className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-70 ${classic ? 'bg-brand-800 hover:bg-brand-900' : 'rounded-lg bg-blue-600 hover:bg-blue-700'}`}>
              <Save className="h-4 w-4" /> {isSaving ? 'Kaydediliyor' : 'Değişiklikleri kaydet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
