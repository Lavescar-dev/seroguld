import { describe, expect, it } from 'vitest';

import { resolveCustomerPanelView } from '../customerPanelState';

describe('resolveCustomerPanelView — roadmap madde 1 MUTUALLY_EXCLUSIVE kuralları', () => {
  it('ATTACHED her zaman kazanır; mod state\'i takılı kalsa bile form/arama render edilmez', () => {
    expect(resolveCustomerPanelView(null, true)).toBe('attached');
    expect(resolveCustomerPanelView('existing', true)).toBe('attached');
    expect(resolveCustomerPanelView('new', true)).toBe('attached');
  });

  it('bağlı müşteri yokken mod görünümü seçer: arama veya form', () => {
    expect(resolveCustomerPanelView('existing', false)).toBe('search-existing');
    expect(resolveCustomerPanelView('new', false)).toBe('create-new');
  });

  it('IDLE_SELECT: mod null ve müşteri yokken aksiyon kartları görünür', () => {
    expect(resolveCustomerPanelView(null, false)).toBe('pick-action');
  });

  it('görünümler birbirini dışlar — aynı anda tek değer döner', () => {
    const views = [
      resolveCustomerPanelView(null, false),
      resolveCustomerPanelView('existing', false),
      resolveCustomerPanelView('new', false),
      resolveCustomerPanelView(null, true),
    ];
    expect(new Set(views).size).toBe(views.length);
  });
});
