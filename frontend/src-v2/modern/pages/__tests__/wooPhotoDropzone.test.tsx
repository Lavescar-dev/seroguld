import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PhotosTab } from '../ModernWooCommercePage';
import type { WooMakeState } from '@/make/woocommerce/useWooMakeState';

function makeState(overrides: Partial<WooMakeState> = {}): WooMakeState {
  return {
    detail: {
      id: 'p1',
      display_name: 'Test ürün',
      photos: [],
    },
    uploadPhotos: vi.fn(),
    isUploadingPhotos: false,
    deletePhoto: vi.fn(),
    isDeletingPhoto: false,
    reorderPhotos: vi.fn(),
    isReorderingPhotos: false,
    ...overrides,
  } as unknown as WooMakeState;
}

function dropEventPayload(files: File[]) {
  return { dataTransfer: { files, items: [], types: ['Files'] } };
}

describe('Woo photo drag-and-drop', () => {
  it('highlights the dropzone while dragging over it', () => {
    render(<PhotosTab state={makeState()} />);
    const dropzone = screen.getByTestId('woo-photo-dropzone');
    fireEvent.dragOver(dropzone, dropEventPayload([]));
    expect(screen.getByText('Fotoğrafları buraya bırakın')).toBeTruthy();
    fireEvent.drop(dropzone, dropEventPayload([]));
    expect(screen.queryByText('Fotoğrafları buraya bırakın')).toBeNull();
  });

  it('routes dropped files through the shared validated upload path', () => {
    const state = makeState();
    render(<PhotosTab state={state} />);
    const dropzone = screen.getByTestId('woo-photo-dropzone');
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });
    fireEvent.drop(dropzone, dropEventPayload([file]));
    expect(state.uploadPhotos).toHaveBeenCalledTimes(1);
    expect((state.uploadPhotos as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual([file]);
  });

  it('shows the uploading status on the picker button', () => {
    render(<PhotosTab state={makeState({ isUploadingPhotos: true })} />);
    expect(screen.getByText('Yükleniyor…')).toBeTruthy();
  });
});

describe('Woo photo reorder (R1-36 v2)', () => {
  function photoState(overrides: Partial<WooMakeState> = {}) {
    const detail = {
      id: 'p1',
      display_name: 'Test ürün',
      photos: [
        { id: 'a', url: '/media/a.jpg', filename: 'a.jpg', is_primary: true },
        { id: 'b', url: '/media/b.jpg', filename: 'b.jpg', is_primary: false },
        { id: 'c', url: '/media/c.jpg', filename: 'c.jpg', is_primary: false },
      ],
    } as unknown as WooMakeState['detail'];
    return makeState({ detail, ...overrides });
  }

  function cardDropEvent() {
    return { dataTransfer: { files: [], items: [], types: ['text/plain'] } };
  }

  function cardDragStartEvent() {
    return { dataTransfer: { setData: () => undefined, effectAllowed: 'all', types: ['text/plain'] } };
  }

  it('reorders via card drop and PUTs the full pre-dedup id list once', () => {
    const state = photoState();
    render(<PhotosTab state={state} />);

    fireEvent.dragStart(screen.getByTestId('woo-photo-card-0'), cardDragStartEvent());
    fireEvent.dragOver(screen.getByTestId('woo-photo-card-2'), cardDropEvent());
    fireEvent.drop(screen.getByTestId('woo-photo-card-2'), cardDropEvent());

    expect(state.reorderPhotos).toHaveBeenCalledTimes(1);
    expect((state.reorderPhotos as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(['p1', ['b', 'c', 'a']]);
    // Kart düşüşü dosya yükleme yolunu tetiklememeli.
    expect(state.uploadPhotos).not.toHaveBeenCalled();
  });

  it('does not call the API when the drop keeps the same order', () => {
    const state = photoState();
    render(<PhotosTab state={state} />);

    fireEvent.dragStart(screen.getByTestId('woo-photo-card-1'), cardDragStartEvent());
    fireEvent.drop(screen.getByTestId('woo-photo-card-1'), cardDropEvent());

    expect(state.reorderPhotos).not.toHaveBeenCalled();
  });

  it('does not hijack the file dropzone highlight during card drags', () => {
    const state = photoState();
    render(<PhotosTab state={state} />);

    fireEvent.dragStart(screen.getByTestId('woo-photo-card-0'), cardDragStartEvent());
    // Kart sürüklemesi types'a 'Files' taşımaz → dropzone vurgusu yanmalı.
    fireEvent.dragOver(screen.getByTestId('woo-photo-dropzone'), cardDropEvent());
    expect(screen.queryByText('Fotoğrafları buraya bırakın')).toBeNull();
  });
});
