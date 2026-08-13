import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopLifecycle } from '../DesktopLifecycle';

const desktopMocks = vi.hoisted(() => ({
  confirmDesktopClose: vi.fn(async () => true),
  consumeDesktopCloseRequest: vi.fn(async () => false),
  focusManagedExcelSession: vi.fn(async () => true),
  getDesktopStartupState: vi.fn(),
  isTauriRuntime: vi.fn(() => true),
  listenDesktopCloseRequest: vi.fn(async () => () => undefined),
  openRuntimeDiagnostics: vi.fn(async () => null),
  retryDesktopStartup: vi.fn(async () => null),
}));

vi.mock('@/lib/desktop', () => desktopMocks);

describe('DesktopLifecycle startup failure surface', () => {
  beforeEach(() => {
    desktopMocks.getDesktopStartupState.mockResolvedValue({
      state: 'failed',
      message: 'Traceback (most recent call last):\\npython backend crashed',
      logs_dir: 'C:\\ProgramData\\SeroGuld\\logs',
    });
  });

  it('keeps raw runtime details out of the failed splash', async () => {
    render(
      <DesktopLifecycle>
        <div>Authenticated workspace</div>
      </DesktopLifecycle>,
    );

    const error = await screen.findByTestId('startup-error');
    expect(error).toHaveTextContent('Yerel çalışma alanı hazır olmadığı için uygulama açılamadı.');
    expect(error).toHaveTextContent('Teknik ayrıntılar tanı klasörüne yazıldı.');
    expect(error).not.toHaveTextContent('Traceback');
    expect(error).not.toHaveTextContent('python backend crashed');
    expect(error).not.toHaveTextContent('C:\\ProgramData\\SeroGuld\\logs');
  });
});
