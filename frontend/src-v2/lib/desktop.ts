type TauriInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;

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
  return navigator.userAgent.includes('Tauri');
}

async function invokeDesktop<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = await getInvoke();
  if (!invoke) {
    throw new Error('Tauri runtime bulunamadı');
  }
  return invoke<T>(command, args);
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

export async function setCustomerDisplayIdle(): Promise<DesktopDisplayWindowState | null> {
  try {
    return await invokeDesktop<DesktopDisplayWindowState>('close_or_idle_customer_display');
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
