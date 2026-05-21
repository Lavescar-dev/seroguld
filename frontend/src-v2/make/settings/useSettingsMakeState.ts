import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api';
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
  uniconta_api_url: 'https://www.uniconta.com/api',
  uniconta_username: '',
  uniconta_password: '',
  uniconta_company_id: '',
  uniconta_api_key: '',
  market_gold: '2850',
  market_silver: '8.5',
  market_platin: '280',
  market_palladyum: '335',
  firma_adi: 'Sero Guld',
  firma_cvr: '',
  firma_telefon: '',
  firma_email: '',
  firma_adres: '',
};

export function useSettingsMakeState() {
  const toast = useToast();
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

  const update = (key: keyof ApiConfig, value: string) => {
    setConfig((current) => ({ ...current, [key]: value }));
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
        markSaved();
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
        setConfirmReset(false);
        markSaved();
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

  const apiStatus = [
    { name: 'OpenAI', ok: Boolean(config.openai_api_key) },
    { name: 'OPMC', ok: Boolean(config.opmc_api_key) },
    { name: 'WooCommerce', ok: Boolean(config.woo_consumer_key && config.woo_consumer_secret) },
    { name: 'WordPress', ok: Boolean(config.wp_app_password) },
    { name: 'Uniconta', ok: Boolean(config.uniconta_api_key || (config.uniconta_username && config.uniconta_password)) },
  ];

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
