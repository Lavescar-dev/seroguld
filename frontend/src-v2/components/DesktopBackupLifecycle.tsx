import { useEffect } from 'react';

import { canRunScheduledBackup, getBackupStatus, isBackupDue, runDesktopBackup, type BackupSchedule } from '@/lib/backup';
import { getBackupNativeConfig } from '@/lib/desktop';
import { useToast } from '@/lib/toast';

const STARTUP_DELAY_MS = 45_000;
// Tercih edilen saati ~30 dk içinde yakalamak için nabız sıklaştırıldı.
const ROUTINE_INTERVAL_MS = 30 * 60 * 1000;
const CRITICAL_DELAY_MS = 15_000;

function eventDetailMessage(event: Event): string {
  const detail = (event as CustomEvent<{ message?: unknown }>).detail;
  return typeof detail?.message === 'string' && detail.message ? detail.message : '';
}

export function DesktopBackupLifecycle() {
  const toast = useToast();

  useEffect(() => {
    // Yedek hatası kullanıcıya GÖRÜNMELİ: arka plan yedeği aylarca sessizce
    // başarısız olursa fark edilmiyordu (0.3.8 denetim bulgusu).
    const onBackupFailed = (event: Event) => {
      toast.error('Yedekleme başarısız', eventDetailMessage(event) || 'Şifreli yedek alınamadı. Ayarlar > Yedekleme bölümünden elle deneyin.');
    };
    const onDrillFailed = (event: Event) => {
      toast.warning('Yedek geri-yükleme provası başarısız', eventDetailMessage(event) || 'Günlük yedek alındı ancak geri yükleme doğrulaması tamamlanamadı.');
    };
    window.addEventListener('seroguld:backup-failed', onBackupFailed);
    window.addEventListener('seroguld:backup-restore-drill-failed', onDrillFailed);
    return () => {
      window.removeEventListener('seroguld:backup-failed', onBackupFailed);
      window.removeEventListener('seroguld:backup-restore-drill-failed', onDrillFailed);
    };
  }, [toast]);

  useEffect(() => {
    let active = true;
    let criticalTimer: number | null = null;
    const runIfDue = async (reason: 'startup' | 'routine') => {
      if (!active || !canRunScheduledBackup()) return;
      try {
        const [config, status] = await Promise.all([getBackupNativeConfig(), getBackupStatus()]);
        const schedule: BackupSchedule = {
          frequency: config?.scheduleFrequency ?? 'daily',
          hour: config?.scheduleHour ?? null,
          weekday: config?.scheduleWeekday ?? null,
        };
        if (isBackupDue(schedule, status.latest_local_backup_at, new Date())) {
          await runDesktopBackup(reason);
        }
      } catch (error) {
        // Backup health remains visible on Dashboard and Settings. Background
        // work must never delay startup, autosave, navigation or shutdown.
        // runDesktopBackup hataları backup-failed event'iyle zaten toast'a düşer;
        // status okunamaması (backend henüz ayakta değil) yalnız log'lanır.
        console.warn('Zamanlanmış yedek denemesi tamamlanamadı:', error);
      }
    };
    const startupTimer = window.setTimeout(() => void runIfDue('startup'), STARTUP_DELAY_MS);
    const routineTimer = window.setInterval(() => void runIfDue('routine'), ROUTINE_INTERVAL_MS);
    const handleCritical = () => {
      if (criticalTimer !== null) window.clearTimeout(criticalTimer);
      criticalTimer = window.setTimeout(() => {
        criticalTimer = null;
        if (active && canRunScheduledBackup()) void runDesktopBackup('critical').catch(() => undefined);
      }, CRITICAL_DELAY_MS);
    };
    window.addEventListener('seroguld:backup-requested', handleCritical);
    return () => {
      active = false;
      window.clearTimeout(startupTimer);
      window.clearInterval(routineTimer);
      if (criticalTimer !== null) window.clearTimeout(criticalTimer);
      window.removeEventListener('seroguld:backup-requested', handleCritical);
    };
  }, []);
  return null;
}
