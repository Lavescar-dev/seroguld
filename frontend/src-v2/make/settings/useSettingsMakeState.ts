import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from 'react-router-dom';

import { useConfirm } from '@/components/ConfirmDialog';
import { apiRequest, localizeApiError } from '@/lib/api';
import { requestCriticalBackup } from '@/lib/backup';
import { useToast } from '@/lib/toast';

import type { ApiConfig } from './types';

export const DEFAULT_CONFIG: ApiConfig = {
  openai_api_key: '',
  openai_model: 'gpt-5.6-luna',
  openai_reasoning_effort: 'high',
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
  email_transport: 'smtp',
  wp_bridge_url: '',
  wp_bridge_secret: '',
  afg_email_enabled: false,
  uniconta_api_url: 'https://api.uniconta.com',
  uniconta_username: '',
  uniconta_password: '',
  uniconta_company_id: '',
  uniconta_api_key: '',
  uniconta_purchase_vat_code_25: 'Købsmoms',
  uniconta_purchase_vat_code_0: 'KøbBrugtmoms',
  // Backend market_rate_profile varsayılanlarıyla aynı (DEFAULT_GOLD_DKK /
  // DEFAULT_SILVER_DKK = 615.50 / 7.80); çekmece ve alış ekranları da bu
  // değerlerle başlar. 2850/8.5 eski, çelişen frontend kopyasıydı.
  market_gold: '615.50',
  market_silver: '7.80',
  market_platin: '280',
  market_palladyum: '335',
  market_rates_live_enabled: false,
  market_rates_live_fx_enabled: true,
  market_rates_live_platinum_enabled: true,
  market_rates_live_palladium_enabled: true,
  wp_priser_last_fetch: '',
  metals_dev_api_key: '',
  firma_adi: 'Sero Guld',
  firma_cvr: '',
  firma_telefon: '',
  firma_email: '',
  firma_adres: '',
};

// Sunucu konfigi ile form konfigini alan bazlı karşılaştırır (kirli takibi).
// String normalizasyonu boolean/dizi alanları da kapsar.
export function isSettingsConfigDirty(server: ApiConfig, draft: ApiConfig): boolean {
  const keys = new Set([...Object.keys(server), ...Object.keys(draft)] as (keyof ApiConfig)[]);
  for (const key of keys) {
    if (String(draft[key] ?? '') !== String(server[key] ?? '')) return true;
  }
  return false;
}

export function buildSettingsApiStatus(config: ApiConfig) {
  const configuredSecrets = new Set(config.secret_fields_configured ?? []);
  const hasSecret = (field: keyof ApiConfig) => Boolean(config[field]) || configuredSecrets.has(String(field));
  return [
    { name: 'OpenAI', ok: hasSecret('openai_api_key') },
    // OPMC modülü yapım aşamasında ve anahtar hiçbir canlı çağrıda kullanılmıyor;
    // hazır sayılması için URL yeterli (anahtar opsiyonel).
    { name: 'OPMC', ok: Boolean(config.opmc_api_url?.trim()) },
    // metals.dev artık sayılmaz: R1-20/R2-06 ile canlı kur zincirinden
    // çıkarıldı (Pt/Pd/EUR Stooq, karat fiyatları WP "Priser"). Anahtar yalnız
    // probe aracında kalır; burada saymak ekrandan kapatılamayan sahte 'Eksik'
    // üretirdi.
    { name: 'WooCommerce', ok: hasSecret('woo_consumer_key') && hasSecret('woo_consumer_secret') },
    { name: 'WordPress', ok: hasSecret('wp_app_password') },
    // AFG mail: wp-bridge için URL + secret, smtp için anahtar gerekmez.
    // off: bilinçli kapatma (afg_email_enabled=false) — 'Eksik' değil nötr
    // gösterilir; bozuk bağlantı iması vermemesi için üçüncü durumdur.
    {
      name: 'E-posta (AFG)',
      ok:
        Boolean(config.afg_email_enabled) &&
        (config.email_transport !== 'wp-bridge' ||
          (Boolean(config.wp_bridge_url?.trim()) && hasSecret('wp_bridge_secret'))),
      off: !config.afg_email_enabled,
    },
    { name: 'Uniconta', ok: Boolean(config.uniconta_username) && hasSecret('uniconta_password') },
  ];
}

export function useSettingsMakeState() {
  const toast = useToast();
  const confirm = useConfirm();
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

  // HIGH fix: yükleme başarısızsa default konfigle sessizce devam etmek,
  // Kaydet/Sıfırla/İçe aktar'ın ÜRETİM ayarlarını kalıcı ezmesine yol açıyordu.
  // Artık yazma yolu yalnız sunucudan gerçek konfig başarıyla okunduğunda açılır.
  const isReady = settingsQuery.isSuccess;
  const isLoading = settingsQuery.isPending;
  const isError = settingsQuery.isError;

  const [config, setConfig] = useState<ApiConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settingsQuery.data) {
      setConfig(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  const isDirty = useMemo(
    () => (settingsQuery.data ? isSettingsConfigDirty(settingsQuery.data, config) : false),
    [settingsQuery.data, config],
  );

  const update = (key: keyof ApiConfig, value: string | boolean) => {
    setConfig((current) => ({ ...current, [key]: value }) as ApiConfig);
    setSaved(false);
  };

  const markSaved = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 3000);
  };

  const handleSave = () => {
    if (!isReady) return;
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

  const handleReset = async () => {
    if (!isReady) return;
    // Sıfırlama ÜRETİM değerlerini ezer; onay useConfirm diyaloğuna taşındı.
    const confirmed = await confirm({
      title: 'Ayarlar fabrika değerlerine döndürülsün mü?',
      message:
        'Entegrasyon, piyasa oranı ve firma bilgileri varsayılanlarla değiştirilecek. Kayıtlı gizli anahtarlar korunur; bu işlem geri alınamaz.',
      confirmText: 'Sıfırla',
      cancelText: 'Vazgeç',
      variant: 'danger',
    });
    if (!confirmed) return;
    saveMutation.mutate(
      { ...DEFAULT_CONFIG },
      {
        onSuccess: (nextConfig) => {
          setConfig(nextConfig);
          queryClient.setQueryData(['settings-v2'], nextConfig);
          void queryClient.invalidateQueries({ queryKey: ['market-rates', 'defaults'] });
          markSaved();
          requestCriticalBackup();
        },
        onError: (error) => {
          toast.error('Ayarlar sıfırlanamadı', error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.');
        },
      },
    );
  };

  const handleExport = () => {
    if (!isReady) return;
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `seroguld-settings-${new Date().toISOString().split('T')[0]}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    if (!isReady) return;
    if (isDirty) {
      // İçe aktarma formdaki kaydedilmemiş değişikliklerin üzerine yazar.
      const confirmed = await confirm({
        title: 'Kaydedilmemiş değişiklikler silinecek',
        message: 'İçe aktarılan dosya formdaki mevcut değerlerin üzerine yazar. Devam edilsin mi?',
        confirmText: 'Devam et',
        cancelText: 'Vazgeç',
        variant: 'warning',
      });
      if (!confirmed) return;
    } else {
      // Temiz formda bile içe aktarma KAYITLI üretim yapılandırmasını PUT ile
      // değiştirir; ezme işlemi onaysız yapılmaz.
      const confirmed = await confirm({
        title: 'İçe aktarma kayıtlı ayarların üzerine yazacak',
        message: 'Dosyadaki değerler hem formu hem kayıtlı üretim yapılandırmasını değiştirir. Devam edilsin mi?',
        confirmText: 'Devam et',
        cancelText: 'Vazgeç',
        variant: 'warning',
      });
      if (!confirmed) return;
    }
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
              // handleSave ile aynı önbellek tazelemesi: aksi halde ['settings-v2']
              // dışındaki ekranlar bayat değerle formu geri yazardı.
              queryClient.setQueryData(['settings-v2'], nextConfig);
              void queryClient.invalidateQueries({ queryKey: ['market-rates', 'defaults'] });
              void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
              void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
              markSaved();
              requestCriticalBackup();
            },
            onError: (error) => {
              toast.error(
                'Ayarlar içe aktarılamadı',
                error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.',
              );
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

  // Kaydedilmemiş değişiklikle sayfadan ayrılma onayı (react-router blocker).
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => isReady && isDirty && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return undefined;
    const { proceed, reset } = blocker;
    let active = true;
    void confirm({
      title: 'Kaydedilmemiş değişiklikler var',
      message: 'Ayarlar sayfasından ayrılırsanız yaptığınız değişiklikler kaybolur. Ayrılsın mı?',
      confirmText: 'Değişiklikleri bırak',
      cancelText: 'Kal',
      variant: 'warning',
    }).then((result) => {
      if (!active) return;
      if (result) proceed();
      else reset();
    });
    return () => {
      active = false;
    };
  }, [blocker, confirm]);

  const apiStatus = buildSettingsApiStatus(config);

  return {
    config,
    saved,
    isSaving: saveMutation.isPending,
    apiStatus,
    configuredCount: apiStatus.filter((item) => item.ok).length,
    isLoading,
    isError,
    isReady,
    isDirty,
    loadErrorMessage: isError ? localizeApiError(settingsQuery.error) : '',
    onUpdate: update,
    onSave: handleSave,
    onReset: handleReset,
    onExport: handleExport,
    onImport: handleImport,
    onRetryLoad: () => {
      void settingsQuery.refetch();
    },
  };
}
