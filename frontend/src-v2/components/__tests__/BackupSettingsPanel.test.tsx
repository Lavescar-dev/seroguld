import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BackupSettingsPanel } from '../BackupSettingsPanel';
import { getBackupConfiguration, getBackupStatus } from '@/lib/backup';
import type { BackupStatus } from '@/lib/backup';
import type { BackupNativeConfig } from '@/lib/desktop';

vi.mock('@/lib/backup', () => ({
  getBackupConfiguration: vi.fn(),
  getBackupStatus: vi.fn(),
  runDesktopBackup: vi.fn(),
  stageSelectedEncryptedBackup: vi.fn(),
  verifySelectedEncryptedBackup: vi.fn(),
}));

vi.mock('@/lib/desktop', () => ({
  chooseBackupDestination: vi.fn(),
  exportBackupRecoveryKey: vi.fn(),
  importBackupRecoveryKey: vi.fn(),
  isTauriRuntime: vi.fn(() => true),
  openBackupDestination: vi.fn(),
  setBackupSchedule: vi.fn(),
}));

const getBackupConfigurationMock = vi.mocked(getBackupConfiguration);
const getBackupStatusMock = vi.mocked(getBackupStatus);

function nativeConfig(overrides: Partial<BackupNativeConfig> = {}): BackupNativeConfig {
  return {
    scheduleFrequency: 'daily',
    scheduleHour: 19,
    scheduleWeekday: 1,
    destinationConfigured: false,
    destinationAvailable: false,
    destinationDir: '',
    ...overrides,
  } as BackupNativeConfig;
}

function backupStatus(overrides: Partial<BackupStatus> = {}): BackupStatus {
  return {
    local_backup_count: 3,
    latest_local_backup_at: '2026-09-04T10:00:00Z',
    latest_local_backup_name: 'backup.zip',
    latest_local_backup_size: 1024,
    backup_due: false,
    latest_restore_drill_at: null,
    restore_drill_due: false,
    ...overrides,
  };
}

describe('BackupSettingsPanel', () => {
  it('never shows a green "Yedek güncel" badge while the status is unreadable', async () => {
    getBackupConfigurationMock.mockResolvedValue(null);
    getBackupStatusMock.mockRejectedValue(new Error('backend kapalı'));
    render(<BackupSettingsPanel variant="classic" />);

    // Belirsizlik nötrdür: yeşil rozet yerine 'Durum bilinmiyor'.
    expect(await screen.findByText('Durum bilinmiyor')).toBeInTheDocument();
    expect(screen.queryByText('Yedek güncel')).not.toBeInTheDocument();
    // Okunamayan durum açıkça bildirilir ve yenilenebilir.
    expect(screen.getByText(/Yedek durumu okunamadı/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Yenile/ })).toBeInTheDocument();

    // Zamanlama okunamadığında taslak varsayılanla KAYDEDİLEMEZ.
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeDisabled();
    expect(screen.getByLabelText('Sıklık')).toBeDisabled();
    // Ebedi 'Yükleniyor…' taklidi yok.
    expect(screen.getByText(/Zamanlama okunamadı/)).toBeInTheDocument();
    expect(screen.queryByText('Şu an: Yükleniyor…')).not.toBeInTheDocument();
  });

  it('shows the real badge and schedule once status and config load', async () => {
    getBackupConfigurationMock.mockResolvedValue(nativeConfig());
    getBackupStatusMock.mockResolvedValue(backupStatus());
    render(<BackupSettingsPanel variant="classic" />);

    expect(await screen.findByText('Yedek güncel')).toBeInTheDocument();
    expect(screen.getByText(/Her gün 19:00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeEnabled();
  });

  it('keeps the amber badge while a backup is due', async () => {
    getBackupConfigurationMock.mockResolvedValue(nativeConfig());
    getBackupStatusMock.mockResolvedValue(backupStatus({ backup_due: true }));
    render(<BackupSettingsPanel variant="classic" />);

    expect(await screen.findByText('Bugünkü yedek bekliyor')).toBeInTheDocument();
  });

  it('does not clobber an edited schedule draft when a backup completes', async () => {
    getBackupConfigurationMock.mockResolvedValue(nativeConfig());
    getBackupStatusMock.mockResolvedValue(backupStatus());
    render(<BackupSettingsPanel variant="classic" />);

    await screen.findByText(/Her gün 19:00/);

    // Operatör taslağı haftalığa çevirir (henüz kaydetmedi).
    fireEvent.change(screen.getByLabelText('Sıklık'), { target: { value: 'weekly' } });
    expect((screen.getByLabelText('Sıklık') as HTMLSelectElement).value).toBe('weekly');

    // backup-completed event'i refresh tetikler; taslak config'den EZİLEMEZ.
    // Not: mock çağrıları dosya içinde birikir — mutlak sayı değil fark doğrulanır.
    const statusCallsBefore = getBackupStatusMock.mock.calls.length;
    fireEvent(window, new Event('seroguld:backup-completed'));
    await waitFor(() => expect(getBackupStatusMock.mock.calls.length).toBe(statusCallsBefore + 1));
    expect((screen.getByLabelText('Sıklık') as HTMLSelectElement).value).toBe('weekly');
  });
});
