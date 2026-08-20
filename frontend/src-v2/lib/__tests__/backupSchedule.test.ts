import { describe, expect, it } from 'vitest';

import { isBackupDue, type BackupSchedule } from '@/lib/backup';

// 2026-08-20 bir Perşembe (getDay() === 4).
const THURSDAY_20_00 = new Date(2026, 7, 20, 20, 0, 0);
const THURSDAY_08_00 = new Date(2026, 7, 20, 8, 0, 0);

const daily = (hour: number | null): BackupSchedule => ({ frequency: 'daily', hour, weekday: null });
const weekly = (hour: number | null, weekday: number): BackupSchedule => ({ frequency: 'weekly', hour, weekday });

describe('isBackupDue', () => {
  it('off asla otomatik yedek tetiklemez', () => {
    expect(isBackupDue({ frequency: 'off', hour: null, weekday: null }, null, THURSDAY_20_00)).toBe(false);
  });

  it('günlük: hiç yedek yoksa ve saat ulaştıysa alınır', () => {
    expect(isBackupDue(daily(19), null, THURSDAY_20_00)).toBe(true);
  });

  it('günlük: tercih edilen saatten önce beklenir', () => {
    expect(isBackupDue(daily(19), null, THURSDAY_08_00)).toBe(false);
  });

  it('günlük: bugün zaten alındıysa tekrar alınmaz', () => {
    const earlierToday = new Date(2026, 7, 20, 19, 30, 0).toISOString();
    expect(isBackupDue(daily(19), earlierToday, THURSDAY_20_00)).toBe(false);
  });

  it('günlük: son yedek dünse yeni gün alınır', () => {
    const yesterday = new Date(2026, 7, 19, 21, 0, 0).toISOString();
    expect(isBackupDue(daily(19), yesterday, THURSDAY_20_00)).toBe(true);
  });

  it('günlük: saat yoksa (gün içinde) ilk fırsatta alınır', () => {
    expect(isBackupDue(daily(null), null, THURSDAY_08_00)).toBe(true);
  });

  it('haftalık: doğru gün ve saatte alınır', () => {
    expect(isBackupDue(weekly(19, 4), null, THURSDAY_20_00)).toBe(true);
  });

  it('haftalık: yanlış günde alınmaz', () => {
    expect(isBackupDue(weekly(19, 1), null, THURSDAY_20_00)).toBe(false);
  });

  it('haftalık: doğru gün ama saatten önce beklenir', () => {
    expect(isBackupDue(weekly(19, 4), null, THURSDAY_08_00)).toBe(false);
  });

  it('bozuk son-yedek tarihi yok sayılır (hiç yedek gibi davranır)', () => {
    expect(isBackupDue(daily(19), 'not-a-date', THURSDAY_20_00)).toBe(true);
  });
});
