import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OfficeDockDescriptor } from '@/lib/officeDock';

import { OfficeDockPanel } from '../OfficeDockPanel';

const { panelProps } = vi.hoisted(() => ({ panelProps: [] as Array<Record<string, unknown>> }));

vi.mock('@/make/embedded/EmbeddedWorkbookPanel', () => ({
  EmbeddedWorkbookPanel: (props: Record<string, unknown>) => {
    panelProps.push(props);
    return <div data-testid="embedded-workbook-panel" />;
  },
}));

function dockDocument(overrides: Partial<OfficeDockDescriptor> = {}): OfficeDockDescriptor {
  return {
    kind: 'afg',
    key: 'afg-2026-33',
    title: 'AFG defteri',
    source: 'dock-test',
    emitted_at: '2026-08-30T12:00:00Z',
    ...overrides,
  };
}

describe('OfficeDockPanel — dock yerleşimi yönlendirmesi', () => {
  beforeEach(() => {
    panelProps.length = 0;
  });

  it('descriptor.kind/key değerlerini panele kind/artifactKey olarak, layoutMode’u "dock" olarak iletir', () => {
    const onClose = vi.fn();
    render(<OfficeDockPanel document={dockDocument({ kind: 'log', key: 'log-2026-33' })} onClose={onClose} />);

    expect(screen.getByTestId('embedded-workbook-panel')).toBeInTheDocument();
    expect(panelProps).toHaveLength(1);
    expect(panelProps[0]).toMatchObject({
      kind: 'log',
      artifactKey: 'log-2026-33',
      layoutMode: 'dock',
    });
    expect(panelProps[0]?.onClose).toBe(onClose);
  });

  it('paneli tam yükseklik flex sütun kabına sarar', () => {
    render(<OfficeDockPanel document={dockDocument()} onClose={vi.fn()} />);

    const wrapper = screen.getByTestId('embedded-workbook-panel').parentElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveClass('flex', 'h-full', 'min-h-0', 'flex-col');
  });
});
