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
