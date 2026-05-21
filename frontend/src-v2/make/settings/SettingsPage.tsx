import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Bot,
  Building2,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Database,
  Download,
  Eye,
  EyeOff,
  Globe,
  Info,
  Save,
  Settings,
  ShieldAlert,
  ShoppingCart,
  Trash2,
  Upload,
} from 'lucide-react';
import { useConfirm } from '@/components/ConfirmDialog';
import type { ApiConfig } from './types';

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;

function SettingsSection({
  title,
  icon,
  color,
  description,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: ReactNode;
  color: string;
  description: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden border-2 border-brand-300 bg-white">
      <button
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between border-b border-brand-200 bg-brand-50 px-4 py-3 transition-colors hover:bg-brand-100"
      >
        <div className="flex items-center gap-3">
          <span className={`border p-1.5 ${color}`}>{icon}</span>
          <div className="text-left">
            <p className="text-sm font-black uppercase tracking-wider text-brand-900">{title}</p>
            <p className="text-xs text-brand-500">{description}</p>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-brand-400" /> : <ChevronDown className="h-4 w-4 text-brand-400" />}
      </button>
      {open ? <div className="space-y-3 p-4">{children}</div> : null}
    </div>
  );
}

function FieldRow({
  label,
  sublabel,
  children,
}: {
  label: string;
  sublabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
      <div className="sm:w-48 sm:flex-shrink-0">
        <p className="text-xs font-black uppercase tracking-wider text-brand-700">{label}</p>
        {sublabel ? <p className="text-[10px] text-brand-400">{sublabel}</p> : null}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function SecretInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder || 'sk-...'}
        className="w-full border border-brand-300 bg-white px-3 py-2 pr-10 text-sm text-brand-900 focus:border-brand-700 focus:bg-brand-50 focus:outline-none"
        style={monoStyle}
      />
      <button
        type="button"
        onClick={() => setShow((current) => !current)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-brand-400 hover:text-brand-700"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full border border-brand-300 bg-white px-3 py-2 text-sm text-brand-900 focus:border-brand-700 focus:bg-brand-50 focus:outline-none"
      style={mono ? monoStyle : undefined}
    />
  );
}

function LocalStorageInfo({ confirm }: { confirm: ReturnType<typeof useConfirm> }) {
  const [info, setInfo] = useState<Array<{ key: string; size: number }>>([]);
  const [totalSize, setTotalSize] = useState(0);

  const refresh = () => {
    const items: Array<{ key: string; size: number }> = [];
    let total = 0;
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      const value = window.localStorage.getItem(key) || '';
      const size = new Blob([key + value]).size;
      items.push({ key, size });
      total += size;
    }
    items.sort((a, b) => b.size - a.size);
    setInfo(items);
    setTotalSize(total);
  };

  useEffect(() => {
    refresh();
  }, []);

  const fmtSize = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

  const clearKey = async (key: string) => {
    const ok = await confirm({
      title: 'LocalStorage anahtarını sil',
      message: `"${key}" verisini silmek istiyor musunuz?`,
      confirmText: 'Sil',
      variant: 'danger',
    });
    if (!ok) return;
    window.localStorage.removeItem(key);
    refresh();
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-black text-brand-700">
            Toplam: <span style={monoStyle}>{fmtSize(totalSize)}</span>
          </p>
          <p className="text-[10px] text-brand-400">{info.length} kayit</p>
        </div>
        <button onClick={refresh} className="flex items-center gap-1 border border-brand-300 px-2 py-1 text-xs text-brand-500 hover:bg-brand-50">
          Yenile
        </button>
      </div>
      <div className="max-h-64 overflow-auto border border-brand-200">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="sticky top-0 bg-brand-100">
              <th className="border border-brand-200 px-2 py-1.5 text-left font-black uppercase tracking-wider text-brand-600">Key</th>
              <th className="w-20 border border-brand-200 px-2 py-1.5 text-right font-black uppercase tracking-wider text-brand-600">Boyut</th>
              <th className="w-12 border border-brand-200 px-2 py-1.5 text-center font-black uppercase tracking-wider text-brand-600" />
            </tr>
          </thead>
          <tbody>
            {info.map((item) => (
              <tr key={item.key} className="hover:bg-brand-50">
                <td className="max-w-[200px] truncate border border-brand-200 px-2 py-1.5 text-brand-800" style={monoStyle}>
                  {item.key}
                </td>
                <td className="border border-brand-200 px-2 py-1.5 text-right text-brand-600" style={monoStyle}>
                  {fmtSize(item.size)}
                </td>
                <td className="border border-brand-200 px-2 py-1.5 text-center">
                  <button onClick={() => clearKey(item.key)} className="text-red-400 hover:text-red-600">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type MakeSettingsPageProps = {
  config: ApiConfig;
  saved: boolean;
  isSaving: boolean;
  confirmReset: boolean;
  apiStatus: Array<{ name: string; ok: boolean }>;
  configuredCount: number;
  onUpdate: (key: keyof ApiConfig, value: string) => void;
  onSave: () => void;
  onReset: () => void;
  onExport: () => void;
  onImport: () => void;
};

export function MakeSettingsPage({
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
}: MakeSettingsPageProps) {
  const confirm = useConfirm();
  const statusChip = isSaving
    ? {
        label: 'Kaydediliyor',
        className: 'border-amber-300 bg-amber-50 text-amber-700',
      }
    : saved
      ? {
          label: 'Kaydedildi',
          className: 'border-emerald-300 bg-emerald-50 text-emerald-700',
        }
      : {
          label: 'Hazir',
          className: 'border-brand-300 bg-white text-brand-600',
        };

  return (
    <div className="min-h-full bg-white" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <div className="flex flex-col gap-3 border-b-2 border-brand-300 bg-brand-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-3">
          <Settings className="h-5 w-5 text-brand-700" />
          <div>
            <h2 className="text-lg font-black uppercase tracking-wider text-brand-900">Sistem Ayarlari</h2>
            <p className="text-xs text-brand-500">API yapilandirmalari, entegrasyon anahtarlari ve firma bilgileri</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${statusChip.className}`}>
            {statusChip.label}
          </span>
          <button
            onClick={onImport}
            disabled={isSaving}
            className="flex items-center gap-1.5 border border-brand-300 px-3 py-2 text-xs font-bold text-brand-700 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Upload className="h-3.5 w-3.5" />
            Import
          </button>
          <button
            onClick={onExport}
            disabled={isSaving}
            className="flex items-center gap-1.5 border border-brand-300 px-3 py-2 text-xs font-bold text-brand-700 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
          <button
            onClick={onReset}
            disabled={isSaving}
            className={`flex items-center gap-1.5 border px-3 py-2 text-xs font-bold transition-colors ${
              confirmReset
                ? 'border-red-400 bg-red-50 text-red-700 hover:bg-red-100'
                : 'border-brand-300 text-brand-500 hover:bg-brand-100'
            } disabled:cursor-not-allowed disabled:opacity-70`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {confirmReset ? 'Emin misiniz?' : 'Sifirla'}
          </button>
          <button
            onClick={onSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 border border-brand-900 bg-brand-800 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-90"
          >
            {isSaving ? <Save className="h-3.5 w-3.5 animate-pulse" /> : saved ? <CheckCircle className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {isSaving ? 'Kaydediliyor' : saved ? 'Kaydedildi!' : 'Kaydet'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b-2 border-brand-200 bg-brand-50/50 px-4 py-3 sm:px-6">
        <span className="text-xs font-black uppercase tracking-wider text-brand-600">API Durumu:</span>
        {apiStatus.map((item) => (
          <span
            key={item.name}
            className={`inline-flex items-center gap-1 border px-2 py-0.5 text-xs font-bold ${
              item.ok
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-50 text-slate-400'
            }`}
          >
            {item.ok ? <CheckCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            {item.name}
          </span>
        ))}
        <span className="ml-auto text-xs text-brand-500" style={monoStyle}>
          {configuredCount}/{apiStatus.length} aktif
        </span>
      </div>

      <div className="mx-4 mt-4 flex items-start gap-3 border-l-4 border-amber-400 bg-amber-50 px-4 py-3 sm:mx-6">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
        <div>
          <p className="text-xs font-bold text-amber-800">Guvenlik Uyarisi</p>
          <p className="mt-0.5 text-xs text-amber-700">
            API anahtarlari artik yerel ayar endpoint&apos;i uzerinden saklaniyor. Bu ekran yalniz admin oturumu icin
            acilir; harici servis baglantilari yine de backend proxy uzerinden tutulmalidir.
          </p>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-6">
        <SettingsSection
          title="Firma Bilgileri"
          icon={<Building2 className="h-4 w-4 text-brand-700" />}
          color="border-brand-300 bg-brand-100"
          description="Isletme bilgileri, fatura ve yazdir ciktilarinda kullanilir"
          defaultOpen
        >
          <FieldRow label="Firma Adi"><TextInput value={config.firma_adi} onChange={(value) => onUpdate('firma_adi', value)} placeholder="Sero Guld" /></FieldRow>
          <FieldRow label="CVR Nr." sublabel="Vergi numarasi"><TextInput value={config.firma_cvr} onChange={(value) => onUpdate('firma_cvr', value)} placeholder="00 00 00 00" mono /></FieldRow>
          <FieldRow label="Telefon"><TextInput value={config.firma_telefon} onChange={(value) => onUpdate('firma_telefon', value)} placeholder="+45 00 00 00 00" mono /></FieldRow>
          <FieldRow label="E-mail"><TextInput value={config.firma_email} onChange={(value) => onUpdate('firma_email', value)} placeholder="info@seroguld.dk" /></FieldRow>
          <FieldRow label="Adres"><TextInput value={config.firma_adres} onChange={(value) => onUpdate('firma_adres', value)} placeholder="Gade 123, 1000 Kobenhavn" /></FieldRow>
        </SettingsSection>

        <SettingsSection
          title="Piyasa Fiyatlari"
          icon={<Database className="h-4 w-4 text-amber-700" />}
          color="border-amber-300 bg-amber-100"
          description="DKK/gram olarak gunluk spot fiyatlari — tum modullerde kullanilir"
          defaultOpen
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { key: 'market_gold' as const, label: 'Altin 24K (Au)', badge: 'Au', color: 'amber' },
              { key: 'market_silver' as const, label: 'Gumus (Ag)', badge: 'Ag', color: 'slate' },
              { key: 'market_platin' as const, label: 'Platin (Pt)', badge: 'Pt', color: 'zinc' },
              { key: 'market_palladyum' as const, label: 'Palladyum (Pd)', badge: 'Pd', color: 'zinc' },
            ].map((item) => (
              <div key={item.key} className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`border px-1.5 py-0.5 text-[10px] font-black ${
                      item.color === 'amber'
                        ? 'border-amber-300 bg-amber-100 text-amber-700'
                        : item.color === 'slate'
                          ? 'border-slate-300 bg-slate-100 text-slate-600'
                          : 'border-zinc-300 bg-zinc-100 text-zinc-600'
                    }`}
                    style={monoStyle}
                  >
                    {item.badge}
                  </span>
                  <span className="text-xs font-bold text-brand-600">{item.label}</span>
                </div>
                <input
                  type="number"
                  step="0.01"
                  value={config[item.key]}
                  onChange={(event) => onUpdate(item.key, event.target.value)}
                  className="w-full border border-brand-300 bg-white px-3 py-2 text-sm text-brand-900 focus:border-brand-700 focus:outline-none"
                  style={monoStyle}
                />
              </div>
            ))}
          </div>
        </SettingsSection>

        <SettingsSection
          title="OpenAI / ChatGPT"
          icon={<Bot className="h-4 w-4 text-emerald-700" />}
          color="border-emerald-300 bg-emerald-100"
          description="WooCommerce SEO uretimi ve AI destekli ozellikler"
        >
          <FieldRow label="API Key" sublabel="sk-proj-..."><SecretInput value={config.openai_api_key} onChange={(value) => onUpdate('openai_api_key', value)} placeholder="sk-proj-..." /></FieldRow>
          <FieldRow label="Model" sublabel="GPT model adi">
            <select
              value={config.openai_model}
              onChange={(event) => onUpdate('openai_model', event.target.value)}
              className="w-full border border-brand-300 bg-white px-3 py-2 text-sm text-brand-900 focus:border-brand-700 focus:outline-none"
            >
              <option value="gpt-4o">GPT-4o (Onerilen)</option>
              <option value="gpt-4o-mini">GPT-4o Mini</option>
              <option value="gpt-4-turbo">GPT-4 Turbo</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
            </select>
          </FieldRow>
          <FieldRow label="Max Tokens"><TextInput value={config.openai_max_tokens} onChange={(value) => onUpdate('openai_max_tokens', value)} placeholder="4096" mono /></FieldRow>
        </SettingsSection>

        <SettingsSection
          title="OPMC Izleme"
          icon={<ShieldAlert className="h-4 w-4 text-red-700" />}
          color="border-red-300 bg-red-100"
          description="Dolandiricilik risk analizi ve siparis izleme API'si"
        >
          <FieldRow label="API URL"><TextInput value={config.opmc_api_url} onChange={(value) => onUpdate('opmc_api_url', value)} placeholder="https://api.opmc.dk/v1" mono /></FieldRow>
          <FieldRow label="API Key"><SecretInput value={config.opmc_api_key} onChange={(value) => onUpdate('opmc_api_key', value)} placeholder="opmc_..." /></FieldRow>
          <FieldRow label="Webhook Secret"><SecretInput value={config.opmc_webhook_secret} onChange={(value) => onUpdate('opmc_webhook_secret', value)} placeholder="whsec_..." /></FieldRow>
        </SettingsSection>

        <SettingsSection
          title="WooCommerce"
          icon={<ShoppingCart className="h-4 w-4 text-purple-700" />}
          color="border-purple-300 bg-purple-100"
          description="Urun export, fiyat senkronizasyonu ve siparis yonetimi"
        >
          <FieldRow label="Store URL"><TextInput value={config.woo_store_url} onChange={(value) => onUpdate('woo_store_url', value)} placeholder="https://seroguld.dk" mono /></FieldRow>
          <FieldRow label="Consumer Key" sublabel="ck_..."><SecretInput value={config.woo_consumer_key} onChange={(value) => onUpdate('woo_consumer_key', value)} placeholder="ck_..." /></FieldRow>
          <FieldRow label="Consumer Secret" sublabel="cs_..."><SecretInput value={config.woo_consumer_secret} onChange={(value) => onUpdate('woo_consumer_secret', value)} placeholder="cs_..." /></FieldRow>
          <FieldRow label="Webhook Secret"><SecretInput value={config.woo_webhook_secret} onChange={(value) => onUpdate('woo_webhook_secret', value)} placeholder="whsec_..." /></FieldRow>
        </SettingsSection>

        <SettingsSection
          title="WordPress"
          icon={<Globe className="h-4 w-4 text-sky-700" />}
          color="border-sky-300 bg-sky-100"
          description="REST API ile icerik ve medya yonetimi"
        >
          <FieldRow label="Site URL"><TextInput value={config.wp_site_url} onChange={(value) => onUpdate('wp_site_url', value)} placeholder="https://seroguld.dk" mono /></FieldRow>
          <FieldRow label="Kullanici Adi"><TextInput value={config.wp_username} onChange={(value) => onUpdate('wp_username', value)} placeholder="admin" /></FieldRow>
          <FieldRow label="App Password" sublabel="WP Application Password"><SecretInput value={config.wp_app_password} onChange={(value) => onUpdate('wp_app_password', value)} placeholder="xxxx xxxx xxxx xxxx" /></FieldRow>
        </SettingsSection>

        <SettingsSection
          title="Uniconta ERP"
          icon={<Building2 className="h-4 w-4 text-sky-700" />}
          color="border-sky-300 bg-sky-100"
          description="Fatura, muhasebe ve ERP entegrasyonu"
        >
          <FieldRow label="API URL"><TextInput value={config.uniconta_api_url} onChange={(value) => onUpdate('uniconta_api_url', value)} placeholder="https://www.uniconta.com/api" mono /></FieldRow>
          <FieldRow label="API Key"><SecretInput value={config.uniconta_api_key} onChange={(value) => onUpdate('uniconta_api_key', value)} placeholder="uc_..." /></FieldRow>
          <FieldRow label="Kullanici Adi"><TextInput value={config.uniconta_username} onChange={(value) => onUpdate('uniconta_username', value)} placeholder="user@firma.dk" /></FieldRow>
          <FieldRow label="Sifre"><SecretInput value={config.uniconta_password} onChange={(value) => onUpdate('uniconta_password', value)} placeholder="********" /></FieldRow>
          <FieldRow label="Company ID" sublabel="Sirket numarasi"><TextInput value={config.uniconta_company_id} onChange={(value) => onUpdate('uniconta_company_id', value)} placeholder="12345" mono /></FieldRow>
        </SettingsSection>

        <SettingsSection
          title="Veri Yonetimi"
          icon={<Database className="h-4 w-4 text-slate-600" />}
          color="border-slate-300 bg-slate-100"
          description="localStorage veri boyutu ve temizleme islemleri"
        >
          <LocalStorageInfo confirm={confirm} />
        </SettingsSection>
      </div>
    </div>
  );
}
