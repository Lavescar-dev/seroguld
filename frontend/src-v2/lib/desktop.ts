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
  monitors: Array<{
    id: string;
    name: string;
    width: number;
    height: number;
    x: number;
    y: number;
    scale_factor: number;
    primary: boolean;
    current: boolean;
    selected: boolean;
  }>;
  preferred_monitor_id: string | null;
  resolved_monitor_id: string | null;
  selection_source: 'saved' | 'automatic' | 'fallback' | 'unavailable';
  active_route: string;
  window_open: boolean;
  display_enabled: boolean;
  secondary_monitor?: {
    id: string;
    name: string;
    width: number;
    height: number;
    x: number;
    y: number;
    scale_factor: number;
    primary: boolean;
    current: boolean;
    selected: boolean;
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

export type DesktopOfficeRuntimeState = {
  status: string;
  message: string;
  detail?: string | null;
  runtimeUrl: string;
  diskFreeBytes?: number | null;
  retryable: boolean;
};

export type DesktopStartupState = {
  app_version?: string | null;
  state: string;
  message: string;
  runtime_path?: string | null;
  health_url?: string | null;
  logs_dir?: string | null;
  backend_pid?: number | null;
  excel_bridge_running?: boolean;
  excel_close_failed?: boolean;
  excel_close_error?: string | null;
};

export type ExcelAvailability = {
  available: boolean;
  executable?: string | null;
  reason?: string | null;
  // IPC hatası 'Excel yok' ile aynı şey değildir; ayrık işaretlenir.
  ipc_error?: boolean;
};

export type ExcelComProbeResult = {
  available: boolean;
  version?: string | null;
  error?: string | null;
  confidence: string;
};

export type ExcelBridgeRequest = {
  workbook_path: string;
  sync_url: string;
  close_url?: string | null;
  session_token: string;
  base_revision: number;
  can_write: boolean;
};

export type ExcelBridgeStatus = {
  running: boolean;
  pid?: number | null;
  message?: string | null;
};

/** Stable Credential Manager target prefix shared by the frontend and Tauri. */
export const LOGIN_CREDENTIAL_TARGET_PREFIX = 'dk.seroguld.crm/login/';
export const LOGIN_CREDENTIAL_SERVICE = 'dk.seroguld.crm/login';

export type DocumentExportResult = {
  path: string;
  mode: 'save-dialog' | 'downloads-fallback' | string;
};

export type BackupScheduleFrequency = 'off' | 'daily' | 'weekly';

export type BackupNativeConfig = {
  destinationDir: string | null;
  destinationConfigured: boolean;
  destinationAvailable: boolean;
  recoveryKeyReady: boolean;
  recoveryKeyExported: boolean;
  scheduleFrequency: BackupScheduleFrequency;
  scheduleHour: number | null;
  scheduleWeekday: number | null;
};

export type BackupPublishResult = {
  localPath: string;
  offsitePath: string | null;
  offsiteStatus: 'synced' | 'pending' | 'not-configured' | string;
  sizeBytes: number;
  verified: boolean;
};

export type BackupRestoreCandidate = {
  encryptedPath: string;
  snapshotPath: string;
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

export async function setCustomerDisplayMonitor(
  monitorId: string,
  route?: string | null,
): Promise<DesktopDisplayWindowState | null> {
  try {
    return await invokeDesktop<DesktopDisplayWindowState>('set_customer_display_monitor', {
      monitorId,
      route: route || null,
    });
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

export async function openCustomerDisplayWindow(route: string): Promise<DesktopDisplayWindowState | null> {
  try {
    return await invokeDesktop<DesktopDisplayWindowState>('open_customer_display_window', { route });
  } catch {
    return null;
  }
}

export async function closeCustomerDisplayWindow(
  uiVariant?: 'classic' | 'modern',
): Promise<DesktopDisplayWindowState | null> {
  try {
    return await invokeDesktop<DesktopDisplayWindowState>('close_customer_display_window', {
      uiVariant: uiVariant || 'classic',
    });
  } catch {
    return null;
  }
}

export async function setCustomerDisplayIdle(uiVariant?: 'classic' | 'modern', locale?: 'tr' | 'en' | 'da'): Promise<DesktopDisplayWindowState | null> {
  try {
    return await invokeDesktop<DesktopDisplayWindowState>('close_or_idle_customer_display', {
      uiVariant: uiVariant || 'classic',
      route: locale ? `/display/idle?ui=${uiVariant || 'classic'}&lang=${locale}` : null,
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

/** Read a remembered password from the native credential manager only. */
export async function getStoredLoginPassword(email: string): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !isTauriRuntime()) return null;
  const value = await invokeDesktop<unknown>('keyring_get', { email: normalizedEmail });
  if (typeof value === 'string') return value || null;
  if (value && typeof value === 'object' && 'password' in value) {
    const password = (value as { password?: unknown }).password;
    return typeof password === 'string' && password ? password : null;
  }
  return null;
}

/** Native bootstrap secret is available only while bootstrap is pending. */
export async function getBootstrapLoginPassword(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const value = await invokeDesktop<unknown>('get_bootstrap_login_password');
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

export async function saveStoredLoginPassword(email: string, password: string): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password || !isTauriRuntime()) return false;
  try {
    await invokeDesktop('keyring_set', { email: normalizedEmail, password });
    return true;
  } catch {
    return false;
  }
}

export async function deleteStoredLoginPassword(email: string): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !isTauriRuntime()) return false;
  try {
    await invokeDesktop('keyring_delete', { email: normalizedEmail });
    return true;
  } catch {
    return false;
  }
}

export async function getBackupNativeConfig(): Promise<BackupNativeConfig | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invokeDesktop<BackupNativeConfig>('get_backup_native_config');
  } catch {
    return null;
  }
}

export async function chooseBackupDestination(): Promise<BackupNativeConfig> {
  return invokeDesktop<BackupNativeConfig>('choose_backup_destination');
}

export async function setBackupSchedule(
  frequency: BackupScheduleFrequency,
  hour: number | null,
  weekday: number | null,
): Promise<BackupNativeConfig> {
  return invokeDesktop<BackupNativeConfig>('set_backup_schedule', { frequency, hour, weekday });
}

export async function openBackupDestination(): Promise<string> {
  return invokeDesktop<string>('open_backup_destination');
}

export async function exportBackupRecoveryKey(): Promise<string> {
  return invokeDesktop<string>('export_backup_recovery_key');
}

export async function importBackupRecoveryKey(recoveryKey: string): Promise<void> {
  await invokeDesktop('import_backup_recovery_key', { recoveryKey });
}

export async function encryptBackupSnapshot(snapshotPath: string): Promise<BackupPublishResult> {
  return invokeDesktop<BackupPublishResult>('encrypt_backup_snapshot', { snapshotPath });
}

export async function pickBackupForRestore(): Promise<string> {
  return invokeDesktop<string>('pick_backup_for_restore');
}

export async function decryptBackupForRestore(encryptedPath: string): Promise<BackupRestoreCandidate> {
  return invokeDesktop<BackupRestoreCandidate>('decrypt_backup_for_restore', { encryptedPath });
}

export async function getDesktopStartupState(): Promise<DesktopStartupState | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invokeDesktop<DesktopStartupState>('get_desktop_startup_state');
  } catch {
    return null;
  }
}

export async function consumeDesktopCloseRequest(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    return await invokeDesktop<boolean>('consume_desktop_close_request');
  } catch {
    return false;
  }
}

export async function retryDesktopStartup(): Promise<DesktopStartupState | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invokeDesktop<DesktopStartupState>('retry_desktop_startup');
  } catch {
    return null;
  }
}

export async function closeManagedExcelSession(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const result = await invokeDesktop<unknown>('close_managed_excel_session');
    if (typeof result === 'boolean') return result;
    if (result && typeof result === 'object' && 'closed' in result) {
      return Boolean((result as { closed?: unknown }).closed);
    }
    return true;
  } catch {
    return false;
  }
}

export async function discardManagedExcelSession(): Promise<boolean> {
  if (!isTauriRuntime()) return true;
  try {
    const result = await invokeDesktop<unknown>('discard_managed_excel_session');
    if (typeof result === 'boolean') return result;
    if (result && typeof result === 'object' && 'closed' in result) {
      return Boolean((result as { closed?: unknown }).closed);
    }
    return Boolean(result);
  } catch {
    return false;
  }
}

export async function showManagedExcelSession(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const result = await invokeDesktop<ExcelBridgeStatus>('show_managed_excel_session');
    return Boolean(result?.running);
  } catch {
    return false;
  }
}

export async function focusManagedExcelSession(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const result = await invokeDesktop<unknown>('focus_managed_excel_session');
    if (typeof result === 'boolean') return result;
    if (result && typeof result === 'object' && 'focused' in result) {
      return Boolean((result as { focused?: unknown }).focused);
    }
    return Boolean(result);
  } catch {
    return false;
  }
}

export async function getExcelAvailability(): Promise<ExcelAvailability | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invokeDesktop<ExcelAvailability>('get_excel_availability');
  } catch {
    // IPC hatasını 'kurulu değil' sanma: çağıran ayrık ele alabilsin.
    return { available: false, reason: 'ipc-error', ipc_error: true };
  }
}

export async function probeExcelComAvailability(force = false): Promise<ExcelComProbeResult | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invokeDesktop<ExcelComProbeResult>('probe_excel_com_availability', { force });
  } catch (error) {
    return {
      available: false,
      version: null,
      error: error instanceof Error ? error.message : String(error),
      confidence: 'ipc-error',
    };
  }
}

export async function launchExcelBridge(request: ExcelBridgeRequest): Promise<ExcelBridgeStatus | null> {
  if (!isTauriRuntime()) return null;
  // Native başlatma hatası yutulmaz: gerçek neden (Excel yok, çalışma
  // kopyası açılamadı, köprü süreci düşmedi) kullanıcıya gösterilecek.
  return await invokeDesktop<ExcelBridgeStatus>('launch_excel_bridge', { request });
}

export async function confirmDesktopClose(discardChanges: boolean): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    // Tauri command arguments are camelCase on the JS side.
    return await invokeDesktop<boolean>('confirm_desktop_close', { discardChanges });
  } catch {
    return false;
  }
}

export async function openRuntimeDiagnostics(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invokeDesktop<string>('open_runtime_diagnostics');
  } catch {
    return null;
  }
}

export async function listenDesktopCloseRequest(listener: (state: DesktopStartupState) => void): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  try {
    const module = await import('@tauri-apps/api/event');
    const unlisten = await module.listen<DesktopStartupState>('desktop-close-confirmation', (event) => listener(event.payload));
    return unlisten;
  } catch {
    return () => undefined;
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
