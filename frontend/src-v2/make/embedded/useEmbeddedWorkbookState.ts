import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, apiRequest, buildApiUrl, downloadAuthedDocument, localizeApiError } from '@/lib/api';
import {
  type ExcelBridgeStatus,
  closeManagedExcelSession,
  exportDocumentBytes,
  focusManagedExcelSession,
  getExcelAvailability,
  isTauriRuntime,
  launchExcelBridge,
  probeExcelComAvailability,
} from '@/lib/desktop';
import { getLocale, t } from '@/lib/locale';
import { useToast } from '@/lib/toast';
import { isPendingSaveDiscarded, registerPendingSaveHandler } from '@/lib/saveCoordinator';
import type {
  DocumentArtifactCellError,
  DocumentArtifactCellsPatchOut,
  DocumentArtifactPreview,
} from '@/types';

import { overlayWorkbookEdits, parseWorkbookGrid } from './workbookGrid';
import type { EmbeddedCellError, EmbeddedSaveState } from './types';
import type { EmbeddedWorkbookSurfaceProps } from './EmbeddedWorkbookSurface';

type ExcelSession = {
  session_id: string;
  bearer_token?: string | null;
  status: string;
  can_write: boolean;
  revision: number;
  file_name: string;
  working_file_name: string;
  message?: string | null;
};

type ExcelBridgeSession = {
  sessionId: string;
  token: string;
};

type PatchRequest = {
  baseRevision: number;
  changes: Array<{ sheet: string; cell_ref: string; value: string }>;
};

function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
}

function parseCellErrors(errors: DocumentArtifactCellError[]) {
  return Object.fromEntries(
    errors
      .filter((error) => error.sheet && error.cell_ref)
      .map((error) => [`${error.sheet}:${error.cell_ref}`, { message: error.message } satisfies EmbeddedCellError]),
  );
}

function isEditableArtifact(kind: string, key: string, preview: DocumentArtifactPreview | null) {
  if (kind === 'alis-workspace') {
    // A freshly created draft may not have a DocumentArtifact row yet: the
    // preview route exposes the editable contract first and the download
    // route materializes the canonical artifact. Keep that first load
    // editable instead of requiring a manual reload after the download.
    return Boolean(
      preview?.external_edit_supported
      && (!preview.artifact || preview.artifact.version_kind === 'draft'),
    );
  }
  return kind === 'depolama' && (key === 'live' || key === '');
}

export function useEmbeddedWorkbookState(
  kind: string,
  artifactKey: string,
): EmbeddedWorkbookSurfaceProps {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [cellEdits, setCellEdits] = useState<Record<string, string>>({});
  const [cellErrors, setCellErrors] = useState<Record<string, EmbeddedCellError>>({});
  const [saveState, setSaveState] = useState<EmbeddedSaveState>('idle');
  const [revision, setRevision] = useState(0);
  const [excelAvailable, setExcelAvailable] = useState<boolean | null>(null);
  const [excelMessage, setExcelMessage] = useState<string | null>(null);
  const [excelConflict, setExcelConflict] = useState(false);
  const [isOpeningExcel, setIsOpeningExcel] = useState(false);
  const [managedExcelOpen, setManagedExcelOpen] = useState(false);
  const cellEditsRef = useRef<Record<string, string>>({});
  const revisionRef = useRef(0);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const excelSessionRef = useRef<ExcelBridgeSession | null>(null);
  const exportInFlightRef = useRef(false);

  const previewQuery = useQuery({
    queryKey: ['embedded-workbook', kind, artifactKey],
    enabled: Boolean(kind && artifactKey),
    queryFn: () => apiRequest<DocumentArtifactPreview>(`/api/v2/excel-preview/${kind}/${artifactKey}`),
  });

  const workbookQuery = useQuery({
    queryKey: ['embedded-workbook-file', kind, artifactKey, previewQuery.data?.download_path, previewQuery.data?.artifact?.updated_at],
    enabled: Boolean(previewQuery.data?.download_path),
    queryFn: async () => {
      const preview = previewQuery.data!;
      const blob = await apiRequest<Blob>(preview.download_path);
      return parseWorkbookGrid(await blob.arrayBuffer(), preview.sheets, preview.editable_cells);
    },
  });

  const preview = previewQuery.data || null;
  const baseRevision = preview?.artifact?.revision ?? preview?.revision ?? revision;
  const isReadOnly = !isEditableArtifact(kind, artifactKey, preview);
  const sheets = useMemo(
    () => overlayWorkbookEdits(workbookQuery.data || [], cellEdits),
    [cellEdits, workbookQuery.data],
  );

  useEffect(() => {
    revisionRef.current = baseRevision;
    setRevision(baseRevision);
  }, [baseRevision]);

  useEffect(() => {
    cellEditsRef.current = cellEdits;
  }, [cellEdits]);

  useEffect(() => {
    setCellEdits({});
    cellEditsRef.current = {};
    setCellErrors({});
    setSaveState('idle');
    setManagedExcelOpen(false);
    excelSessionRef.current = null;
  }, [artifactKey, kind]);

  useEffect(() => {
    let active = true;
    if (!isTauriRuntime()) {
      setExcelAvailable(null);
      return () => {
        active = false;
      };
    }
    // Katmanlı tespit: registry anında yanıt verir; olumsuzsa (veya IPC
    // hatasıysa) gerçek COM probe'u kesin kararı verir — 'kayıtlı ama bozuk'
    // Office kurulumları da böyle yakalanır.
    void getExcelAvailability().then(async (availability) => {
      if (!active) return;
      if (availability?.available) {
        setExcelAvailable(true);
        return;
      }
      const verdict = await probeExcelComAvailability();
      if (!active) return;
      if (verdict?.confidence === 'ipc-error') {
        // IPC hatası 'Excel yok' demek değildir; kullanıcıyı yanlış kilitleme.
        setExcelAvailable(availability?.ipc_error ? null : availability?.available ?? null);
        return;
      }
      setExcelAvailable(verdict?.available ?? false);
    });
    return () => {
      active = false;
    };
  }, []);

  const onRetryExcelProbe = async () => {
    if (!isTauriRuntime()) return;
    setExcelMessage(t('workbook.excelOpening', getLocale()));
    const verdict = await probeExcelComAvailability(true);
    if (verdict?.available) {
      setExcelAvailable(true);
      setExcelMessage(null);
    } else {
      setExcelAvailable(false);
      setExcelMessage(
        verdict?.error
          ? `${t('workbook.excelBridgeFailed', getLocale())}: ${verdict.error}`
          : t('workbook.excelMissing', getLocale()),
      );
    }
  };

  const patchMutation = useMutation({
    mutationFn: (request: PatchRequest) =>
      apiRequest<DocumentArtifactCellsPatchOut>(`/api/v2/document-artifacts/${kind}/${artifactKey}/cells`, {
        method: 'PATCH',
        body: JSON.stringify({
          base_revision: request.baseRevision,
          source: 'embedded',
          changes: request.changes.map((change) => ({
            sheet: change.sheet,
            cell_ref: change.cell_ref,
            value: change.value,
          })),
        }),
      }),
  });

  const flushPendingChanges = async () => {
    if (isPendingSaveDiscarded() || isReadOnly || managedExcelOpen) return;
    // A close/logout flush may race with a debounce request. Drain the active
    // request first, then send any edits entered while it was in flight.
    while (true) {
      if (savePromiseRef.current) {
        await savePromiseRef.current;
        if (Object.keys(cellEditsRef.current).length === 0) return;
      }

      const edits = cellEditsRef.current;
      const changes = Object.entries(edits).map(([key, value]) => {
        const separator = key.lastIndexOf(':');
        return {
          sheet: key.slice(0, separator),
          cell_ref: key.slice(separator + 1),
          value,
        };
      });
      if (changes.length === 0) return;

      const request: PatchRequest = {
        baseRevision: revisionRef.current,
        changes,
      };
      setSaveState('saving');
      const promise = (async () => {
        try {
          const result = await patchMutation.mutateAsync(request);
          if (result.status === 'rejected') {
            setCellErrors(parseCellErrors(result.cell_errors || []));
            setSaveState('error');
            const firstError = result.cell_errors?.find((error) => error.message)?.message;
            throw new Error(firstError || t('workbook.saveError', getLocale()));
          }
          revisionRef.current = result.revision;
          setRevision(result.revision);
          setCellErrors({});
          const nextEdits = { ...cellEditsRef.current };
          for (const change of changes) {
            const key = `${change.sheet}:${change.cell_ref}`;
            if (nextEdits[key] === change.value) delete nextEdits[key];
          }
          cellEditsRef.current = nextEdits;
          setCellEdits(nextEdits);
          setSaveState('saved');
          // Yalnız preview sorgusu tazelenir: workbook dosyası sorgusu anahtarı
          // download_path/updated_at türettiğinden sunucudaki belge gerçekten
          // değiştiyse react-query kendisi yeniden indirip parse eder. Her
          // otosave sonrası kör indirme + senkron parse yapılmaz.
          await queryClient.invalidateQueries({ queryKey: ['embedded-workbook', kind, artifactKey] });
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            // Keep the user's unsent values over the freshly loaded workbook;
            // they can correct/retry without silent data loss.
            setCellErrors({});
            setSaveState('conflict');
            await queryClient.invalidateQueries({ queryKey: ['embedded-workbook', kind, artifactKey] });
            throw error;
          }
          setSaveState('error');
          throw error;
        } finally {
          savePromiseRef.current = null;
        }
      })();
      savePromiseRef.current = promise;
      await promise;
      if (Object.keys(cellEditsRef.current).length === 0) return;
    }
  };

  useEffect(() => {
    flushRef.current = flushPendingChanges;
  });

  useEffect(() => {
    if (isReadOnly || managedExcelOpen || Object.keys(cellEdits).length === 0) return undefined;
    const timeout = window.setTimeout(() => {
      void flushRef.current().catch((error: unknown) => {
        // 409 conflict yüzeyde kendi bandıyla görünür; diğer hatalar sessiz
        // yutulursa kullanıcı 422 doğrulama detayını hiç göremez.
        if (error instanceof ApiError && error.status === 409) return;
        toast.error(t('workbook.saveError', getLocale()), localizeApiError(error));
      });
    }, 1_200);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellEdits, isReadOnly, managedExcelOpen]);

  useEffect(() => {
    const unregister = registerPendingSaveHandler(
      `embedded-workbook:${kind}:${artifactKey}`,
      () => flushRef.current(),
    );
    return () => {
      // Sidebar/navigation changes can unmount a sheet before its 1.2 s
      // debounce expires. Start the flush immediately and keep the global
      // close/logout handler registered until that request succeeds, so a
      // close racing the route change still waits for the same save promise.
      // If the request fails, the closure intentionally remains registered:
      // the component is gone, but retaining its latest-value callback gives
      // the global close/logout guard a chance to retry instead of silently
      // abandoning edits during navigation.
      if (isPendingSaveDiscarded()) {
        unregister();
        return;
      }
      void flushRef.current().then(unregister).catch(() => undefined);
    };
  }, [artifactKey, kind]);

  useEffect(() => {
    const session = excelSessionRef.current;
    if (!managedExcelOpen || !session) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(buildApiUrl(`/api/v2/excel-sessions/${session.sessionId}`), {
          headers: { Authorization: `Bearer ${session.token}` },
        });
        if (response.status === 404 || response.status === 410) {
          excelSessionRef.current = null;
          setManagedExcelOpen(false);
          setExcelMessage(null);
          await queryClient.invalidateQueries({ queryKey: ['embedded-workbook', kind, artifactKey] });
          return;
        }
        if (!response.ok) return;
        const status = (await response.json()) as ExcelSession;
        if (Number.isFinite(status.revision) && status.revision !== revisionRef.current) {
          revisionRef.current = status.revision;
          setRevision(status.revision);
          // Preview tazelenir; dosya sorgusu updated_at/download_path anahtarı
          // değişince kendiliğinden yeniden indirilir (her poll'da değil).
          await queryClient.invalidateQueries({ queryKey: ['embedded-workbook', kind, artifactKey] });
        }
        if (status.message) {
          setExcelMessage(status.message);
        }
      } catch {
        // Excel bridge owns the authoritative session; a transient poll error
        // must not make the grid editable while Excel may still be open.
      }
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [artifactKey, kind, managedExcelOpen, queryClient]);

  const onCellChange = (sheet: string, cellRef: string, value: string) => {
    if (isReadOnly || managedExcelOpen) return;
    const key = `${sheet}:${cellRef}`;
    setCellErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setSaveState((current) => (current === 'saved' ? 'idle' : current));
    setExcelConflict(false);
    const next = { ...cellEditsRef.current, [key]: value };
    cellEditsRef.current = next;
    setCellEdits(next);
  };

  const onOpenExcel = async () => {
    if (managedExcelOpen || isOpeningExcel) return;
    if (!isTauriRuntime()) {
      setExcelMessage(t('workbook.excelUnavailable', getLocale()));
      return;
    }
    if (excelAvailable === false) {
      setExcelMessage(t('workbook.excelMissing', getLocale()));
      return;
    }
    setIsOpeningExcel(true);
    setExcelMessage(null);
    setExcelConflict(false);
    let session: ExcelSession | null = null;
    // Hata mesajı aşamaya göre ayrışır: çalışma kopyası mı, köprü mü?
    let stage: 'working-copy' | 'bridge' = 'working-copy';
    try {
      await flushPendingChanges();
      session = await apiRequest<ExcelSession>('/api/v2/excel-sessions', {
        method: 'POST',
        body: JSON.stringify({ kind, key: artifactKey }),
      });
      const token = session.bearer_token || '';
      if (!token) throw new Error(t('workbook.sessionTokenMissing', getLocale()));
      stage = 'bridge';
      let bridge: ExcelBridgeStatus | null = null;
      let bridgeError: string | null = null;
      try {
        bridge = await launchExcelBridge({
          // The backend keeps each working copy below documents/working/<id>.
          // Only this relative path is sent to the native shell; the bearer
          // token remains in memory and is never put on a command line.
          workbook_path: `${session.session_id}/${session.working_file_name}`,
          sync_url: buildApiUrl(`/api/v2/excel-sessions/${session.session_id}/sync`),
          close_url: buildApiUrl(`/api/v2/excel-sessions/${session.session_id}`),
          session_token: token,
          base_revision: session.revision,
          can_write: session.can_write,
        });
      } catch (nativeError) {
        bridgeError = nativeError instanceof Error ? nativeError.message : String(nativeError);
      }
      if (!bridge?.running) {
        const detail = bridge?.message || bridgeError;
        throw new Error(
          detail
            ? `${t('workbook.excelBridgeFailed', getLocale())}: ${detail}`
            : t('workbook.excelMissing', getLocale()),
        );
      }
      excelSessionRef.current = { sessionId: session.session_id, token };
      setManagedExcelOpen(true);
      setExcelMessage(t('workbook.excelEditing', getLocale()));
    } catch (error) {
      if (session?.bearer_token) {
        // A native launch can fail after the backend reserved the single
        // Excel slot. Release that reservation so retry is not stuck.
        try {
          await fetch(buildApiUrl(`/api/v2/excel-sessions/${session.session_id}`), {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${session.bearer_token}` },
          });
        } catch {
          // Backend expiry/recovery remains authoritative.
        }
      }
      if (error instanceof ApiError && error.status === 409) {
        setExcelConflict(true);
      }
      const detail = error instanceof Error && error.message ? error.message : null;
      if (stage === 'working-copy') {
        setExcelMessage(
          detail
            ? `${t('workbook.workingCopyFailed', getLocale())}: ${detail}`
            : t('workbook.workingCopyFailed', getLocale()),
        );
      } else {
        setExcelMessage(detail || t('workbook.excelMissing', getLocale()));
      }
    } finally {
      setIsOpeningExcel(false);
    }
  };

  const onFocusExistingExcel = async () => {
    const focused = await focusManagedExcelSession();
    if (!focused) {
      setExcelMessage(t('workbook.excelEditing', getLocale()));
    }
  };

  const onCloseExistingExcel = async () => {
    const closed = await closeManagedExcelSession();
    if (closed) {
      setExcelConflict(false);
      setExcelMessage(t('workbook.saved', getLocale()));
      excelSessionRef.current = null;
      setManagedExcelOpen(false);
      return;
    }
    setExcelMessage(t('workbook.saveError', getLocale()));
  };

  const onExport = async () => {
    if (!preview?.download_path) return;
    // Yönetilen Excel oturumu açıkken kanonik dosya çalışma kopyasındaki
    // kaydedilmemiş değişiklikleri içermez; eski dosya verip kullanıcıyı
    // yanıltmak yerine dışa aktarma kilitlenir.
    if (managedExcelOpen) {
      const message = 'Excel’deki kaydedilmemiş değişiklikler dışa aktarılan dosyaya yansımaz; önce değişiklikleri senkronlayın.';
      setExcelMessage(message);
      toast.warning(message);
      return;
    }
    if (exportInFlightRef.current) return;
    exportInFlightRef.current = true;
    try {
      const blob = await apiRequest<Blob>(preview.download_path);
      const fileName = preview.artifact?.file_name || `${kind}-${artifactKey}.xlsx`;
      if (isTauriRuntime()) {
        const result = await exportDocumentBytes(fileName, await blobToBase64(blob));
        if (result) setExcelMessage(result.path);
        return;
      }
      await downloadAuthedDocument(preview.download_path, fileName);
    } catch (error) {
      const detail = localizeApiError(error);
      setExcelMessage(detail);
      toast.error(t('workbook.export', getLocale()), detail);
    } finally {
      exportInFlightRef.current = false;
    }
  };

  const onReload = async () => {
    // A revision conflict cannot be resolved by resending the same stale
    // values.  In that state the explicit reload button is the user's safe
    // discard action; for every other state we still flush before replacing
    // the grid so a normal reload cannot lose pending edits.  A failed flush
    // must not silently swallow the reload either: the user decides whether
    // the unsent edits may be discarded.
    if (saveState !== 'conflict') {
      try {
        await flushPendingChanges();
      } catch {
        const proceed = window.confirm(
          'Kaydedilemeyen hücre düzenlemeleri yenileme ile silinecek. Kaydetmeden yenilemek istiyor musunuz?',
        );
        if (!proceed) return;
      }
    }
    setCellEdits({});
    cellEditsRef.current = {};
    setCellErrors({});
    setSaveState('idle');
    await queryClient.invalidateQueries({ queryKey: ['embedded-workbook', kind, artifactKey] });
    await queryClient.invalidateQueries({ queryKey: ['embedded-workbook-file', kind, artifactKey] });
  };

  return {
    kind,
    artifactKey,
    preview,
    sheets,
    isLoading: previewQuery.isLoading || workbookQuery.isLoading,
    isError: previewQuery.isError || workbookQuery.isError,
    isReadOnly,
    managedExcelOpen,
    revision,
    dirtyCount: Object.keys(cellEdits).length,
    saveState,
    cellErrors,
    excelAvailable,
    onRetryExcelProbe,
    excelMessage,
    excelConflict,
    isOpeningExcel,
    onCellChange,
    onExport,
    onOpenExcel,
    onFocusExistingExcel,
    onCloseExistingExcel,
    onCancelExcelConflict: () => setExcelConflict(false),
    onReload,
  };
}
