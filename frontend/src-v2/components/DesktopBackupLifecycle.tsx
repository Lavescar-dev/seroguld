import { useEffect } from 'react';

import { canRunScheduledBackup, getBackupStatus, runDesktopBackup } from '@/lib/backup';

const STARTUP_DELAY_MS = 45_000;
const ROUTINE_INTERVAL_MS = 2 * 60 * 60 * 1000;
const CRITICAL_DELAY_MS = 15_000;

export function DesktopBackupLifecycle() {
  useEffect(() => {
    let active = true;
    let criticalTimer: number | null = null;
    const runIfDue = async (reason: 'startup' | 'routine') => {
      if (!active || !canRunScheduledBackup()) return;
      try {
        const status = await getBackupStatus();
        if (status.backup_due) await runDesktopBackup(reason);
      } catch {
        // Backup health remains visible on Dashboard and Settings. Background
        // work must never delay startup, autosave, navigation or shutdown.
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
