// M3 — modern Log modülü import akışı: doğrudan window.confirm + import
// yerine reconcile-preview önizleme adımı zorunlu. blocking_errors varken
// apply kilitli; apply ayrı bir adımda /log/workbook/import'u çağırır.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createModernLogViewModel } from '@/modern/adapters/log';
import { ModernLogModule } from '@/modern/modules/log';

import { buildLogState } from '../../../modern/__tests__/logFixtures';

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiRequest: apiRequestMock,
  downloadAuthedDocument: vi.fn(),
  fetchAuthedText: vi.fn(),
  localizeApiError: (error: unknown) => String(error),
}));

vi.mock('@/lib/toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

function selectExcelFile(name = 'Log-2026.xlsx') {
  const input = document.querySelector('input[type="file"][aria-label="Log Excel dosyası seç"]');
  if (!input) throw new Error('Log Excel file input bulunamadı');
  const file = new File(['workbook-bytes'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('ModernLogModule — Log Excel import önizleme akışı (M3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it('Excel seçimi doğrudan import etmez; önce reconcile-preview önizlemesi açılır', async () => {
    apiRequestMock.mockImplementation((url: unknown) => {
      if (typeof url === 'string' && url.includes('/api/v2/log/workbook/reconcile-preview')) {
        return Promise.resolve({
          editable: true,
          changes: [
            { sheet: 'Ruter', cell_ref: 'C5', label: 'Rota — AFG-1', old_value: 'undecided', new_value: 'inventory' },
          ],
          warnings: [],
          blocking_errors: [],
        });
      }
      return Promise.resolve({});
    });

    render(<ModernLogModule viewModel={createModernLogViewModel(buildLogState({}))} />);

    selectExcelFile();

    await waitFor(() => expect(screen.getByText('Değişiklikleri kontrol et')).toBeInTheDocument());
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(String(apiRequestMock.mock.calls[0][0])).toContain('/api/v2/log/workbook/reconcile-preview');
    expect(apiRequestMock.mock.calls.every(([url]) => !String(url).includes('/log/workbook/import'))).toBe(true);
  });

  it('blocking_errors varken "İçe aktar" disable\'dır ve engel listelenir', async () => {
    apiRequestMock.mockImplementation((url: unknown) => {
      if (typeof url === 'string' && url.includes('/api/v2/log/workbook/reconcile-preview')) {
        return Promise.resolve({
          editable: false,
          changes: [],
          warnings: [],
          blocking_errors: ['Log artifact conflict_state=conflict; önce yenileyin; apply yapılmadı.'],
        });
      }
      return Promise.resolve({});
    });

    render(<ModernLogModule viewModel={createModernLogViewModel(buildLogState({}))} />);

    selectExcelFile();

    await waitFor(() => expect(screen.getByText('Import engellendi')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /İçe aktar/ })).toBeDisabled();
  });

  it('onay sonrası /log/workbook/import uygulanır', async () => {
    apiRequestMock.mockImplementation((url: unknown) => {
      if (typeof url === 'string' && url.includes('/api/v2/log/workbook/reconcile-preview')) {
        return Promise.resolve({ editable: true, changes: [], warnings: [], blocking_errors: [] });
      }
      return Promise.resolve({});
    });

    render(<ModernLogModule viewModel={createModernLogViewModel(buildLogState({}))} />);

    selectExcelFile();
    await waitFor(() => expect(screen.getByText('Değişiklikleri kontrol et')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /İçe aktar/ }));

    await waitFor(() =>
      expect(apiRequestMock.mock.calls.some(([url]) => String(url).includes('/log/workbook/import?year='))).toBe(true),
    );
  });
});
