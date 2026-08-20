import { apiRequest } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import {
  decryptBackupForRestore,
  encryptBackupSnapshot,
  getBackupNativeConfig,
  isTauriRuntime,
  pickBackupForRestore,
  type BackupNativeConfig,
  type BackupPublishResult,
} from '@/lib/desktop';

export type BackupStatus = {
  local_backup_count: number;
  latest_local_backup_at: string | null;
  latest_local_backup_name: string | null;
  latest_local_backup_size: number | null;
  backup_due: boolean;
  latest_restore_drill_at: string | null;
  restore_drill_due: boolean;
};

export type BackupSnapshot = {
  snapshot_path: string;
  created_at: string;
  file_count: number;
  total_bytes: number;
  sha256: string;
};

export type BackupRunResult = { snapshot: BackupSnapshot; published: BackupPublishResult };

let runningBackup: Promise<BackupRunResult> | null = null;

export async function getBackupStatus(): Promise<BackupStatus> {
  return apiRequest<BackupStatus>('/api/v2/backups/status');
}

export async function getBackupConfiguration(): Promise<BackupNativeConfig | null> {
  return getBackupNativeConfig();
}

export async function runDesktopBackup(reason: 'startup' | 'manual' | 'critical' | 'routine' = 'manual'): Promise<BackupRunResult> {
  if (!isTauriRuntime()) throw new Error('Şifreli Windows yedeği yalnız masaüstü uygulamasında kullanılabilir.');
  if (runningBackup) return runningBackup;
  runningBackup = (async () => {
    const snapshot = await apiRequest<BackupSnapshot>('/api/v2/backups/snapshots', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    try {
      await apiRequest('/api/v2/backups/snapshots/verify', {
        method: 'POST',
        body: JSON.stringify({ snapshot_path: snapshot.snapshot_path }),
      });
      const published = await encryptBackupSnapshot(snapshot.snapshot_path);
      const status = await getBackupStatus().catch(() => null);
      if (status?.restore_drill_due) {
        try {
          const candidate = await decryptBackupForRestore(published.localPath);
          try {
            await apiRequest('/api/v2/backups/restore/stage', {
              method: 'POST',
              body: JSON.stringify({ snapshot_path: candidate.snapshotPath }),
            });
          } finally {
            await apiRequest('/api/v2/backups/snapshots', {
              method: 'DELETE',
              body: JSON.stringify({ snapshot_path: candidate.snapshotPath }),
            }).catch(() => undefined);
          }
        } catch (drillError) {
          // The encrypted backup itself was already decrypted byte-for-byte by
          // the native publisher. A restore-drill warning must not turn a valid
          // daily backup into a failed backup or block the user workflow.
          window.dispatchEvent(new CustomEvent('seroguld:backup-restore-drill-failed', {
            detail: { message: drillError instanceof Error ? drillError.message : String(drillError) },
          }));
        }
      }
      window.dispatchEvent(new CustomEvent('seroguld:backup-completed', { detail: { snapshot, published } }));
      return { snapshot, published };
    } catch (error) {
      await apiRequest('/api/v2/backups/snapshots', {
        method: 'DELETE',
        body: JSON.stringify({ snapshot_path: snapshot.snapshot_path }),
      }).catch(() => undefined);
      window.dispatchEvent(new CustomEvent('seroguld:backup-failed', {
        detail: { message: error instanceof Error ? error.message : String(error) },
      }));
      throw error;
    }
  })();
  try {
    return await runningBackup;
  } finally {
    runningBackup = null;
  }
}

export function requestCriticalBackup() {
  window.dispatchEvent(new CustomEvent('seroguld:backup-requested', { detail: { reason: 'critical' } }));
}

export async function verifySelectedEncryptedBackup(): Promise<{ snapshotPath: string; manifest: unknown }> {
  const encryptedPath = await pickBackupForRestore();
  const candidate = await decryptBackupForRestore(encryptedPath);
  try {
    const manifest = await apiRequest('/api/v2/backups/snapshots/verify', {
      method: 'POST',
      body: JSON.stringify({ snapshot_path: candidate.snapshotPath }),
    });
    await apiRequest('/api/v2/backups/snapshots', {
      method: 'DELETE',
      body: JSON.stringify({ snapshot_path: candidate.snapshotPath }),
    });
    return { snapshotPath: candidate.snapshotPath, manifest };
  } catch (error) {
    await apiRequest('/api/v2/backups/snapshots', {
      method: 'DELETE',
      body: JSON.stringify({ snapshot_path: candidate.snapshotPath }),
    }).catch(() => undefined);
    throw error;
  }
}

export async function stageSelectedEncryptedBackup(): Promise<{ restore_path: string; manifest: unknown }> {
  const encryptedPath = await pickBackupForRestore();
  const candidate = await decryptBackupForRestore(encryptedPath);
  try {
    return await apiRequest('/api/v2/backups/restore/stage', {
      method: 'POST',
      body: JSON.stringify({ snapshot_path: candidate.snapshotPath }),
    });
  } finally {
    await apiRequest('/api/v2/backups/snapshots', {
      method: 'DELETE',
      body: JSON.stringify({ snapshot_path: candidate.snapshotPath }),
    }).catch(() => undefined);
  }
}

export function canRunScheduledBackup() {
  return Boolean(getAccessToken() && isTauriRuntime() && document.visibilityState === 'visible');
}

export type BackupSchedule = {
  frequency: 'off' | 'daily' | 'weekly';
  hour: number | null;
  weekday: number | null;
};

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Zamanlanmış yedeğin şu an alınması gerekip gerekmediğine karar verir (saf).
 * Tetikleyici hem açılış hem periyodik nabız için aynıdır; "o gün zaten
 * alındıysa tekrar alma" mantığı son yerel yedek zamanından türetilir.
 */
export function isBackupDue(schedule: BackupSchedule, lastLocalBackupAtISO: string | null, now: Date): boolean {
  if (schedule.frequency === 'off') return false;

  const last = lastLocalBackupAtISO ? new Date(lastLocalBackupAtISO) : null;
  const lastValid = last && !Number.isNaN(last.getTime()) ? last : null;
  // Bugün zaten yedek alındıysa (günlük ve haftalık için) tekrar alınmaz.
  if (lastValid && isSameLocalDay(lastValid, now)) return false;

  const hourReached = schedule.hour === null || now.getHours() >= schedule.hour;
  if (!hourReached) return false;

  if (schedule.frequency === 'weekly') {
    // Haftada bir: yalnız seçilen gün; "bugün değilse" ile doğal tekilleşir.
    if (schedule.weekday === null) return true;
    return now.getDay() === schedule.weekday;
  }
  return true;
}
