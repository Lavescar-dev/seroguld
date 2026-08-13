import type { RefObject } from 'react';

import { EmbeddedWorkbookPanel } from '@/make/embedded/EmbeddedWorkbookPanel';
import type { DesktopOfficeRuntimeState, DesktopRuntimeInfo } from '@/lib/desktop';
import type { FrontendRuntimeInfo } from '@/lib/runtimeInfo';
import type {
  DocumentArtifactReconcilePreview,
  OfficeDocumentLaunch,
  OfficeDocumentStatus,
  OfficeRuntimeStatus,
  RuntimeStatus,
} from '@/types';

/**
 * Compatibility view model retained for the modern adapters and transition
 * tests. Rendering is intentionally delegated to the backend-controlled
 * embedded workbook surface; no external editor or runtime is mounted here.
 */
export interface OfficeDocumentPageProps {
  kind: string;
  artifactKey: string;
  launch: OfficeDocumentLaunch | null;
  status: OfficeDocumentStatus | null;
  runtimeStatus: OfficeRuntimeStatus | null;
  appRuntimeStatus: RuntimeStatus | null;
  desktopRuntime: DesktopRuntimeInfo | null;
  desktopOfficeRuntime?: DesktopOfficeRuntimeState | null;
  frontendRuntime: FrontendRuntimeInfo;
  runtimeWarnings: string[];
  iframeName: string;
  formRef: RefObject<HTMLFormElement>;
  useNativeImportDialog: boolean;
  isLoading: boolean;
  isError: boolean;
  launchError?: { status?: number; message: string } | null;
  isImporting: boolean;
  isStatusRefreshing: boolean;
  isSessionRefreshing: boolean;
  isOfficeRuntimeStarting?: boolean;
  isIframeLoading: boolean;
  hasIframeLoadTimedOut: boolean;
  launchRequestMs: number | null;
  iframeLoadMs: number | null;
  sessionRefreshMs: number | null;
  isSessionStale: boolean;
  canReopenWindow: boolean;
  hasExternalUpdate: boolean;
  lastImportError: string | null;
  lastExportNotice: string | null;
  lastExportError: string | null;
  lastEditorError: string | null;
  importReconcilePreview?: DocumentArtifactReconcilePreview | null;
  pendingImportFileName?: string | null;
  isPreviewingImport?: boolean;
  isLivePreviewDirty?: boolean;
  isLivePreviewSyncing?: boolean;
  lastLivePreviewError?: string | null;
  onRetryLivePreviewSync?: () => void;
  onBeforeClose?: () => Promise<boolean>;
  onExport: () => void;
  onImportFromDialog: () => void;
  onImportFile: (file: File) => void;
  onApplyImportPreview?: () => void;
  onCancelImportPreview?: () => void;
  onRefreshStatus: () => void;
  onRefreshSession: () => void;
  onEnsureOfficeRuntime?: () => void;
  onReopenWindow: () => void | Promise<void>;
  onIframeLoad: () => void;
  onEditorError: (message: string) => void;
  onEditorDirtyStateChange?: (dirty: boolean) => void;
  layoutMode?: 'page' | 'dock' | 'workspace';
  onClose?: () => void | Promise<void>;
}

/**
 * Legacy make-route entry point kept as a source-compatible adapter. All
 * callers now receive the same embedded surface used by modern routes.
 */
export function MakeOfficeDocumentPage({
  kind,
  artifactKey,
  layoutMode = 'page',
  onClose,
}: OfficeDocumentPageProps) {
  return (
    <EmbeddedWorkbookPanel
      kind={kind}
      artifactKey={artifactKey}
      layoutMode={layoutMode}
      onClose={onClose}
    />
  );
}
