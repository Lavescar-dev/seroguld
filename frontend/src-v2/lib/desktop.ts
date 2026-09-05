import { isTauri as isTauriCore } from '@tauri-apps/api/core';

type TauriInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;

type TauriGlobal = typeof globalThis & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  isTauri?: boolean;
};

export type IdentityScanSide = 'front' | 'back';
export type IdentityScanSource = 'wia' | 'file' | 'watch';
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
  | 'WATCH_FOLDER_UNAVAILABLE'
  | 'WATCH_ALREADY_ACTIVE'
  | 'INTERNAL_ERROR';

export interface IdentityScannerCapabilities {
  supported: boolean;
  platform: IdentityScannerPlatform;
  wiaAcquisition: boolean;
  localOcr: boolean;
  imageFileFallback: boolean;
  /** İş 4: klasör izleme (scan-to-folder) hattı — WIA diyaloguna alternatif. */
  watchFolder: boolean;
  maxFileBytes: number;
  acceptedMimeTypes: IdentityScanMimeType[];
  ocrDanishAvailable: boolean;
  ocrProfileLanguage: string;
  ocrAvailableLanguages: string[];
}

export interface IdentityScanResult {
  side: IdentityScanSide;
  source: IdentityScanSource;
  mimeType: IdentityScanMimeType;
  previewDataUrl: string;
  ocrText: string;
  ocrLines: string[];
  // Saha teshisi: hangi dil paketi seçildi, görüntü ölçeklendi mi.
  ocrLanguage: string;
  ocrRequestedLanguage: string;
  ocrMaxImageDimension: number;
  imageScaled: boolean;
  imageSourceWidth: number;
  imageSourceHeight: number;
}

export interface IdentityScannerErrorPayload {
  code: IdentityScannerErrorCode;
  message: string;
  retryable: boolean;
}

/** `get_identity_watch_status` / `start_identity_watch` / `stop_identity_watch` yükü. */
export interface IdentityWatchStatus {
  active: boolean;
  folder: string | null;
  side: IdentityScanSide;
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

/** `check_desktop_update` ve `desktop-update-available` olayının paylaşılan yükü. */
export type DesktopUpdateInfo = {
  version: string;
  current_version: string;
  notes?: string | null;
};

/**
 * `install_desktop_update` ilerleme kanalı yükü. Rust tarafı ham updater
 * olayını (chunk/content) veya hazır yüzdeyi gönderebilir; ikisi de desteklenir.
 */
export type DesktopUpdateProgress = {
  chunk_length?: number | null;
  content_length?: number | null;
  downloaded?: number | null;
  total?: number | null;
  percent?: number | null;
  /** Rust tarafı updater olayını camelCase anahtarlarla da gönderebilir. */
  chunkLength?: number | null;
  contentLength?: number | null;
  event?: string | null;
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
  'WATCH_FOLDER_UNAVAILABLE',
  'WATCH_ALREADY_ACTIVE',
  'INTERNAL_ERROR',
];

function unsupportedIdentityScannerCapabilities(platform: IdentityScannerPlatform = 'unknown'): IdentityScannerCapabilities {
  return {
    supported: false,
    platform,
    wiaAcquisition: false,
    localOcr: false,
    imageFileFallback: false,
    watchFolder: false,
    maxFileBytes: 10 * 1024 * 1024,
    acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/tiff', 'image/bmp'],
    // Probe yok: sessiz geç (yanlış "Danca paketi yok" uyarısı olmasın).
    ocrDanishAvailable: true,
    ocrProfileLanguage: '',
    ocrAvailableLanguages: [],
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
// R2-03: sürükle-bırakla gelen görüntüyü (webview File → base64) OCR hattına verir.
export async function identityScanFromBytes(side: IdentityScanSide, dataBase64: string): Promise<IdentityScanResult> {
  await requireIdentityScannerCapabilities();
  try {
    return await invokeDesktop<IdentityScanResult>('identity_scan_from_bytes', { side, dataBase64 });
  } catch (error) {
    throw identityScannerBridgeError(error);
  }
}

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

/**
 * İş 4 — klasör izlemeyi başlatır (yalnız Windows; diğer platformlar
 * UNSUPPORTED_PLATFORM alır). `folder` verilmezse masaüstü tarafı
 * %USERPROFILE%\Pictures\SeroGuld-Scan varsayılanını kullanır. İzlenen
 * klasöre düşen görüntü `identity-watch-scan` olayıyla döner.
 */
export async function startIdentityWatch(
  side: IdentityScanSide,
  folder?: string | null,
): Promise<IdentityWatchStatus> {
  await requireIdentityScannerCapabilities();
  const normalizedFolder = typeof folder === 'string' && folder.trim() ? folder.trim() : null;
  try {
    return await invokeDesktop<IdentityWatchStatus>('start_identity_watch', {
      side,
      folder: normalizedFolder,
    });
  } catch (error) {
    throw identityScannerBridgeError(error);
  }
}

/**
 * Klasör izlemeyi durdurur. Windows dışında izleme hiç başlamamış olabileceği
 * için hata değil pasif durum döner (Rust tarafıyla aynı sözleşme).
 */
export async function stopIdentityWatch(): Promise<IdentityWatchStatus> {
  if (!isTauriRuntime()) return { active: false, folder: null, side: 'front' };
  try {
    return await invokeDesktop<IdentityWatchStatus>('stop_identity_watch');
  } catch (error) {
    throw identityScannerBridgeError(error);
  }
}

/**
 * M2: Rust tarafındaki kalıcı klasör izleme durumunu sorgular. Panel yeniden
 * mount edildiğinde (ya da uygulama yeniden başladığında) izleme hâlâ aktifse
 * UI 'Klasör izleme açık' rozetini ve Durdur yolunu gösterebilsin; aksi halde
 * WATCH_ALREADY_ACTIVE ile kullanıcı izlemeyi durduramadan kilitlenir.
 * Köprü yoksa/hata varsa null döner — çağıran sessizce atlayabilir.
 */
export async function getIdentityWatchStatus(): Promise<IdentityWatchStatus | null> {
  if (!isTauriRuntime()) return null;
  try {
    const status = await invokeDesktop<IdentityWatchStatus>('get_identity_watch_status');
    return status && typeof status === 'object' ? status : null;
  } catch {
    return null;
  }
}

/**
 * `identity-watch-scan` / `identity-watch-error` olaylarına abone olur.
 * Tarama yükü mevcut IdentityScanResult sözleşmesidir (yeni parse yok);
 * hata yükü IdentityScannerErrorPayload'dır.
 */
export async function onIdentityWatchScan(
  onScan: (result: IdentityScanResult) => void,
  onError?: (error: IdentityScannerErrorPayload) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  try {
    const module = await import('@tauri-apps/api/event');
    const unlistenScan = await module.listen<IdentityScanResult>(
      'identity-watch-scan',
      (event) => onScan(event.payload),
    );
    const unlistenError = onError
      ? await module.listen<IdentityScannerErrorPayload>('identity-watch-error', (event) =>
          onError?.(event.payload),
        )
      : null;
    return () => {
      void unlistenScan();
      if (unlistenError) void unlistenError();
    };
  } catch {
    return () => undefined;
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

/**
 * Harici http/https adresini açar. Paketli Tauri webview'inde `window.open`/
 * `<a target=_blank>` sessizce çalışmaz; bu durumda OS tarayıcısını açan Rust
 * komutuna (open_external_url) düşer. Tarayıcı (dev) ortamında window.open kullanır.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  const target = (url || '').trim();
  if (!target) return false;
  if (!isTauriRuntime()) {
    window.open(target, '_blank', 'noopener,noreferrer');
    return true;
  }
  try {
    await invokeDesktop('open_external_url', { url: target });
    return true;
  } catch {
    return false;
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

/**
 * Yayınlanmış masaüstü güncellemesini denetler. Güncelleme yoksa, tarayıcı
 * ortamındaysa ya da IPC hatası varsa null döner (çağıran sessiz kalabilir).
 */
export async function checkDesktopUpdate(): Promise<DesktopUpdateInfo | null> {
  if (!isTauriRuntime()) return null;
  try {
    const result = await invokeDesktop<DesktopUpdateInfo | null>('check_desktop_update');
    return result && typeof result === 'object' && typeof result.version === 'string' && result.version ? result : null;
  } catch {
    return null;
  }
}

/**
 * Güncellemeyi indirip kurar. Kurulum uygulamanın kapanmasıyla biter; bu
 * yüzden hata yutulmaz — çağıran kullanıcıya gösterebilsin diye fırlatılır.
 * `onProgress` opsiyoneldir; Rust tarafındaki `on_progress` kanalına bağlanır.
 */
export async function installDesktopUpdate(onProgress?: (progress: DesktopUpdateProgress) => void): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('Güncelleme yalnızca masaüstü uygulamasında kurulabilir.');
  }
  const { Channel } = await import('@tauri-apps/api/core');
  // Updater ham chunk uzunluğu gönderir; yüzdeyi burada biriktirerek hesaplarız.
  let downloaded = 0;
  let total: number | null = null;
  const channel = new Channel<DesktopUpdateProgress>((message) => {
    if (!onProgress || !message || typeof message !== 'object') return;
    const nextTotal = positiveNumber(message.content_length ?? message.contentLength ?? message.total);
    if (nextTotal) total = nextTotal;
    const chunk = positiveNumber(message.chunk_length ?? message.chunkLength);
    if (chunk) downloaded += chunk;
    const reached = positiveNumber(message.downloaded) ?? (downloaded || null);
    const percent =
      positiveNumber(message.percent) ??
      (total && reached !== null ? Math.min(100, (reached / total) * 100) : null);
    const finished = message.event === 'finished';
    onProgress({
      downloaded: reached,
      total,
      percent: finished ? 100 : percent === null ? null : Math.round(percent),
    });
  });
  // Tauri komut argümanları JS tarafında camelCase: Rust `on_progress` paramı.
  await invokeDesktop<void>('install_desktop_update', { onProgress: channel });
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Açılışta ana pencereye emit edilen `desktop-update-available` olayını dinler. */
export async function onDesktopUpdateAvailable(callback: (info: DesktopUpdateInfo) => void): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  try {
    const module = await import('@tauri-apps/api/event');
    const unlisten = await module.listen<DesktopUpdateInfo>('desktop-update-available', (event) => callback(event.payload));
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
