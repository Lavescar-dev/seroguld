import { useEffect, useId, useMemo, useRef } from 'react';

import type { OfficeDocumentLaunch } from '@/types';

type OnlyOfficeEditorProps = {
  launch: OfficeDocumentLaunch;
  onReady: () => void;
  onError: (message: string) => void;
  onDirtyStateChange?: (dirty: boolean) => void;
  className: string;
};

type OnlyOfficeDocEditor = {
  destroyEditor?: () => void;
};

const scriptCache = new Map<string, Promise<void>>();

function loadOnlyOfficeScript(src: string): Promise<void> {
  const cached = scriptCache.get(src);
  if (cached) return cached;

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-onlyoffice-api="${src}"]`);
    if (existing) {
      if (window.DocsAPI?.DocEditor) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('ONLYOFFICE API script yüklenemedi.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.onlyofficeApi = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('ONLYOFFICE API script yüklenemedi.'));
    document.head.appendChild(script);
  });

  scriptCache.set(src, promise);
  return promise;
}

export function OnlyOfficeEditor({ launch, onReady, onError, onDirtyStateChange, className }: OnlyOfficeEditorProps) {
  const containerId = useId().replace(/:/g, '-');
  const editorRef = useRef<OnlyOfficeDocEditor | null>(null);
  const readyEmittedRef = useRef(false);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onDirtyStateChangeRef = useRef(onDirtyStateChange);
  const config = useMemo(() => launch.onlyoffice_config || null, [launch.onlyoffice_config]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onDirtyStateChangeRef.current = onDirtyStateChange;
  }, [onDirtyStateChange]);

  useEffect(() => {
    readyEmittedRef.current = false;
  }, [launch.access_token, launch.artifact?.updated_at]);

  useEffect(() => {
    if (!launch.onlyoffice_api_js_url || !config) return;
    let cancelled = false;

    const mount = async () => {
      await loadOnlyOfficeScript(launch.onlyoffice_api_js_url || '');
      if (cancelled) return;
      if (!window.DocsAPI?.DocEditor) {
        throw new Error('ONLYOFFICE DocsAPI bulunamadı.');
      }

      if (editorRef.current?.destroyEditor) {
        editorRef.current.destroyEditor();
      }

      const docEditorConfig = {
        ...config,
        events: {
          ...(typeof config === 'object' && config && 'events' in config ? (config.events as Record<string, unknown>) : {}),
          onAppReady: () => {
            if (readyEmittedRef.current) return;
            readyEmittedRef.current = true;
            onReadyRef.current();
          },
          onDocumentReady: () => {
            if (readyEmittedRef.current) return;
            readyEmittedRef.current = true;
            onReadyRef.current();
          },
          onError: (event: unknown) => {
            const eventObject = typeof event === 'object' && event ? (event as { data?: { errorCode?: string | number; errorDescription?: string } }) : null;
            const code = eventObject?.data?.errorCode;
            const description = eventObject?.data?.errorDescription;
            onErrorRef.current(description || (code != null ? `ONLYOFFICE hata kodu: ${String(code)}` : 'ONLYOFFICE editor başlatılamadı.'));
          },
          onDocumentStateChange: (event: unknown) => {
            if (!onDirtyStateChangeRef.current) return;
            const eventObject = typeof event === 'object' && event ? (event as { data?: unknown }) : null;
            const rawValue = eventObject?.data;
            if (typeof rawValue === 'boolean') {
              onDirtyStateChangeRef.current(rawValue);
              return;
            }
            if (typeof event === 'boolean') {
              onDirtyStateChangeRef.current(event);
            }
          },
        },
      };

      editorRef.current = new window.DocsAPI.DocEditor(containerId, docEditorConfig);
    };

    void mount().catch((error) => {
      console.error('[office] ONLYOFFICE mount failed', error);
      onErrorRef.current(error instanceof Error ? error.message : 'ONLYOFFICE editor başlatılamadı.');
    });

    return () => {
      cancelled = true;
      onDirtyStateChangeRef.current?.(false);
      if (editorRef.current?.destroyEditor) {
        editorRef.current.destroyEditor();
      }
      editorRef.current = null;
    };
  }, [containerId, config, launch.onlyoffice_api_js_url]);

  return <div id={containerId} className={className} style={{ width: '100%', height: '100%' }} />;
}
