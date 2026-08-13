import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Cloud, Copy, DatabaseBackup, FolderOpen, KeyRound, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';

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
  openBackupDestination,
  type BackupNativeConfig,
} from '@/lib/desktop';

type BackupSettingsPanelProps = { variant: 'classic' | 'modern' };

function formatDate(value: string | null | undefined) {
  if (!value) return 'Henüz yok';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Henüz yok' : new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

export function BackupSettingsPanel({ variant }: BackupSettingsPanelProps) {
  const [config, setConfig] = useState<BackupNativeConfig | null>(null);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [importKey, setImportKey] = useState('');
  const classic = variant === 'classic';
  const button = `inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${classic ? 'border border-brand-300 bg-white text-brand-800 hover:bg-brand-50' : 'rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`;

  const refresh = useCallback(async () => {
    const [nextConfig, nextStatus] = await Promise.all([getBackupConfiguration(), getBackupStatus().catch(() => null)]);
    setConfig(nextConfig);
    setStatus(nextStatus);
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
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">CRM açıldıktan sonra arka planda günlük tutarlı SQLite, belge ve fotoğraf yedeği alınır. Açılış ve çıkış yedekleme için bekletilmez.</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold ${status?.backup_due ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'} ${classic ? 'border border-current/20' : 'rounded-full'}`}>
          {status?.backup_due ? <RefreshCw className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {status?.backup_due ? 'Bugünkü yedek bekliyor' : 'Yedek güncel'}
        </span>
      </div>

      <div className={`mt-5 grid gap-4 p-4 md:grid-cols-3 ${classic ? 'border border-brand-200 bg-brand-50/50' : 'rounded-xl border border-slate-200 bg-slate-50'}`}>
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Son yerel yedek</p><p className="mt-2 text-sm font-semibold text-slate-800">{formatDate(status?.latest_local_backup_at)}</p></div>
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Şifreli kopya</p><p className="mt-2 text-sm font-semibold text-slate-800">{status?.local_backup_count || 0} dosya</p></div>
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">OneDrive / dış klasör</p><p className="mt-2 truncate text-sm font-semibold text-slate-800" title={config?.destinationDir || ''}>{config?.destinationConfigured ? (config.destinationAvailable ? config.destinationDir : 'Klasör şu an erişilemiyor') : 'Henüz seçilmedi'}</p><p className="mt-1 text-xs text-slate-500">Son restore testi: {formatDate(status?.latest_restore_drill_at)}</p></div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy !== null} className={button} onClick={() => void run('backup', async () => {
          const result = await runDesktopBackup('manual');
          setMessage({ kind: result.published.offsiteStatus === 'synced' ? 'success' : 'info', text: result.published.offsiteStatus === 'synced' ? 'Yedek doğrulandı ve seçili klasöre kopyalandı.' : 'Yedek doğrulandı ve yerel olarak kaydedildi. Dış klasör kopyası bekliyor.' });
          await refresh();
        })}>{busy === 'backup' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />} Şimdi yedekle</button>
        <button type="button" disabled={busy !== null} className={button} onClick={() => void run('folder', async () => { setConfig(await chooseBackupDestination()); setMessage({ kind: 'success', text: 'Şifreli yedek klasörü seçildi.' }); })}>{busy === 'folder' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />} OneDrive klasörü seç</button>
        <button type="button" disabled={busy !== null} className={button} onClick={() => void openBackupDestination()}><FolderOpen className="h-4 w-4" /> Yedek klasörünü aç</button>
        <button type="button" disabled={busy !== null} className={button} onClick={() => void run('verify', async () => { await verifySelectedEncryptedBackup(); setMessage({ kind: 'success', text: 'Seçilen şifreli yedek ve içindeki SQLite veritabanı doğrulandı.' }); })}>{busy === 'verify' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Yedeği doğrula</button>
        <button type="button" disabled={busy !== null} className={button} onClick={() => void run('restore', async () => { const result = await stageSelectedEncryptedBackup(); setMessage({ kind: 'info', text: `Yedek güvenli restore alanında doğrulandı: ${result.restore_path}. Canlı geri yükleme için uygulamayı kapatıp bu staging kopyası kullanılmalıdır.` }); })}>{busy === 'restore' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Geri yüklemeye hazırla</button>
      </div>

      <div className={`mt-5 p-4 ${classic ? 'border border-brand-200' : 'rounded-xl border border-slate-200'}`}>
        <div className="flex items-start gap-3"><KeyRound className="mt-0.5 h-4 w-4 text-amber-600" /><div><p className="text-sm font-semibold">Kurtarma anahtarı</p><p className="mt-1 text-sm leading-6 text-slate-500">Bu anahtar olmadan başka bir bilgisayarda OneDrive yedeği açılamaz. Anahtarı aynı OneDrive klasöründe değil, parola yöneticisi veya ayrı USB’de saklayın.</p></div></div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy !== null} className={button} onClick={() => void run('export-key', async () => { const key = await exportBackupRecoveryKey(); setRecoveryKey(key); setMessage({ kind: 'info', text: 'Anahtar yalnız bu ekranda gösteriliyor; güvenli bir yere kopyalayın.' }); await refresh(); })}><KeyRound className="h-4 w-4" /> Kurtarma anahtarını göster</button>
          {recoveryKey ? <button type="button" className={button} onClick={() => void navigator.clipboard.writeText(recoveryKey)}><Copy className="h-4 w-4" /> Kopyala</button> : null}
        </div>
        {recoveryKey ? <textarea aria-label="Kurtarma anahtarı" readOnly value={recoveryKey} className={`mt-3 min-h-20 w-full resize-none px-3 py-2 font-mono text-xs ${classic ? 'border border-brand-300' : 'rounded-lg border border-slate-200 bg-slate-50'}`} /> : null}
        <div className="mt-3 flex gap-2">
          <input aria-label="Kurtarma anahtarını içe aktar" type="password" value={importKey} onChange={(event) => setImportKey(event.target.value)} placeholder="Başka cihazdaki kurtarma anahtarı" className={`min-w-0 flex-1 px-3 py-2 text-sm ${classic ? 'border border-brand-300' : 'rounded-lg border border-slate-200'}`} />
          <button type="button" disabled={!importKey || busy !== null} className={button} onClick={() => void run('import-key', async () => { await importBackupRecoveryKey(importKey); setImportKey(''); setMessage({ kind: 'success', text: 'Kurtarma anahtarı Windows Credential Manager’a kaydedildi.' }); await refresh(); })}>Anahtarı yükle</button>
        </div>
      </div>
      {message ? <p role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-4 text-sm ${message.kind === 'error' ? 'text-rose-700' : message.kind === 'success' ? 'text-emerald-700' : 'text-blue-700'}`}>{message.text}</p> : null}
    </section>
  );
}
