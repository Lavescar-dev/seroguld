import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }));

vi.mock('@/lib/api', () => ({
  apiRequest: apiRequestMock,
  localizeApiError: (error: unknown) => String(error),
}));

import { LegacyMigrationCenter } from '../LegacyMigrationCenter';

// Node 26 + jsdom kurulumunda window.localStorage tanımsız geliyor
// (alisErrorStates.test.tsx ile aynı taklak).
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(String(key), String(value));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }
  get length() {
    return this.store.size;
  }
}

beforeAll(() => {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (typeof window[name] === 'undefined') {
      Object.defineProperty(window, name, {
        value: new MemoryStorage(),
        configurable: true,
        writable: false,
      });
    }
  }
});

const storageKey = 'seroguld.legacyMigrationRunId';

type PhaseState = { status: string; file_count: number; record_count: number; ready: number; blocked: number; already_imported: number; applied: number; skipped: number };

function makePhaseState(overrides: Partial<PhaseState> = {}): PhaseState {
  return { status: 'empty', file_count: 0, record_count: 0, ready: 0, blocked: 0, already_imported: 0, applied: 0, skipped: 0, ...overrides };
}

function makeRun(afgPhase: PhaseState) {
  return {
    id: 'run-1',
    status: 'in_progress',
    current_phase: 'afg',
    settings: {},
    phases: { afg: afgPhase, inventory: makePhaseState(), log: makePhaseState() },
    files: [{ id: 'file-1', phase: 'afg', file_name: 'afg.xlsx', status: afgPhase.blocked > 0 ? 'blocked' : 'ready', error: null }],
  };
}

function makeRecords(blockedResolved: boolean) {
  return {
    items: [
      { id: 'rec-1', source_key: 'afg:hash-1', status: 'ready', payload: {}, warnings: [], errors: [] },
      {
        id: 'rec-2',
        source_key: 'afg:hash-2',
        status: blockedResolved ? 'skipped' : 'blocked',
        payload: {},
        warnings: [],
        errors: blockedResolved ? [] : ['Miktar alanı çözülemedi'],
      },
    ],
  };
}

describe('LegacyMigrationCenter engelli kayıt çözümü (A10)', () => {
  let run: ReturnType<typeof makeRun>;
  let records: ReturnType<typeof makeRecords>;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(storageKey, 'run-1');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    run = makeRun(makePhaseState({ status: 'blocked', file_count: 1, record_count: 2, ready: 1, blocked: 1 }));
    records = makeRecords(false);
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((url: string, options?: { method?: string; body?: string }) => {
      const method = options?.method || 'GET';
      if (method === 'PATCH' && String(url).includes('/conflicts/rec-2')) {
        const action = JSON.parse(String(options?.body)).action as string;
        records = makeRecords(true);
        run = makeRun(makePhaseState({ status: 'blocked', file_count: 1, record_count: 2, ready: 1, blocked: 0, skipped: 1 }));
        return Promise.resolve({ id: 'rec-2', status: 'skipped', resolution: { action } });
      }
      if (String(url) === '/api/v2/legacy-migrations/runs/run-1') return Promise.resolve(run);
      if (String(url).includes('/afg/records')) return Promise.resolve(records);
      return Promise.resolve({});
    });
  });

  it('engelli kayıtlara Atla ve Mevcudu koru aksiyonlarını basar', async () => {
    render(<LegacyMigrationCenter open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('afg:hash-2')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Atla/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mevcudu koru/ })).toBeInTheDocument();
    // Engelli kayıt varken uygula kapalı.
    expect(screen.getByRole('button', { name: 'Adımı atomik uygula' })).toBeDisabled();
  });

  it('Atla PATCH conflicts ucunu çağırır, kayıtları ve canApply durumunu tazeler', async () => {
    render(<LegacyMigrationCenter open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Atla/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Atla/ }));

    await waitFor(() => {
      const patchCall = apiRequestMock.mock.calls.find(
        ([url, options]) => String(url).includes('/conflicts/rec-2') && options?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ action: 'skip' });
    });

    // Refresh sonrası: kayıt 'skipped' görünüyor, engelli 0 — canApply
    // (dosya durumu 'blocked' kalsa bile) yeniden hesaplanıp açıldı.
    await waitFor(() => expect(screen.getByText('skipped')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Adımı atomik uygula' })).toBeEnabled();
  });

  it('Mevcudu koru keep_existing aksiyonunu gönderir', async () => {
    render(<LegacyMigrationCenter open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Mevcudu koru/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Mevcudu koru/ }));

    await waitFor(() => {
      const patchCall = apiRequestMock.mock.calls.find(
        ([url, options]) => String(url).includes('/conflicts/rec-2') && options?.method === 'PATCH',
      );
      expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ action: 'keep_existing' });
    });
  });

  it('confirm iptal edilirse PATCH göndermez', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<LegacyMigrationCenter open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Atla/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Atla/ }));

    await waitFor(() => expect(screen.getByText('afg:hash-2')).toBeInTheDocument());
    const patchCalls = apiRequestMock.mock.calls.filter(([url, options]) => String(url).includes('/conflicts') && options?.method === 'PATCH');
    expect(patchCalls).toHaveLength(0);
  });
});
