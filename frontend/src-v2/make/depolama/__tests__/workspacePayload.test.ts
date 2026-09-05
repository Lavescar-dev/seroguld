import { describe, expect, it } from 'vitest';

import type { DepolamaPageProps } from '../DepolamaPage';
import type { StokItem } from '../types';
import { buildWorkspaceQueryParams, rowToStokItem, toPatchPayload } from '../useDepolamaMakeState';
import { createModernDepolamaViewModel } from '@/modern/adapters/depolama';

function rowItem(overrides: Partial<StokItem> = {}): StokItem {
  return {
    id: 'p-1',
    stokNo: '1460',
    mainKat: 'taki',
    lagerDato: '2026-01-15',
    urun: 'Panzer armlænke 22K',
    saflik: 0.9166,
    birimGram: 19.65,
    adet: 1,
    alisFiyati: 13755,
    ...overrides,
  };
}

function minimalState(overrides: Record<string, unknown> = {}): DepolamaPageProps {
  return {
    loading: false,
    workspaceError: false,
    onRetryWorkspace: () => {},
    workspaceTotal: null,
    stokList: [],
    ...overrides,
  } as unknown as DepolamaPageProps;
}

describe('depolama PATCH payload', () => {
  it('sends purchase_date so Lager Dato edits persist', () => {
    const payload = toPatchPayload(rowItem()) as Record<string, unknown>;
    // create yolundaki toDateTime deseniyle aynı format
    expect(payload.purchase_date).toBe('2026-01-15T12:00:00+00:00');
  });

  it('falls back to today when lagerDato is empty', () => {
    const payload = toPatchPayload(rowItem({ lagerDato: '' })) as Record<string, unknown>;
    expect(String(payload.purchase_date)).toMatch(/^\d{4}-\d{2}-\d{2}T12:00:00\+00:00$/);
  });

  it('carries updatedAt as expected_updated_at for optimistic concurrency', () => {
    const withStamp = toPatchPayload(rowItem({ updatedAt: '2026-09-05T10:00:00+00:00' })) as Record<string, unknown>;
    expect(withStamp.expected_updated_at).toBe('2026-09-05T10:00:00+00:00');

    const withoutStamp = toPatchPayload(rowItem()) as Record<string, unknown>;
    expect(withoutStamp.expected_updated_at).toBeNull();
  });
});

describe('rowToStokItem', () => {
  it('maps row updated_at into the draft updatedAt', () => {
    const item = rowToStokItem({
      id: 'p-1',
      product_number: 'P-0001',
      main_category: 'taki',
      product_type: 'jewelry',
      metal_type: 'yellow_gold',
      status: 'in_inventory',
      lager_dato: '2026-01-15',
      urun: 'Test',
      saflik_label: '22K / 91.60%',
      birim_gram: '19.65',
      adet: 1,
      toplam_gram: '19.65',
      alis_fiyati_dkk: '13755.00',
      spot_degeri_dkk: '14000.00',
      updated_at: '2026-09-05T09:30:00+00:00',
    } as Parameters<typeof rowToStokItem>[0]);
    expect(item.updatedAt).toBe('2026-09-05T09:30:00+00:00');
  });

  it('leaves updatedAt undefined when the row has no timestamp', () => {
    const item = rowToStokItem({
      id: 'p-2',
      product_number: 'P-0002',
      main_category: 'taki',
      product_type: 'jewelry',
      metal_type: 'yellow_gold',
      status: 'in_inventory',
      lager_dato: '2026-01-15',
      urun: 'Test 2',
      saflik_label: '22K / 91.60%',
      birim_gram: '5.00',
      adet: 1,
      toplam_gram: '5.00',
      alis_fiyati_dkk: '3000.00',
      spot_degeri_dkk: '3100.00',
    } as Parameters<typeof rowToStokItem>[0]);
    expect(item.updatedAt).toBeUndefined();
  });
});

describe('modern depolama phase', () => {
  it('reports error phase instead of empty when the workspace request fails', () => {
    const vm = createModernDepolamaViewModel(
      minimalState({ workspaceError: true, loading: false, stokList: [] }),
    );
    expect(vm.phase).toBe('error');
  });

  it('keeps empty phase when the list is legitimately empty', () => {
    const vm = createModernDepolamaViewModel(minimalState());
    expect(vm.phase).toBe('empty');
  });

  it('surfaces row-limit truncation in the items stat', () => {
    const items = [
      { id: 'p-1', urun: 'A', mainKat: 'taki', birimGram: 1, adet: 1, alisFiyati: 1 } as StokItem,
      { id: 'p-2', urun: 'B', mainKat: 'taki', birimGram: 1, adet: 1, alisFiyati: 1 } as StokItem,
    ];
    const vm = createModernDepolamaViewModel(minimalState({ stokList: items, workspaceTotal: 5 }));
    expect(vm.phase).toBe('ready');
    const itemsStat = vm.stats.find((stat) => stat.id === 'items');
    expect(itemsStat?.value).toBe('2 / 5');
    expect(itemsStat?.hint).toContain('Limit nedeniyle kesildi');
  });
});

describe('buildWorkspaceQueryParams (regression guard)', () => {
  it('still does not send limit/offset — backend decides the window', () => {
    const params = new URLSearchParams(buildWorkspaceQueryParams(
      {
        q: '', dateFrom: '', dateTo: '', weightMin: '', weightMax: '',
        priceMin: '', priceMax: '', location: '', needsCleaning: false,
        gdprLocked: 'all', status: '',
      },
      'all',
      null,
    ));
    expect(params.has('limit')).toBe(false);
    expect(params.has('offset')).toBe(false);
  });
});
