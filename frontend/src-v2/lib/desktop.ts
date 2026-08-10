import { isTauri as isTauriCore } from '@tauri-apps/api/core';

type TauriInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;

type TauriGlobal = typeof globalThis & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  isTauri?: boolean;
};

export type IdentityScanSide = 'front' | 'back';
export type IdentityScanSource = 'wia' | 'file';
export type IdentityScanMimeType = 'image/jpeg' | 'image/png' | 'image/tiff' | 'image/bmp';
export type IdentityScannerPlatform = 'windows' | 'macos' | 'linux' | 'unknown';
export type IdentityScannerErrorCode =
  | 'UNSUPPORTED_PLATFORM'
  | 'BRIDGE_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'SCAN_CANCELLED'
  | 'SCANNER_UNAVAILABLE'
  | 'ACQUISITION_FAILED'
  | 'INVALID_IMAGE'
  | 'FILE_TOO_LARGE'
  | 'FILE_READ_FAILED'
  | 'OCR_UNAVAILABLE'
  | 'OCR_FAILED'
  | 'TEMP_CLEANUP_FAILED'
  | 'INTERNAL_ERROR';

export interface IdentityScannerCapabilities {
  supported: boolean;
  platform: IdentityScannerPlatform;
  wiaAcquisition: boolean;
  localOcr: boolean;
  imageFileFallback: boolean;
  maxFileBytes: number;
  acceptedMimeTypes: IdentityScanMimeType[];
}

export interface IdentityScanResult {
  side: IdentityScanSide;
  source: IdentityScanSource;
  mimeType: IdentityScanMimeType;
  previewDataUrl: string;
  ocrText: string;
  ocrLines: string[];
}

export interface IdentityScannerErrorPayload {
  code: IdentityScannerErrorCode;
  message: string;
  retryable: boolean;
}

export class IdentityScannerBridgeError extends Error implements IdentityScannerErrorPayload {
  readonly code: IdentityScannerErrorCode;
  readonly retryable: boolean;

  constructor({ code, message, retryable }: IdentityScannerErrorPayload) {
    super(message);
    this.name = 'IdentityScannerBridgeError';
    this.code = code;
    this.retryable = retryable;
  }
}

export type DesktopDisplayWindowState = {
  has_secondary_monitor: boolean;
  active_route: string;
  window_open: boolean;
  secondary_monitor?: {
    name: string;
    width: number;
    height: number;
    x: number;
    y: number;
    primary: boolean;
  } | null;
};

export type PickedDocumentImportFile = {
  file_name: string;
  data_base64: string;
};

export type DesktopRuntimeInfo = {
  runtime_mode: string;
  binary_path: string;
  binary_mtime_unix_ms?: number | null;
  dev_base_url?: string | null;
};

export type DocumentExportResult = {
  path: string;
  mode: 'save-dialog' | 'downloads-fallback' | string;
};

export type UiDiagnosticPayload = {
  occurredAt: string;
  route: string;
  uiVariant: 'classic' | 'modern';
  frontendBuild: string;
  errorCode: string;
};

export type UiDiagnosticResult = {
  path: string;
};

export type PendingPurchaseDraft = {
  ownerKey: string;
  sessionId: string;
  baseRevision: number;
  generation: number;
  baseline: unknown;
  local: unknown;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export const DISPLAY_IDLE_ROUTE = '/display/idle';

let invokeLoader: Promise<TauriInvoke | null> | null = null;

async function getInvoke(): Promise<TauriInvoke | null> {
  if (typeof window === 'undefined') return null;
  if (!invokeLoader) {
    invokeLoader = import('@tauri-apps/api/core')
      .then((module) => module.invoke as TauriInvoke)
      .catch(() => null);
  }
  return invokeLoader;
}

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const tauriGlobal = globalThis as TauriGlobal;
  return (
    isTauriCore() ||
    tauriGlobal.isTauri === true ||
    Boolean(tauriGlobal.__TAURI__ || tauriGlobal.__TAURI_INTERNALS__) ||
    navigator.userAgent.includes('Tauri')
  );
}

async function invokeDesktop<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = await getInvoke();
  if (!invoke) {
    throw new Error('Tauri runtime bulunamadı');
  }
  return invoke<T>(command, args);
}

const IDENTITY_SCANNER_ERROR_CODES: IdentityScannerErrorCode[] = [
  'UNSUPPORTED_PLATFORM',
  'BRIDGE_UNAVAILABLE',
  'INVALID_REQUEST',
  'SCAN_CANCELLED',
  'SCANNER_UNAVAILABLE',
  'ACQUISITION_FAILED',
  'INVALID_IMAGE',
  'FILE_TOO_LARGE',
  'FILE_READ_FAILED',
  'OCR_UNAVAILABLE',
  'OCR_FAILED',
  'TEMP_CLEANUP_FAILED',
  'INTERNAL_ERROR',
];

function unsupportedIdentityScannerCapabilities(platform: IdentityScannerPlatform = 'unknown'): IdentityScannerCapabilities {
  return {
    supported: false,
    platform,
    wiaAcquisition: false,
    localOcr: false,
    imageFileFallback: false,
    maxFileBytes: 10 * 1024 * 1024,
    acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/tiff', 'image/bmp'],
  };
}

function isIdentityScannerErrorCode(value: unknown): value is IdentityScannerErrorCode {
  return typeof value === 'string' && IDENTITY_SCANNER_ERROR_CODES.includes(value as IdentityScannerErrorCode);
}

function identityScannerBridgeError(error: unknown): IdentityScannerBridgeError {
  if (error instanceof IdentityScannerBridgeError) return error;

  const payload = error && typeof error === 'object' ? (error as Partial<IdentityScannerErrorPayload>) : null;
  if (payload && isIdentityScannerErrorCode(payload.code) && typeof payload.message === 'string') {
    return new IdentityScannerBridgeError({
      code: payload.code,
      message: payload.message,
      retryable: payload.retryable === true,
    });
  }

  return new IdentityScannerBridgeError({
    code: 'BRIDGE_UNAVAILABLE',
    message: 'Kimlik tarama masaüstü köprüsüne ulaşılamıyor.',
    retryable: false,
  });
}

async function requireIdentityScannerCapabilities(): Promise<IdentityScannerCapabilities> {
  const capabilities = await getIdentityScannerCapabilities();
  if (!capabilities.supported) {
    throw new IdentityScannerBridgeError({
      code: 'UNSUPPORTED_PLATFORM',
      message: 'Kimlik tarama yalnızca Windows masaüstü uygulamasında kullanılabilir.',
      retryable: false,
    });
  }
  return capabilities;
}

/**
 * Reports the local-only identity scan options. Browser callers get an explicit
 * unsupported capability response; no browser upload fallback is attempted.
 */
export async function getIdentityScannerCapabilities(): Promise<IdentityScannerCapabilities> {
  if (!isTauriRuntime()) {
    return unsupportedIdentityScannerCapabilities();
  }
  try {
    return await invokeDesktop<IdentityScannerCapabilities>('get_identity_scanner_capabilities');
  } catch {
    return unsupportedIdentityScannerCapabilities();
  }
}

/** Acquires one identity side using the Windows WIA device chooser. */
export async function acquireIdentityScan(side: IdentityScanSide): Promise<IdentityScanResult> {
  await requireIdentityScannerCapabilities();
  try {
    return await invokeDesktop<IdentityScanResult>('acquire_identity_scan', { side });
  } catch (error) {
    throw identityScannerBridgeError(error);
  }
}

/** Opens the native Windows file chooser for a validated local image fallback. */
export async function pickIdentityScanFile(side: IdentityScanSide): Promise<IdentityScanResult> {
  await requireIdentityScannerCapabilities();
  try {
    return await invokeDesktop<IdentityScanResult>('pick_identity_scan_file', { side });
  } catch (error) {
    throw identityScannerBridgeError(error);
  }
}

/**
 * The desktop bridge stores no identity scans. This verifies/finishes the
 * native lifecycle without exposing any temporary file path to the frontend.
 */
export async function discardIdentityScan(): Promise<boolean> {
  await requireIdentityScannerCapabilities();
  try {
    return await invokeDesktop<boolean>('discard_identity_scan');
  } catch (error) {
    throw identityScannerBridgeError(error);
  }
}

export async function getDesktopMonitorSetup(): Promise<DesktopDisplayWindowState | null> {
  try {
    return await invokeDesktop<DesktopDisplayWindowState>('get_monitor_setup');
  } catch {
    return null;
  }
}

export async function ensureCustomerDisplayWindow(route: string): Promise<DesktopDisplayWindowState | null> {
  try {
    return await invokeDesktop<DesktopDisplayWindowState>('ensure_customer_display_window', {
      route,
    });
  } catch {
    return null;
  }
}

export async function setCustomerDisplayIdle(uiVariant?: 'classic' | 'modern'): Promise<DesktopDisplayWindowState | null> {
  try {
    return await invokeDesktop<DesktopDisplayWindowState>('close_or_idle_customer_display', {
      uiVariant: uiVariant || 'classic',
    });
  } catch {
    return null;
  }
}

export async function ensureDocumentPreviewWindow(route: string, title?: string): Promise<string | null> {
  try {
    return await invokeDesktop<string>('ensure_document_preview_window', {
      route,
      title: title || null,
    });
  } catch {
    return null;
  }
}

export async function getDesktopRuntimeInfo(): Promise<DesktopRuntimeInfo | null> {
  try {
    return await invokeDesktop<DesktopRuntimeInfo>('get_desktop_runtime_info');
  } catch {
    return null;
  }
}

export async function writeUiDiagnostic(payload: UiDiagnosticPayload): Promise<UiDiagnosticResult | null> {
  try {
    return await invokeDesktop<UiDiagnosticResult>('write_ui_diagnostic', { payload });
  } catch {
    return null;
  }
}

export async function persistPendingPurchaseDraft(
  input: Omit<PendingPurchaseDraft, 'createdAt' | 'updatedAt' | 'expiresAt'> & { createdAt?: string },
): Promise<boolean> {
  try {
    await invokeDesktop('persist_pending_purchase_draft', { input });
    return true;
  } catch {
    // No plaintext fallback: the caller keeps the draft in memory and shows
    // the desktop recovery warning if the OS credential vault is unavailable.
    return false;
  }
}

export async function listPendingPurchaseDrafts(ownerKey: string): Promise<PendingPurchaseDraft[]> {
  try {
    return await invokeDesktop<PendingPurchaseDraft[]>('list_pending_purchase_drafts', { ownerKey });
  } catch {
    return [];
  }
}

export async function deletePendingPurchaseDraft(ownerKey: string, sessionId: string): Promise<boolean> {
  try {
    await invokeDesktop('delete_pending_purchase_draft', { ownerKey, sessionId });
    return true;
  } catch {
    return false;
  }
}

export async function closeDocumentPreviewWindow(): Promise<boolean> {
  try {
    return await invokeDesktop<boolean>('close_document_preview_window');
  } catch {
    return false;
  }
}

export async function reopenDocumentPreviewWindow(route: string, title?: string): Promise<string | null> {
  try {
    return await invokeDesktop<string>('reopen_document_preview_window', {
      route,
      title: title || null,
    });
  } catch {
    return null;
  }
}

export async function pickDocumentImportFile(): Promise<PickedDocumentImportFile | null> {
  try {
    return await invokeDesktop<PickedDocumentImportFile>('pick_document_import_file');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Dosya seçilmedi')) {
      return null;
    }
    return null;
  }
}

export async function exportDocumentBytes(suggestedName: string, dataBase64: string): Promise<DocumentExportResult | null> {
  try {
    return await invokeDesktop<DocumentExportResult>('export_document_bytes', {
      suggestedName,
      dataBase64,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Kayıt konumu seçilmedi')) {
      return null;
    }
    throw error;
  }
}

export function normalizeDesktopDisplayRoute(route?: string | null) {
  const trimmed = route?.trim();
  if (!trimmed) return DISPLAY_IDLE_ROUTE;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function isDesktopDisplayRouteMatch(
  state: DesktopDisplayWindowState | null | undefined,
  expectedRoute?: string | null,
) {
  if (!state?.window_open || !expectedRoute) return false;
  return normalizeDesktopDisplayRoute(state.active_route) === normalizeDesktopDisplayRoute(expectedRoute);
}
