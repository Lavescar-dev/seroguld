import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api';
import { requestCriticalBackup } from '@/lib/backup';
import { useToast } from '@/lib/toast';

import type { ApiConfig } from './types';

const DEFAULT_CONFIG: ApiConfig = {
  openai_api_key: '',
  openai_model: 'gpt-4o',
  openai_max_tokens: '4096',
  opmc_api_url: 'https://api.opmc.dk/v1',
  opmc_api_key: '',
  opmc_webhook_secret: '',
  woo_store_url: 'https://seroguld.dk',
  woo_consumer_key: '',
  woo_consumer_secret: '',
  woo_webhook_secret: '',
  wp_site_url: 'https://seroguld.dk',
  wp_username: '',
  wp_app_password: '',
  uniconta_api_url: 'https://api.uniconta.com',
  uniconta_username: '',
  uniconta_password: '',
  uniconta_company_id: '',
  uniconta_api_key: '',
  uniconta_purchase_vat_code_25: 'Købsmoms',
  uniconta_purchase_vat_code_0: 'KøbBrugtmoms',
  market_gold: '2850',
  market_silver: '8.5',
  market_platin: '280',
  market_palladyum: '335',
  market_rates_live_enabled: false,
  market_rates_live_fx_enabled: true,
  market_rates_live_platinum_enabled: true,
  market_rates_live_palladium_enabled: true,
  metals_dev_api_key: '',
  firma_adi: 'Sero Guld',
  firma_cvr: '',
  firma_telefon: '',
  firma_email: '',
  firma_adres: '',
};

export function buildSettingsApiStatus(config: ApiConfig) {
  const configuredSecrets = new Set(config.secret_fields_configured ?? []);
  const hasSecret = (field: keyof ApiConfig) => Boolean(config[field]) || configuredSecrets.has(String(field));
  return [
    { name: 'OpenAI', ok: hasSecret('openai_api_key') },
    // OPMC modülü yapım aşamasında ve anahtar hiçbir canlı çağrıda kullanılmıyor;
    // hazır sayılması için URL yeterli (anahtar opsiyonel).
    { name: 'OPMC', ok: Boolean(config.opmc_api_url?.trim()) },
    { name: 'metals.dev', ok: hasSecret('metals_dev_api_key') },
    { name: 'WooCommerce', ok: hasSecret('woo_consumer_key') && hasSecret('woo_consumer_secret') },
    { name: 'WordPress', ok: hasSecret('wp_app_password') },
    { name: 'Uniconta', ok: Boolean(config.uniconta_username) && hasSecret('uniconta_password') },
  ];
}

export function useSettingsMakeState() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['settings-v2'],
    queryFn: () => apiRequest<ApiConfig>('/api/v2/settings'),
  });
  const saveMutation = useMutation({
    mutationFn: (nextConfig: ApiConfig) =>
      apiRequest<ApiConfig>('/api/v2/settings', {
        method: 'PUT',
        body: JSON.stringify(nextConfig),
      }),
  });

  const [config, setConfig] = useState<ApiConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (settingsQuery.data) {
      setConfig(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  const update = (key: keyof ApiConfig, value: string | boolean) => {
    setConfig((current) => ({ ...current, [key]: value }) as ApiConfig);
    setSaved(false);
    setConfirmReset(false);
  };

  const markSaved = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 3000);
  };

  const handleSave = () => {
    saveMutation.mutate(config, {
      onSuccess: (nextConfig) => {
        setConfig(nextConfig);
        queryClient.setQueryData(['settings-v2'], nextConfig);
        void queryClient.invalidateQueries({ queryKey: ['market-rates', 'defaults'] });
        void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        markSaved();
        requestCriticalBackup();
      },
      onError: (error) => {
        toast.error('Ayarlar kaydedilemedi', error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.');
      },
    });
  };

  const handleReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    saveMutation.mutate({ ...DEFAULT_CONFIG }, {
      onSuccess: (nextConfig) => {
        setConfig(nextConfig);
        queryClient.setQueryData(['settings-v2'], nextConfig);
        void queryClient.invalidateQueries({ queryKey: ['market-rates', 'defaults'] });
        setConfirmReset(false);
        markSaved();
        requestCriticalBackup();
      },
      onError: (error) => {
        toast.error('Ayarlar sıfırlanamadı', error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.');
      },
    });
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `seroguld-settings-${new Date().toISOString().split('T')[0]}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event: Event) => {
      const target = event.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        try {
          const data = JSON.parse(String(loadEvent.target?.result || '{}'));
          const merged = { ...DEFAULT_CONFIG, ...(data as Partial<ApiConfig>) };
          saveMutation.mutate(merged, {
            onSuccess: (nextConfig) => {
              setConfig(nextConfig);
              markSaved();
              requestCriticalBackup();
            },
          });
        } catch {
          toast.error('Geçersiz JSON dosyası', 'İçeri aktarılan dosya çözümlenemedi.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const apiStatus = buildSettingsApiStatus(config);

  return {
    config,
    saved,
    isSaving: saveMutation.isPending,
    confirmReset,
    apiStatus,
    configuredCount: apiStatus.filter((item) => item.ok).length,
    onUpdate: update,
    onSave: handleSave,
    onReset: handleReset,
    onExport: handleExport,
    onImport: handleImport,
  };
}
