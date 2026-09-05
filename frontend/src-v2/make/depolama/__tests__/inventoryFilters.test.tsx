import type { SetStateAction } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InventoryFilters } from '../InventoryFilters';
import { EMPTY_FILTERS, type InventoryFilterState } from '../types';

function renderFilters(overrides: Partial<InventoryFilterState> = {}) {
  const setFilters = vi.fn((action: SetStateAction<InventoryFilterState>) =>
    typeof action === 'function' ? action(EMPTY_FILTERS) : action,
  );
  const view = render(
    <InventoryFilters
      filters={{ ...EMPTY_FILTERS, ...overrides }}
      setFilters={setFilters}
      onReset={() => {}}
      totalCount={10}
      filteredCount={10}
    />,
  );
  return { setFilters, view };
}

describe('InventoryFilters debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('her tuşta istek atmaz — yazım bittikten 300ms sonra tek setFilters gelir', () => {
    const { setFilters, view } = renderFilters();
    const input = view.getByPlaceholderText('Stok no, ürün adı, üretici, depo, notlar...') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'an' } });
    fireEvent.change(input, { target: { value: 'anello' } });

    // debounce penceresi içinde hiçbir güncelleme gitmez
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(setFilters).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(setFilters).toHaveBeenCalledTimes(1);
    const updater = setFilters.mock.calls[0][0] as (current: InventoryFilterState) => InventoryFilterState;
    const next = updater({ ...EMPTY_FILTERS });
    expect(next.q).toBe('anello');
  });

  it('lokasyon filtresi de debounce edilir', () => {
    const { setFilters, view } = renderFilters();
    const input = view.getByPlaceholderText('Depo / lokasyon') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Kasa 1' } });
    expect(setFilters).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(setFilters).toHaveBeenCalledTimes(1);
    const updater = setFilters.mock.calls[0][0] as (current: InventoryFilterState) => InventoryFilterState;
    const next = updater({ ...EMPTY_FILTERS });
    expect(next.location).toBe('Kasa 1');
  });

  it('dışarıdan sıfırlama (Filtreleri Temizle) taslağı ve bekleyen commiti düşürür', () => {
    const setFilters = vi.fn((action: SetStateAction<InventoryFilterState>) =>
    typeof action === 'function' ? action(EMPTY_FILTERS) : action,
  );
    const makeView = (filters: InventoryFilterState) =>
      render(
        <InventoryFilters filters={filters} setFilters={setFilters} onReset={() => {}} totalCount={10} filteredCount={10} />,
      );
    const first = makeView({ ...EMPTY_FILTERS });
    const input = first.getByPlaceholderText('Stok no, ürün adı, üretici, depo, notlar...') as HTMLInputElement;

    // commit uygulanır, parent q='anello' taşır → taslak senkron, yeni commit yok
    fireEvent.change(input, { target: { value: 'anello' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(setFilters).toHaveBeenCalledTimes(1);
    first.unmount();

    // parent commit'i uyguladı (q='anello'); şimdi Filtreleri Temizle → q=''
    const second = makeView({ ...EMPTY_FILTERS, q: 'anello' });
    const input2 = second.getByPlaceholderText('Stok no, ürün adı, üretici, depo, notlar...') as HTMLInputElement;
    expect(input2.value).toBe('anello');

    second.rerender(
      <InventoryFilters filters={{ ...EMPTY_FILTERS }} setFilters={setFilters} onReset={() => {}} totalCount={10} filteredCount={10} />,
    );
    expect(input2.value).toBe('');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(setFilters).toHaveBeenCalledTimes(1); // reset ekstra commit üretmez
  });
});
