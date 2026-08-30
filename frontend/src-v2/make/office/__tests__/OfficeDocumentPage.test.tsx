import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MakeOfficeDocumentPage } from '../OfficeDocumentPage';
import type { OfficeDocumentPageProps } from '../OfficeDocumentPage';

const { panelProps } = vi.hoisted(() => ({ panelProps: [] as Array<Record<string, unknown>> }));

vi.mock('@/make/embedded/EmbeddedWorkbookPanel', () => ({
  EmbeddedWorkbookPanel: (props: Record<string, unknown>) => {
    panelProps.push(props);
    return <div data-testid="embedded-workbook-panel" />;
  },
}));

function baseProps(overrides: Partial<OfficeDocumentPageProps> = {}): OfficeDocumentPageProps {
  return {
    kind: 'afg',
    artifactKey: 'afg-2026-33',
    launch: null,
    status: null,
    runtimeStatus: null,
    appRuntimeStatus: null,
    desktopRuntime: null,
    desktopOfficeRuntime: null,
    frontendRuntime: {
      frontend_mode: 'dev',
      frontend_built_at: '2026-08-30T00:00:00Z',
      api_base_url: 'http://127.0.0.1:8000',
    },
    runtimeWarnings: [],
    iframeName: 'office-iframe',
    formRef: { current: null },
    useNativeImportDialog: false,
    isLoading: false,
    isError: false,
    launchError: null,
    isImporting: false,
    isStatusRefreshing: false,
    isSessionRefreshing: false,
    isOfficeRuntimeStarting: false,
    isIframeLoading: false,
    hasIframeLoadTimedOut: false,
    launchRequestMs: null,
    iframeLoadMs: null,
    sessionRefreshMs: null,
    isSessionStale: false,
    canReopenWindow: false,
    hasExternalUpdate: false,
    lastImportError: null,
    lastExportNotice: null,
    lastExportError: null,
    lastEditorError: null,
    importReconcilePreview: null,
    pendingImportFileName: null,
    isPreviewingImport: false,
    isLivePreviewDirty: false,
    isLivePreviewSyncing: false,
    lastLivePreviewError: null,
    onBeforeClose: vi.fn(async () => true),
    onExport: vi.fn(),
    onImportFromDialog: vi.fn(),
    onImportFile: vi.fn(),
    onApplyImportPreview: vi.fn(),
    onCancelImportPreview: vi.fn(),
    onRefreshStatus: vi.fn(),
    onRefreshSession: vi.fn(),
    onEnsureOfficeRuntime: vi.fn(),
    onReopenWindow: vi.fn(),
    onIframeLoad: vi.fn(),
    onEditorError: vi.fn(),
    onEditorDirtyStateChange: vi.fn(),
    layoutMode: 'page',
    onClose: vi.fn(),
    ...overrides,
  };
}

function fullLaunch() {
  return {
    kind: 'afg',
    key: 'afg-2026-33',
    launch_mode: 'embedded-workbook',
    provider: 'local',
    provider_label: 'Yerel',
    provider_branding_level: 'full',
    title: 'Afg defteri',
    subtitle: null,
    fallback_route: '/afg',
    download_path: '/api/afg/download',
    artifact: null,
    can_write: true,
    import_supported: true,
    sheets: [],
    office_available: false,
    office_reason: 'runtime yok',
    editor_url: null,
    access_token: null,
    access_token_ttl: null,
  };
}

function fullStatus() {
  return {
    kind: 'afg',
    key: 'afg-2026-33',
    provider: 'local',
    provider_label: 'Yerel',
    provider_branding_level: 'full',
    artifact: null,
    can_write: true,
    import_supported: true,
    office_available: false,
  };
}

describe('MakeOfficeDocumentPage — legacy adapter panel yönlendirmesi', () => {
  beforeEach(() => {
    panelProps.length = 0;
  });

  it('kind/artifactKey/layoutMode/onClose değerlerini EmbeddedWorkbookPanel’e aynen iletir', () => {
    const onClose = vi.fn();
    render(
      <MakeOfficeDocumentPage
        {...baseProps({ kind: 'envanter', artifactKey: 'env-2026-33', layoutMode: 'workspace', onClose })}
      />,
    );

    expect(screen.getByTestId('embedded-workbook-panel')).toBeInTheDocument();
    expect(panelProps).toHaveLength(1);
    expect(panelProps[0]).toMatchObject({
      kind: 'envanter',
      artifactKey: 'env-2026-33',
      layoutMode: 'workspace',
    });
    expect(panelProps[0]?.onClose).toBe(onClose);
  });

  it('layoutMode verilmezse panel varsayılan "page" modunu alır', () => {
    render(<MakeOfficeDocumentPage {...baseProps()} />);

    expect(panelProps[0]).toMatchObject({
      kind: 'afg',
      artifactKey: 'afg-2026-33',
      layoutMode: 'page',
    });
  });

  it('onClose verilmezse panele onClose iletmez (undefined)', () => {
    render(<MakeOfficeDocumentPage {...baseProps({ onClose: undefined })} />);

    expect(panelProps[0]?.onClose).toBeUndefined();
  });

  it('runtime bilgisi hiç yokken bile gömülü paneli render eder (fallback)', () => {
    render(
      <MakeOfficeDocumentPage
        {...baseProps({
          isLoading: true,
          isIframeLoading: true,
          hasIframeLoadTimedOut: true,
          runtimeStatus: null,
          appRuntimeStatus: null,
          desktopRuntime: null,
          desktopOfficeRuntime: null,
          launch: null,
          status: null,
        })}
      />,
    );

    expect(screen.getByTestId('embedded-workbook-panel')).toBeInTheDocument();
  });

  it('legacy state props panele sızmaz: panele yalnız dört prop gider', () => {
    render(
      <MakeOfficeDocumentPage
        {...baseProps({
          launch: fullLaunch(),
          status: fullStatus(),
          runtimeStatus: {
            provider: 'local',
            provider_label: 'Yerel',
            provider_branding_level: 'full',
            runtime_available: false,
            discovery_cached: false,
            runtime_url: '',
            wopi_base_url: '',
            reason: 'runtime yok',
          },
          appRuntimeStatus: {
            app_name: 'sero-guld',
            env: 'production',
            backend_pid: 4242,
            backend_started_at: '2026-08-30T00:00:00Z',
            backend_url: 'http://127.0.0.1:8000',
            office_runtime_url: '',
            office_wopi_base_url: '',
          },
          desktopRuntime: { runtime_mode: 'tauri', binary_path: 'C:/apps/office.exe' },
          desktopOfficeRuntime: { status: 'error', message: 'runtime yok', runtimeUrl: '', retryable: true },
          isError: true,
          lastImportError: 'import başarısız',
        })}
      />,
    );

    expect(Object.keys(panelProps[0] ?? {}).sort()).toEqual(['artifactKey', 'kind', 'layoutMode', 'onClose']);
  });
});
