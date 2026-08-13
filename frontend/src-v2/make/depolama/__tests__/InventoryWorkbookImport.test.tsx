import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InventoryWorkbookImport } from '../InventoryWorkbookImport';

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }));

vi.mock('@/lib/api', () => ({ apiRequest: apiRequestMock }));
vi.mock('@/lib/desktop', () => ({
  isTauriRuntime: () => false,
  pickDocumentImportFile: vi.fn(),
}));

function renderImport() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <InventoryWorkbookImport variant="modern" />
    </QueryClientProvider>,
  );
}

describe('InventoryWorkbookImport', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it('previews the selected workbook and applies the same pending file only after confirmation', async () => {
    apiRequestMock
      .mockResolvedValueOnce({
        editable: true,
        changes: [{ sheet: 'Stok', cell_ref: 'A2', label: 'Ürün adı', old_value: 'Eski', new_value: 'Yeni' }],
        warnings: [],
        blocking_errors: [],
      })
      .mockResolvedValueOnce({});

    renderImport();
    const file = new File(['inventory'], 'depolama.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(screen.getByLabelText('Depolama Excel dosyası seç'), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(apiRequestMock).toHaveBeenNthCalledWith(1, '/api/v2/depolama/workbook/reconcile-preview', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByText('1 kontrollü değişiklik')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^İçe aktar$/ }));

    await waitFor(() => expect(apiRequestMock).toHaveBeenNthCalledWith(2, '/api/v2/depolama/workbook/import', expect.objectContaining({ method: 'POST' })));
    expect(screen.getByRole('status')).toHaveTextContent('Depolama listesi yenilendi');
  });

  it('keeps import disabled when the preview has a blocking error', async () => {
    apiRequestMock.mockResolvedValueOnce({
      editable: false,
      changes: [],
      warnings: [],
      blocking_errors: ['Workbook sözleşmesi geçersiz.'],
    });

    renderImport();
    const file = new File(['invalid'], 'depolama.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(screen.getByLabelText('Depolama Excel dosyası seç'), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByText('Workbook sözleşmesi geçersiz.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^İçe aktar$/ })).toBeDisabled();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });
});
