import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { ApiError, apiRequest, downloadAuthedDocument } from '@/lib/api';
import { emitArtifactSync, listenArtifactSync } from '@/lib/artifactSync';
import {
  exportDocumentBytes,
  getDesktopRuntimeInfo,
  isTauriRuntime,
  pickDocumentImportFile,
  reopenDocumentPreviewWindow,
  type DesktopRuntimeInfo,
} from '@/lib/desktop';
import { getFrontendRuntimeInfo } from '@/lib/runtimeInfo';
import type {
  DocumentArtifactReconcilePreview,
  OfficeDocumentLaunch,
  OfficeDocumentStatus,
  OfficeRuntimeStatus,
  RuntimeStatus,
} from '@/types';

import type { OfficeDocumentPageProps } from './OfficeDocumentPage';

type UseOfficeDocumentStateOptions = {
  kind?: string;
  artifactKey?: string;
  disableReopen?: boolean;
  enabled?: boolean;
};

type OfficeForceSaveResult = {
  accepted: boolean;
  state: string;
  detail?: string | null;
  save_id?: number | null;
};

const LIVE_PREVIEW_DEBOUNCE_MS = 1200;

function fileFromPickedImport(fileName: string, dataBase64: string): File {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, {
    type: fileName.toLowerCase().endsWith('.xlsm')
      ? 'application/vnd.ms-excel.sheet.macroEnabled.12'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function importEndpointFor(kind: string, artifactKey: string) {
  if (kind === 'alis-workspace') {
    return `/api/v2/alis/workspace/${artifactKey}/artifact/import`;
  }
  if (kind === 'depolama') {
    return '/api/v2/depolama/workbook/import';
  }
  if (kind === 'log') {
    return `/api/v2/log/workbook/import?year=${encodeURIComponent(artifactKey)}`;
  }
  throw new Error('Bu belge için içe aktarma desteklenmiyor.');
}

function importPreviewEndpointFor(kind: string, artifactKey: string) {
  if (kind === 'alis-workspace') {
    return `/api/v2/alis/workspace/${artifactKey}/artifact/reconcile-preview`;
  }
  if (kind === 'depolama') {
    return '/api/v2/depolama/workbook/reconcile-preview';
  }
  return null;
}

function reconcileApplyEndpointFor(kind: string, artifactKey: string) {
  if (kind === 'alis-workspace') {
    return `/api/v2/alis/workspace/${artifactKey}/artifact/reconcile-apply?allow_full_clear=true`;
  }
  return null;
}

export function useOfficeDocumentState(options?: UseOfficeDocumentStateOptions): OfficeDocumentPageProps {
  const params = useParams<{ kind: string; key: string }>();
  const kind = options?.kind || params.kind || '';
  const artifactKey = options?.artifactKey || params.key || '';
  const officeEnabled = (options?.enabled ?? true) && Boolean(kind && artifactKey);
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [lastImportError, setLastImportError] = useState<string | null>(null);
  const [lastExportNotice, setLastExportNotice] = useState<string | null>(null);
  const [lastExportError, setLastExportError] = useState<string | null>(null);
  const [lastEditorError, setLastEditorError] = useState<string | null>(null);
  const [hasExternalUpdate, setHasExternalUpdate] = useState(false);
  const [importReconcilePreview, setImportReconcilePreview] = useState<DocumentArtifactReconcilePreview | null>(null);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [desktopRuntime, setDesktopRuntime] = useState<DesktopRuntimeInfo | null>(null);
  const lastArtifactUpdatedAtRef = useRef<string | null>(null);
  const iframeTimeoutRef = useRef<number | null>(null);
  const launchMeasureStartedAtRef = useRef<number | null>(null);
  const sessionRefreshStartedAtRef = useRef<number | null>(null);
  const iframeMeasureStartedAtRef = useRef<number | null>(null);
  const [isIframeLoading, setIsIframeLoading] = useState(false);
  const [hasIframeLoadTimedOut, setHasIframeLoadTimedOut] = useState(false);
  const [launchRequestMs, setLaunchRequestMs] = useState<number | null>(null);
  const [iframeLoadMs, setIframeLoadMs] = useState<number | null>(null);
  const [sessionRefreshMs, setSessionRefreshMs] = useState<number | null>(null);
  const [lastKnownGoodLaunch, setLastKnownGoodLaunch] = useState<OfficeDocumentLaunch | null>(null);
  const [isLivePreviewDirty, setIsLivePreviewDirty] = useState(false);
  const [isLivePreviewSyncing, setIsLivePreviewSyncing] = useState(false);
  const [lastLivePreviewError, setLastLivePreviewError] = useState<string | null>(null);
  const launchAutoHealAttemptedRef = useRef(false);
  const externalRefreshTimeoutRef = useRef<number | null>(null);
  const forceSavePromiseRef = useRef<Promise<OfficeForceSaveResult> | null>(null);

  const launchQuery = useQuery({
    queryKey: ['office-document-launch', kind, artifactKey, reloadNonce],
    enabled: officeEnabled,
    queryFn: () => apiRequest<OfficeDocumentLaunch>(`/api/v2/office-documents/${kind}/${artifactKey}/launch`),
    staleTime: 0,
    refetchOnMount: 'always',
    retry: (failureCount, error) => {
      const status = error instanceof ApiError ? error.status : 0;
      return failureCount < 2 && (status === 0 || status === 502 || status === 503 || status === 504);
    },
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const launchAccessToken = launchQuery.data?.access_token || lastKnownGoodLaunch?.access_token || null;
  const statusQuery = useQuery({
    queryKey: ['office-document-status', kind, artifactKey, launchAccessToken],
    enabled: officeEnabled,
    queryFn: () =>
      apiRequest<OfficeDocumentStatus>(
        `/api/v2/office-documents/${kind}/${artifactKey}/status${launchAccessToken ? `?access_token=${encodeURIComponent(launchAccessToken)}` : ''}`,
      ),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const runtimeStatusQuery = useQuery({
    queryKey: ['office-runtime-status', kind],
    enabled: officeEnabled,
    queryFn: () => apiRequest<OfficeRuntimeStatus>(`/api/v2/office-runtime/status?kind=${encodeURIComponent(kind)}`),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const appRuntimeQuery = useQuery({
    queryKey: ['runtime-status'],
    enabled: officeEnabled,
    queryFn: () => apiRequest<RuntimeStatus>('/api/v2/runtime/status'),
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('workbook', file);
      return apiRequest(reconcileApplyEndpointFor(kind, artifactKey) || importEndpointFor(kind, artifactKey), {
        method: 'POST',
        body: formData,
      });
    },
    onSuccess: async () => {
      setLastImportError(null);
      setHasExternalUpdate(false);
      setImportReconcilePreview(null);
      setPendingImportFile(null);
      emitArtifactSync({
        kind,
        key: artifactKey,
        source: 'office-document',
      });
      setReloadNonce((current) => current + 1);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['office-document-launch', kind, artifactKey] }),
        queryClient.invalidateQueries({ queryKey: ['office-document-status', kind, artifactKey] }),
        queryClient.invalidateQueries({ queryKey: ['office-runtime-status', kind] }),
        queryClient.invalidateQueries({ queryKey: ['excel-preview', kind, artifactKey] }),
      ]);
    },
    onError: (error) => {
      setLastImportError(error instanceof Error ? error.message : 'İçe aktarma başarısız oldu.');
    },
  });

  const importPreviewMutation = useMutation({
    mutationFn: async (file: File) => {
      const endpoint = importPreviewEndpointFor(kind, artifactKey);
      if (!endpoint) {
        return null;
      }
      const formData = new FormData();
      formData.append('workbook', file);
      return apiRequest<DocumentArtifactReconcilePreview>(endpoint, {
        method: 'POST',
        body: formData,
      });
    },
    onSuccess: (data, file) => {
      if (!data) {
        importMutation.mutate(file);
        return;
      }
      setLastImportError(null);
      setPendingImportFile(file);
      setImportReconcilePreview(data);
    },
    onError: (error) => {
      setLastImportError(error instanceof Error ? error.message : 'İçe aktarma önizlemesi hazırlanamadı.');
    },
  });

  const forceSaveMutation = useMutation({
    mutationFn: async () => {
      if (!launch?.access_token) {
        throw new Error('ONLYOFFICE session bulunamadı.');
      }
      return apiRequest<OfficeForceSaveResult>(`/api/v2/office/onlyoffice/forcesave/${launch.access_token}`, {
        method: 'POST',
      });
    },
    onSuccess: (result) => {
      if (!result.accepted) {
        setIsLivePreviewSyncing(false);
        setLastLivePreviewError(result.detail || 'Canlı önizleme senkronu reddedildi.');
        return;
      }
      setLastLivePreviewError(null);
      if (result.state === 'noop') {
        setIsLivePreviewSyncing(false);
        return;
      }
      setIsLivePreviewDirty(false);
      setIsLivePreviewSyncing(true);
      void statusQuery.refetch();
    },
    onError: (error) => {
      setIsLivePreviewSyncing(false);
      setLastLivePreviewError(error instanceof Error ? error.message : 'Canlı önizleme senkronu başarısız oldu.');
    },
  });

  function runForceSave() {
    if (forceSavePromiseRef.current) return forceSavePromiseRef.current;
    const promise = forceSaveMutation.mutateAsync();
    forceSavePromiseRef.current = promise;
    const clear = () => {
      if (forceSavePromiseRef.current === promise) forceSavePromiseRef.current = null;
    };
    promise.then(clear, clear);
    return promise;
  }

  async function flushBeforeClose(): Promise<boolean> {
    if (!officeEnabled || !canUseLivePreviewSync) return true;
    if (!isLivePreviewDirty && !isLivePreviewSyncing) return true;
    try {
      const result = await runForceSave();
      if (!result.accepted) return false;
      if (result.state === 'noop') return true;
      setIsLivePreviewSyncing(true);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const refreshed = await statusQuery.refetch();
        const nextState = refreshed.data?.live_sync_state;
        const appliedSaveId = refreshed.data?.last_applied_save_id || 0;
        if (nextState === 'applied' && (!result.save_id || appliedSaveId >= result.save_id)) {
          setIsLivePreviewDirty(false);
          setIsLivePreviewSyncing(false);
          return true;
        }
        if (nextState === 'rejected' || nextState === 'error') {
          setIsLivePreviewSyncing(false);
          setLastLivePreviewError(refreshed.data?.live_sync_message || 'Office kaydı reddedildi.');
          return false;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      setIsLivePreviewSyncing(false);
      setLastLivePreviewError('Office kaydı henüz backend tarafından kabul edilmedi.');
      return false;
    } catch (error) {
      setIsLivePreviewSyncing(false);
      setLastLivePreviewError(error instanceof Error ? error.message : 'Office kaydı başarısız oldu.');
      return false;
    }
  }

  const launch = officeEnabled ? launchQuery.data || lastKnownGoodLaunch || null : null;
  const status = statusQuery.data || null;
  const runtimeStatus = runtimeStatusQuery.data || null;
  const appRuntimeStatus = appRuntimeQuery.data || null;
  const launchError = launchQuery.error instanceof ApiError
    ? { status: launchQuery.error.status, message: launchQuery.error.message }
    : launchQuery.error instanceof Error
      ? { message: launchQuery.error.message }
      : null;
  const frontendRuntime = getFrontendRuntimeInfo();
  const iframeName = useMemo(
    () => `office-document-${kind || 'artifact'}-${artifactKey || 'preview'}`,
    [artifactKey, kind],
  );
  const canReopenWindow = !options?.disableReopen && isTauriRuntime();
  const isSessionStale = Boolean(status?.artifact?.updated_at && launch?.artifact?.updated_at && status.artifact.updated_at !== launch.artifact.updated_at);
  const canUseLivePreviewSync =
    officeEnabled &&
    kind === 'alis-workspace' &&
    launch?.provider === 'onlyoffice' &&
    launch?.launch_mode === 'onlyoffice-docs-api' &&
    Boolean(launch?.can_write) &&
    Boolean(launch?.access_token);
  const runtimeWarnings: string[] = [];

  if (isTauriRuntime() && !appRuntimeStatus?.desktop_session) {
    runtimeWarnings.push('Bu office yüzeyi kanonik desktop-dev oturumu olmadan çalışıyor olabilir.');
  }
  if (appRuntimeStatus?.desktop_session && appRuntimeStatus.desktop_session.frontend_mode !== frontendRuntime.frontend_mode) {
    runtimeWarnings.push('Office yüzeyindeki frontend modu session kaydıyla uyuşmuyor; görülen ekran beklediğin build olmayabilir.');
  }
  if (desktopRuntime?.runtime_mode === 'tauri-dev-url' && frontendRuntime.frontend_mode !== 'vite-dev') {
    runtimeWarnings.push('Tauri dev URL açık ama frontend Vite dev görünmüyor.');
  }

  const refreshStatusNow = () => {
    if (!officeEnabled) return;
    setHasExternalUpdate(false);
    setLastEditorError(null);
    setLastLivePreviewError(null);
    setIsLivePreviewSyncing(false);
    void Promise.all([statusQuery.refetch(), runtimeStatusQuery.refetch(), appRuntimeQuery.refetch()]);
    if (isTauriRuntime()) {
      void getDesktopRuntimeInfo().then((info) => setDesktopRuntime(info));
    }
  };

  const refreshSessionNow = () => {
    if (!officeEnabled) return;
    if (externalRefreshTimeoutRef.current) {
      window.clearTimeout(externalRefreshTimeoutRef.current);
      externalRefreshTimeoutRef.current = null;
    }
    setHasExternalUpdate(false);
    setLastEditorError(null);
    setLastLivePreviewError(null);
    setIsLivePreviewSyncing(false);
    sessionRefreshStartedAtRef.current = performance.now();
    setReloadNonce((current) => current + 1);
    void Promise.all([statusQuery.refetch(), runtimeStatusQuery.refetch(), appRuntimeQuery.refetch()]);
    if (isTauriRuntime()) {
      void getDesktopRuntimeInfo().then((info) => setDesktopRuntime(info));
    }
  };

  useEffect(() => {
    setHasExternalUpdate(false);
    setImportReconcilePreview(null);
    setPendingImportFile(null);
    lastArtifactUpdatedAtRef.current = null;
    setLastEditorError(null);
    setLastExportNotice(null);
    setLastExportError(null);
      setIsIframeLoading(false);
      setHasIframeLoadTimedOut(false);
      setLaunchRequestMs(null);
      setIframeLoadMs(null);
      setSessionRefreshMs(null);
      setLastKnownGoodLaunch(null);
      setIsLivePreviewDirty(false);
      setIsLivePreviewSyncing(false);
      setLastLivePreviewError(null);
      launchMeasureStartedAtRef.current = null;
      sessionRefreshStartedAtRef.current = null;
      iframeMeasureStartedAtRef.current = null;
      launchAutoHealAttemptedRef.current = false;
      if (externalRefreshTimeoutRef.current) {
        window.clearTimeout(externalRefreshTimeoutRef.current);
        externalRefreshTimeoutRef.current = null;
      }
  }, [artifactKey, kind, officeEnabled]);

  useEffect(() => {
    if (!officeEnabled) {
      setLastKnownGoodLaunch(null);
      setIsLivePreviewDirty(false);
      setIsLivePreviewSyncing(false);
      if (externalRefreshTimeoutRef.current) {
        window.clearTimeout(externalRefreshTimeoutRef.current);
        externalRefreshTimeoutRef.current = null;
      }
      return;
    }
    if (!launchQuery.data) return;
    setLastKnownGoodLaunch(launchQuery.data);
  }, [launchQuery.data, officeEnabled]);

  useEffect(() => {
    if (!officeEnabled) {
      setDesktopRuntime(null);
      return;
    }
    if (!isTauriRuntime()) {
      setDesktopRuntime(null);
      return;
    }
    void getDesktopRuntimeInfo().then((info) => setDesktopRuntime(info));
  }, [artifactKey, kind, officeEnabled]);

  useEffect(() => {
    if (!officeEnabled) return;
    if (iframeTimeoutRef.current) {
      window.clearTimeout(iframeTimeoutRef.current);
      iframeTimeoutRef.current = null;
    }
    if (!launch?.office_available) return;
    setLastEditorError(null);
    setIsIframeLoading(true);
    setHasIframeLoadTimedOut(false);
    iframeMeasureStartedAtRef.current = performance.now();
    if (launch.launch_mode !== 'onlyoffice-docs-api') {
      if (!launch.editor_url || !launch.access_token) return;
      formRef.current?.submit();
    }
    iframeTimeoutRef.current = window.setTimeout(() => {
      setHasIframeLoadTimedOut(true);
      setIsIframeLoading(false);
      iframeMeasureStartedAtRef.current = null;
    }, 10_000);
  }, [iframeName, launch?.access_token, launch?.editor_url, launch?.launch_mode, launch?.office_available, officeEnabled, reloadNonce]);

  useEffect(() => {
    if (launchQuery.fetchStatus === 'fetching') {
      if (launchMeasureStartedAtRef.current == null) {
        launchMeasureStartedAtRef.current = performance.now();
      }
      return;
    }
    if (launchMeasureStartedAtRef.current == null) return;
    const duration = Math.round(performance.now() - launchMeasureStartedAtRef.current);
    launchMeasureStartedAtRef.current = null;
    if (sessionRefreshStartedAtRef.current != null) {
      setSessionRefreshMs(duration);
      sessionRefreshStartedAtRef.current = null;
      return;
    }
    setLaunchRequestMs(duration);
  }, [launchQuery.fetchStatus]);

  useEffect(() => {
    return () => {
      if (iframeTimeoutRef.current) {
        window.clearTimeout(iframeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!officeEnabled) return;
    const nextUpdatedAt = status?.artifact?.updated_at || launch?.artifact?.updated_at || null;
    const previousUpdatedAt = lastArtifactUpdatedAtRef.current;
    lastArtifactUpdatedAtRef.current = nextUpdatedAt;
    if (!nextUpdatedAt || !previousUpdatedAt || nextUpdatedAt === previousUpdatedAt) {
      return;
    }
    emitArtifactSync({
      kind,
      key: artifactKey,
      source: 'office-document',
      artifact_updated_at: nextUpdatedAt,
    });
    setIsLivePreviewSyncing(false);
    setLastLivePreviewError(null);
  }, [artifactKey, kind, launch?.artifact?.updated_at, officeEnabled, status?.artifact?.updated_at]);

  useEffect(() => {
    if (!canUseLivePreviewSync) return;
    if (status?.live_sync_state === 'syncing') {
      setIsLivePreviewSyncing(true);
      setLastLivePreviewError(null);
      return;
    }
    if (status?.live_sync_state === 'applied') {
      setIsLivePreviewSyncing(false);
      setIsLivePreviewDirty(false);
      setLastLivePreviewError(null);
      return;
    }
    if (status?.live_sync_state === 'rejected' || status?.live_sync_state === 'error') {
      setIsLivePreviewSyncing(false);
      setIsLivePreviewDirty(false);
      setLastLivePreviewError(status.live_sync_message || 'Canlı önizleme senkronu başarısız oldu.');
      return;
    }
    if (status?.live_sync_state === 'idle') {
      setIsLivePreviewSyncing(false);
    }
  }, [canUseLivePreviewSync, status?.live_sync_message, status?.live_sync_state]);

  useEffect(() => {
    if (!officeEnabled) return;
    return listenArtifactSync((signal) => {
      if (signal.kind !== kind || signal.key !== artifactKey) return;
      if (signal.source === 'office-document') return;
      if (kind === 'alis-workspace' && !isLivePreviewDirty && !isLivePreviewSyncing) {
        setHasExternalUpdate(false);
        if (externalRefreshTimeoutRef.current) {
          window.clearTimeout(externalRefreshTimeoutRef.current);
        }
        externalRefreshTimeoutRef.current = window.setTimeout(() => {
          refreshSessionNow();
        }, 350);
        return;
      }
      setHasExternalUpdate(true);
      void statusQuery.refetch();
    });
  }, [artifactKey, kind, isLivePreviewDirty, isLivePreviewSyncing, officeEnabled, refreshSessionNow, statusQuery]);

  useEffect(() => {
    if (!officeEnabled || !canUseLivePreviewSync || !isLivePreviewDirty) return;
    if (forceSaveMutation.isPending || isLivePreviewSyncing) return;

    const timeoutId = window.setTimeout(() => {
      void runForceSave();
    }, LIVE_PREVIEW_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [canUseLivePreviewSync, forceSaveMutation.isPending, isLivePreviewDirty, isLivePreviewSyncing, officeEnabled]);

  useEffect(() => {
    if (!officeEnabled || !canUseLivePreviewSync || !isLivePreviewSyncing) return;
    const intervalId = window.setInterval(() => {
      void statusQuery.refetch();
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [canUseLivePreviewSync, isLivePreviewSyncing, officeEnabled, statusQuery]);

  useEffect(() => {
    if (!officeEnabled) return;
    if (!launchQuery.isError) {
      launchAutoHealAttemptedRef.current = false;
      return;
    }
    if (launchAutoHealAttemptedRef.current) return;
    if (!statusQuery.data?.artifact) return;
    if (!runtimeStatusQuery.data?.runtime_available) return;

    launchAutoHealAttemptedRef.current = true;
    const timeoutId = window.setTimeout(() => {
      setLastEditorError(null);
      sessionRefreshStartedAtRef.current = performance.now();
      setReloadNonce((current) => current + 1);
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [launchQuery.isError, officeEnabled, runtimeStatusQuery.data?.runtime_available, statusQuery.data?.artifact]);

  return {
    kind,
    artifactKey,
    launch,
    status,
    runtimeStatus,
    iframeName,
    formRef,
    useNativeImportDialog: isTauriRuntime(),
    appRuntimeStatus,
    desktopRuntime,
    frontendRuntime,
    runtimeWarnings,
    isLoading: launchQuery.isLoading,
    isError: launchQuery.isError && !launch,
    launchError,
    isImporting: importMutation.isPending,
    isStatusRefreshing: statusQuery.isFetching,
    isSessionRefreshing: launchQuery.isFetching,
    isIframeLoading,
    hasIframeLoadTimedOut,
    launchRequestMs,
    iframeLoadMs,
    sessionRefreshMs,
    isSessionStale,
    canReopenWindow,
    hasExternalUpdate,
    lastImportError,
    lastExportNotice,
    lastExportError,
    lastEditorError,
    importReconcilePreview,
    pendingImportFileName: pendingImportFile?.name || null,
    isPreviewingImport: importPreviewMutation.isPending,
    isLivePreviewDirty,
    isLivePreviewSyncing,
    lastLivePreviewError,
    onRetryLivePreviewSync: () => {
      if (!canUseLivePreviewSync || forceSaveMutation.isPending || isLivePreviewSyncing) return;
      setLastLivePreviewError(null);
      setIsLivePreviewDirty(true);
      void statusQuery.refetch();
    },
    onBeforeClose: flushBeforeClose,
    onExport: async () => {
      if (!launch) return;
      const fileName = launch.artifact?.file_name || `${kind}-${artifactKey}.xlsx`;
      setLastExportNotice(null);
      setLastExportError(null);
      try {
        if (desktopRuntime || isTauriRuntime()) {
          const blob = await apiRequest<Blob>(launch.download_path);
          const base64 = await blobToBase64(blob);
          const exportResult = await exportDocumentBytes(fileName, base64);
          if (exportResult !== null) {
            setLastExportNotice(
              exportResult.mode === 'downloads-fallback'
                ? `Kaydet penceresi acilmadi; dosya Downloads klasorune yazildi: ${exportResult.path}`
                : `Dosya kaydedildi: ${exportResult.path}`,
            );
            return;
          }
          return;
        }
        await downloadAuthedDocument(launch.download_path, fileName);
        setLastExportNotice('İndirme başlatıldı.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Dışa aktarma başarısız oldu.';
        if (message.includes('Tauri runtime bulunamadı')) {
          try {
            await downloadAuthedDocument(launch.download_path, fileName);
            setLastExportNotice('İndirme başlatıldı.');
            return;
          } catch (fallbackError) {
            setLastExportError(fallbackError instanceof Error ? fallbackError.message : 'Dışa aktarma başarısız oldu.');
            return;
          }
        }
        setLastExportError(message);
      }
    },
    onImportFromDialog: async () => {
      const picked = await pickDocumentImportFile();
      if (!picked) return;
      const file = fileFromPickedImport(picked.file_name, picked.data_base64);
      if (importPreviewEndpointFor(kind, artifactKey)) {
        importPreviewMutation.mutate(file);
        return;
      }
      importMutation.mutate(file);
    },
    onImportFile: (file) => {
      if (importPreviewEndpointFor(kind, artifactKey)) {
        importPreviewMutation.mutate(file);
        return;
      }
      importMutation.mutate(file);
    },
    onApplyImportPreview: () => {
      if (!pendingImportFile || importMutation.isPending) return;
      importMutation.mutate(pendingImportFile);
    },
    onCancelImportPreview: () => {
      setImportReconcilePreview(null);
      setPendingImportFile(null);
      setLastImportError(null);
    },
    onRefreshStatus: () => {
      refreshStatusNow();
    },
    onRefreshSession: () => {
      refreshSessionNow();
    },
    onReopenWindow: async () => {
      if (!canReopenWindow || !launch) return;
      await reopenDocumentPreviewWindow(`/office-document/${kind}/${artifactKey}`, launch.title);
    },
    onIframeLoad: () => {
      if (iframeTimeoutRef.current) {
        window.clearTimeout(iframeTimeoutRef.current);
        iframeTimeoutRef.current = null;
      }
      if (iframeMeasureStartedAtRef.current != null) {
        setIframeLoadMs(Math.round(performance.now() - iframeMeasureStartedAtRef.current));
        iframeMeasureStartedAtRef.current = null;
      }
      setIsIframeLoading(false);
      setHasIframeLoadTimedOut(false);
    },
    onEditorError: (message) => {
      if (iframeTimeoutRef.current) {
        window.clearTimeout(iframeTimeoutRef.current);
        iframeTimeoutRef.current = null;
      }
      iframeMeasureStartedAtRef.current = null;
      setIsIframeLoading(false);
      setHasIframeLoadTimedOut(false);
      setLastEditorError(message);
    },
    onEditorDirtyStateChange: (dirty) => {
      if (!canUseLivePreviewSync || !dirty) return;
      setIsLivePreviewDirty(true);
      setLastLivePreviewError(null);
    },
  };
}
