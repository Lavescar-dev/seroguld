import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { moveId, photoCardDragProps, usePhotoReorder } from '../photoReorder';

function dragEventMock() {
  return {
    dataTransfer: { setData: vi.fn(), effectAllowed: 'all' },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.DragEvent<HTMLElement>;
}

describe('moveId', () => {
  it('inserts the dragged card at the target index (forward drag lands after)', () => {
    expect(moveId(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
  });

  it('inserts the dragged card at the target index (backward drag lands before)', () => {
    expect(moveId(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
  });

  it('returns a copy without calling anything when the position is unchanged', () => {
    const ids = ['a', 'b', 'c'];
    const next = moveId(ids, 'a', 'a');
    expect(next).toEqual(ids);
    expect(next).not.toBe(ids);
  });

  it('returns a copy when ids are missing from the list', () => {
    const ids = ['a', 'b'];
    expect(moveId(ids, 'x', 'a')).toEqual(ids);
    expect(moveId(ids, 'a', 'x')).toEqual(ids);
  });
});

describe('usePhotoReorder', () => {
  it('commits the full reordered id list on card drop', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => usePhotoReorder({ ids: ['a', 'b', 'c'], onCommit }));
    const event = dragEventMock();

    act(() => {
      result.current.onDragStart({ ...dragEventMock() } as unknown as React.DragEvent<HTMLElement>, 'a');
    });
    act(() => {
      result.current.onDropCard(event, 'c');
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(['b', 'c', 'a']);
    expect(event.preventDefault).toHaveBeenCalled();
    // Kap dosya-dropzone'u kart düşüşünde yanlışlıkla yükleme başlatmasın.
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it('routes wizard surfaces through onLocalReorder when no commit is given', () => {
    const onLocalReorder = vi.fn();
    const { result } = renderHook(() => usePhotoReorder({ ids: ['a', 'b', 'c'], onLocalReorder }));
    act(() => {
      result.current.onDragStart({ ...dragEventMock() } as unknown as React.DragEvent<HTMLElement>, 'b');
    });
    act(() => {
      result.current.onDropCard(dragEventMock(), 'c');
    });
    expect(onLocalReorder).toHaveBeenCalledTimes(1);
    expect(onLocalReorder).toHaveBeenCalledWith(['a', 'c', 'b']);
  });

  it('does not commit when the drop does not change the order', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => usePhotoReorder({ ids: ['a', 'b', 'c'], onCommit }));
    act(() => {
      result.current.onDragStart({ ...dragEventMock() } as unknown as React.DragEvent<HTMLElement>, 'a');
    });
    act(() => {
      result.current.onDropCard(dragEventMock(), 'a');
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('preventDefaults dragover only while a card is being dragged', () => {
    const { result } = renderHook(() => usePhotoReorder({ ids: ['a', 'b'] }));
    const idle = dragEventMock();
    result.current.onDragOverCard(idle);
    expect(idle.preventDefault).not.toHaveBeenCalled();

    act(() => {
      result.current.onDragStart({ ...dragEventMock() } as unknown as React.DragEvent<HTMLElement>, 'a');
    });
    const active = dragEventMock();
    result.current.onDragOverCard(active);
    expect(active.preventDefault).toHaveBeenCalled();
  });

  it('ignores drag start while disabled', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => usePhotoReorder({ ids: ['a', 'b'], disabled: true, onCommit }));
    const start = dragEventMock();
    act(() => {
      result.current.onDragStart(start, 'a');
    });
    expect(start.dataTransfer.setData).not.toHaveBeenCalled();
    act(() => {
      result.current.onDropCard(dragEventMock(), 'b');
    });
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('photoCardDragProps', () => {
  it('sets move effect data for Firefox and exposes isDragging', () => {
    const { result } = renderHook(() => usePhotoReorder({ ids: ['a', 'b'] }));
    let props = photoCardDragProps(result.current, 'a');
    expect(props.draggable).toBe(true);
    expect(props.isDragging).toBe(false);

    const start = dragEventMock();
    act(() => {
      props.onDragStart(start);
    });
    expect(start.dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'a');
    expect(start.dataTransfer.effectAllowed).toBe('move');

    props = photoCardDragProps(result.current, 'a');
    expect(props.isDragging).toBe(true);
  });

  it('marks cards without ids undraggable', () => {
    const { result } = renderHook(() => usePhotoReorder({ ids: [] }));
    const props = photoCardDragProps(result.current, null);
    expect(props.draggable).toBe(false);
  });
});
