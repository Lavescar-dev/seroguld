import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Cloud,
  Copy,
  DatabaseBackup,
  FolderOpen,
  HelpCircle,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

import {
  getBackupConfiguration,
  getBackupStatus,
  runDesktopBackup,
  stageSelectedEncryptedBackup,
  verifySelectedEncryptedBackup,
  type BackupStatus,
} from '@/lib/backup';
import {
  chooseBackupDestination,
  exportBackupRecoveryKey,
  importBackupRecoveryKey,
  isTauriRuntime,
  openBackupDestination,
  setBackupSchedule,
  type BackupNativeConfig,
  type BackupScheduleFrequency,
} from '@/lib/desktop';

type BackupSettingsPanelProps = { variant: 'classic' | 'modern' };

const WEEKDAY_LABELS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

function formatDate(value: string | null | undefined) {
  if (!value) return 'Henüz yok';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'Henüz yok'
    : new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function formatHour(hour: number | null): string {
  return hour === null ? 'gün içinde' : `${String(hour).padStart(2, '0')}:00`;
}

// config null'ı iki anlama gelir: hâlâ yükleniyor ya da okunamadı (tarayıcı /
// IPC hatası). 'Yükleniyor…' yalnız ilk durumda gösterilir; ikincisi ebedi
// yükleme taklidi yapmaz.
function scheduleSummary(config: BackupNativeConfig | null, loading: boolean, desktopRuntime: boolean): string {
  if (loading) return 'Yükleniyor…';
  if (!config)
    return desktopRuntime
      ? 'Zamanlama okunamadı — Yenile ile tekrar deneyin.'
      : 'Zamanlama masaüstü uygulamasında yapılandırılır.';
  if (config.scheduleFrequency === 'off') return 'Otomatik yedek kapalı (elle alınabilir)';
  if (config.scheduleFrequency === 'weekly') {
    const day = config.scheduleWeekday === null ? 'haftada bir' : `her ${WEEKDAY_LABELS[config.scheduleWeekday]}`;
    return `${day} ${formatHour(config.scheduleHour)} — açılışta da telafi edilir`;
  }
  return `Her gün ${formatHour(config.scheduleHour)} — açılışta da telafi edilir`;
}

export function BackupSettingsPanel({ variant }: BackupSettingsPanelProps) {
  const [config, setConfig] = useState<BackupNativeConfig | null>(null);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [importKey, setImportKey] = useState('');
  const [scheduleDraft, setScheduleDraft] = useState<{
    frequency: BackupScheduleFrequency;
    hour: number | null;
    weekday: number;
  }>({ frequency: 'daily', hour: 19, weekday: 1 });
  // Taslağı kullanıcı düzenlediyse refresh (backup-completed event'i dahil)
  // config'den EZMEZ — aksi halde Kaydet'e basmadan yapılan düzenleme sessizce
  // geri alınır.
  const scheduleDirtyRef = useRef(false);
  const classic = variant === 'classic';
  const desktopRuntime = isTauriRuntime();
  const scheduleLocked = configLoading || !config;
  const button = `inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${classic ? 'border border-brand-300 bg-white text-brand-800 hover:bg-brand-50' : 'rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`;

  const refresh = useCallback(async () => {
    const [nextConfig, nextStatus] = await Promise.all([getBackupConfiguration(), getBackupStatus().catch(() => null)]);
    setConfig(nextConfig);
    setStatus(nextStatus);
    if (nextConfig && !scheduleDirtyRef.current) {
      setScheduleDraft({
        frequency: nextConfig.scheduleFrequency,
        hour: nextConfig.scheduleHour,
        weekday: nextConfig.scheduleWeekday ?? 1,
      });
    }
    setConfigLoading(false);
    setStatusLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const onComplete = () => void refresh();
    window.addEventListener('seroguld:backup-completed', onComplete);
    return () => window.removeEventListener('seroguld:backup-completed', onComplete);
  }, [refresh]);

  const run = async (name: string, operation: () => Promise<void>) => {
    setBusy(name);
    setMessage(null);
    try {
      await operation();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'İşlem tamamlanamadı.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={`border-t pt-7 ${classic ? 'border-brand-200' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <DatabaseBackup className={`mt-0.5 h-5 w-5 ${classic ? 'text-brand-700' : 'text-blue-600'}`} />
          <div>
            <h3 className="text-sm font-semibold">Otomatik şifreli yedekleme</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              Tutarlı SQLite, belge ve fotoğraf yedeği aşağıdaki zamanlamaya göre arka planda alınır ve AES-256 ile
              şifrelenir. Açılış ve çıkış yedekleme için bekletilmez.
            </p>
          </div>
        </div>
        {(() => {
          // status null iki nedenden gelir: henüz yükleniyor ya da okunamadı
          // (backend kapalı/403/ağ). Belirsizlikte yeşil 'Yedek güncel' YALAN
          // olur — nötr gösterilir.
          if (statusLoading) {
            return (
              <span
                className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-600 ${classic ? 'border border-current/20' : 'rounded-full'}`}
              >
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Durum yükleniyor…
              </span>
            );
          }
          if (!status) {
            return (
              <span
                className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-600 ${classic ? 'border border-current/20' : 'rounded-full'}`}
              >
                <HelpCircle className="h-3.5 w-3.5" /> Durum bilinmiyor
              </span>
            );
          }
          return (
            <span
              className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold ${status.backup_due ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'} ${classic ? 'border border-current/20' : 'rounded-full'}`}
            >
              {status.backup_due ? <RefreshCw className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {status.backup_due ? 'Bugünkü yedek bekliyor' : 'Yedek güncel'}
            </span>
          );
        })()}
      </div>

      {!statusLoading && !status ? (
        <p role="note" className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-600">
          Yedek durumu okunamadı; backend'e ulaşılıyor olmayabilir.
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-brand-800 underline underline-offset-2 hover:text-brand-950"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Yenile
          </button>
        </p>
      ) : null}

      <div
        className={`mt-5 grid gap-4 p-4 md:grid-cols-3 ${classic ? 'border border-brand-200 bg-brand-50/50' : 'rounded-xl border border-slate-200 bg-slate-50'}`}
      >
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Son yerel yedek</p>
          <p className="mt-2 text-sm font-semibold text-slate-800">{formatDate(status?.latest_local_backup_at)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Şifreli kopya</p>
          <p className="mt-2 text-sm font-semibold text-slate-800">{status?.local_backup_count || 0} dosya</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">OneDrive / dış klasör</p>
          <p className="mt-2 truncate text-sm font-semibold text-slate-800" title={config?.destinationDir || ''}>
            {config?.destinationConfigured
              ? config.destinationAvailable
                ? config.destinationDir
                : 'Klasör şu an erişilemiyor'
              : 'Henüz seçilmedi'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Son restore testi: {formatDate(status?.latest_restore_drill_at)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          className={button}
          onClick={() =>
            void run('backup', async () => {
              const result = await runDesktopBackup('manual');
              setMessage({
                kind: result.published.offsiteStatus === 'synced' ? 'success' : 'info',
                text:
                  result.published.offsiteStatus === 'synced'
                    ? 'Yedek doğrulandı ve seçili klasöre kopyalandı.'
                    : 'Yedek doğrulandı ve yerel olarak kaydedildi. Dış klasör kopyası bekliyor.',
              });
              await refresh();
            })
          }
        >
          {busy === 'backup' ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <DatabaseBackup className="h-4 w-4" />
          )}{' '}
          Şimdi yedekle
        </button>
        <button
          type="button"
          disabled={busy !== null}
          className={button}
          onClick={() =>
            void run('folder', async () => {
              setConfig(await chooseBackupDestination());
              setMessage({ kind: 'success', text: 'Şifreli yedek klasörü seçildi.' });
            })
          }
        >
          {busy === 'folder' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}{' '}
          OneDrive klasörü seç
        </button>
        <button
          type="button"
          disabled={busy !== null}
          className={button}
          onClick={() =>
            void run('open-folder', async () => {
              await openBackupDestination();
            })
          }
        >
          {busy === 'open-folder' ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <FolderOpen className="h-4 w-4" />
          )}{' '}
          Yedek klasörünü aç
        </button>
        <button
          type="button"
          disabled={busy !== null}
          className={button}
          onClick={() =>
            void run('verify', async () => {
              await verifySelectedEncryptedBackup();
              setMessage({ kind: 'success', text: 'Seçilen şifreli yedek ve içindeki SQLite veritabanı doğrulandı.' });
            })
          }
        >
          {busy === 'verify' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{' '}
          Yedeği doğrula
        </button>
        <button
          type="button"
          disabled={busy !== null}
          className={button}
          onClick={() =>
            void run('restore', async () => {
              // Backend bilinçli olarak doğrulanmış staging'de durur; canlı geri
              // yükleme ayrı bir operasyon adımıdır. Uygulamayı kapatmak tek başına
              // bir şey yapmaz — mesaj bu gerçeği yansıtmalı.
              const result = await stageSelectedEncryptedBackup();
              setMessage({
                kind: 'info',
                text: `Yedek doğrulandı ve hazırlık kopyası oluşturuldu (${result.restore_path}). Canlı geri yükleme ayrı bir operasyon adımı gerektirir; uygulamayı kapatmak tek başına yeterli değildir.`,
              });
            })
          }
        >
          {busy === 'restore' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{' '}
          Geri yüklemeye hazırla
        </button>
      </div>

      <div className={`mt-5 p-4 ${classic ? 'border border-brand-200' : 'rounded-xl border border-slate-200'}`}>
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 h-4 w-4 text-blue-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Zamanlama</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Otomatik yedek uygulama açıkken çalışır. Kaçırılan yedek bir sonraki açılışta (o gün alınmadıysa) telafi
              edilir.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-xs font-semibold text-slate-500">
                Sıklık
                <select
                  disabled={scheduleLocked}
                  value={scheduleDraft.frequency}
                  onChange={(event) => {
                    scheduleDirtyRef.current = true;
                    setScheduleDraft((current) => ({
                      ...current,
                      frequency: event.target.value as BackupScheduleFrequency,
                    }));
                  }}
                  className={`mt-1 block px-3 py-2 text-sm ${classic ? 'border border-brand-300' : 'rounded-lg border border-slate-200'}`}
                >
                  <option value="off">Kapalı</option>
                  <option value="daily">Günlük</option>
                  <option value="weekly">Haftalık</option>
                </select>
              </label>
              {scheduleDraft.frequency !== 'off' ? (
                <label className="text-xs font-semibold text-slate-500">
                  Tercih edilen saat
                  <select
                    disabled={scheduleLocked}
                    value={scheduleDraft.hour ?? ''}
                    onChange={(event) => {
                      scheduleDirtyRef.current = true;
                      setScheduleDraft((current) => ({
                        ...current,
                        hour: event.target.value === '' ? null : Number(event.target.value),
                      }));
                    }}
                    className={`mt-1 block px-3 py-2 text-sm ${classic ? 'border border-brand-300' : 'rounded-lg border border-slate-200'}`}
                  >
                    <option value="">Gün içinde (ilk fırsatta)</option>
                    {Array.from({ length: 24 }, (_, index) => (
                      <option key={index} value={index}>
                        {String(index).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {scheduleDraft.frequency === 'weekly' ? (
                <label className="text-xs font-semibold text-slate-500">
                  Gün
                  <select
                    disabled={scheduleLocked}
                    value={scheduleDraft.weekday}
                    onChange={(event) => {
                      scheduleDirtyRef.current = true;
                      setScheduleDraft((current) => ({ ...current, weekday: Number(event.target.value) }));
                    }}
                    className={`mt-1 block px-3 py-2 text-sm ${classic ? 'border border-brand-300' : 'rounded-lg border border-slate-200'}`}
                  >
                    {WEEKDAY_LABELS.map((label, index) => (
                      <option key={index} value={index}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button
                type="button"
                disabled={scheduleLocked || busy !== null}
                className={button}
                onClick={() =>
                  void run('schedule', async () => {
                    setConfig(
                      await setBackupSchedule(
                        scheduleDraft.frequency,
                        scheduleDraft.frequency === 'off' ? null : scheduleDraft.hour,
                        scheduleDraft.frequency === 'weekly' ? scheduleDraft.weekday : null,
                      ),
                    );
                    scheduleDirtyRef.current = false;
                    setMessage({ kind: 'success', text: 'Yedekleme zamanlaması kaydedildi.' });
                  })
                }
              >
                {busy === 'schedule' ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <CalendarClock className="h-4 w-4" />
                )}{' '}
                Kaydet
              </button>
            </div>
            {scheduleLocked && !configLoading ? (
              <p role="note" className="mt-2 text-xs font-semibold text-amber-700">
                Gerçek zamanlama okunamadı; varsayılanla kaydetme kilitli.
              </p>
            ) : null}
            <p className="mt-2 text-xs text-slate-500">
              Şu an: {scheduleSummary(config, configLoading, desktopRuntime)}
            </p>
          </div>
        </div>
      </div>

      <div className={`mt-5 p-4 ${classic ? 'border border-brand-200' : 'rounded-xl border border-slate-200'}`}>
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-4 w-4 text-amber-600" />
          <div>
            <p className="text-sm font-semibold">Kurtarma anahtarı</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Bu anahtar olmadan başka bir bilgisayarda OneDrive yedeği açılamaz. Anahtarı aynı OneDrive klasöründe
              değil, parola yöneticisi veya ayrı USB’de saklayın.
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            className={button}
            onClick={() =>
              void run('export-key', async () => {
                const key = await exportBackupRecoveryKey();
                setRecoveryKey(key);
                setMessage({
                  kind: 'info',
                  text: 'Anahtar yalnız bu ekranda gösteriliyor; güvenli bir yere kopyalayın.',
                });
                await refresh();
              })
            }
          >
            <KeyRound className="h-4 w-4" /> Kurtarma anahtarını göster
          </button>
          {recoveryKey ? (
            <button
              type="button"
              disabled={busy !== null}
              className={button}
              onClick={() =>
                void run('copy-key', async () => {
                  // Felaket kurtarmanın tek kritik değeri: kopyalama reddi sessiz
                  // kalamaz — onay ve hata mesajı zorunlu.
                  await navigator.clipboard.writeText(recoveryKey);
                  setMessage({ kind: 'success', text: 'Kurtarma anahtarı kopyalandı.' });
                })
              }
            >
              {busy === 'copy-key' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              {busy === 'copy-key' ? 'Kopyalanıyor…' : 'Kopyala'}
            </button>
          ) : null}
        </div>
        {recoveryKey ? (
          <textarea
            aria-label="Kurtarma anahtarı"
            readOnly
            value={recoveryKey}
            className={`mt-3 min-h-20 w-full resize-none px-3 py-2 font-mono text-xs ${classic ? 'border border-brand-300' : 'rounded-lg border border-slate-200 bg-slate-50'}`}
          />
        ) : null}
        <div className="mt-3 flex gap-2">
          <input
            aria-label="Kurtarma anahtarını içe aktar"
            type="password"
            value={importKey}
            onChange={(event) => setImportKey(event.target.value)}
            placeholder="Başka cihazdaki kurtarma anahtarı"
            className={`min-w-0 flex-1 px-3 py-2 text-sm ${classic ? 'border border-brand-300' : 'rounded-lg border border-slate-200'}`}
          />
          <button
            type="button"
            disabled={!importKey || busy !== null}
            className={button}
            onClick={() =>
              void run('import-key', async () => {
                await importBackupRecoveryKey(importKey);
                setImportKey('');
                setMessage({ kind: 'success', text: 'Kurtarma anahtarı Windows Credential Manager’a kaydedildi.' });
                await refresh();
              })
            }
          >
            Anahtarı yükle
          </button>
        </div>
      </div>
      {message ? (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`mt-4 text-sm ${message.kind === 'error' ? 'text-rose-700' : message.kind === 'success' ? 'text-emerald-700' : 'text-blue-700'}`}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
