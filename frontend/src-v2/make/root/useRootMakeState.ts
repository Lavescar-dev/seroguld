import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api';
import { getDesktopRuntimeInfo, isTauriRuntime, type DesktopRuntimeInfo } from '@/lib/desktop';
import { listenOfficeDock, type OfficeDockDescriptor } from '@/lib/officeDock';
import { getFrontendRuntimeInfo, type FrontendRuntimeInfo } from '@/lib/runtimeInfo';
import type { DesktopBootstrap, RuntimeStatus } from '@/types';

export interface SidebarStats {
  alisList: number;
  customerCount: number;
  depoCount: number;
  logCount: number;
  ayirmaCount: number;
  eritmeCount: number;
  goldPrice: number;
  silverPrice: number;
  platinPrice: number;
  finguld: number;
  finsolv: number;
}

export interface OfficeDockState {
  document: OfficeDockDescriptor | null;
  widthPx: number;
}

export interface RuntimeDiagnosticsState {
  frontend: FrontendRuntimeInfo;
  backend: RuntimeStatus | null;
  desktop: DesktopRuntimeInfo | null;
  warnings: string[];
}

const FALLBACK_DEFAULT_OFFICE_DOCK_WIDTH = 1080;
const MIN_OFFICE_DOCK_WIDTH = 760;
const MAX_OFFICE_DOCK_WIDTH = 1360;

function resolveDefaultOfficeDockWidth() {
  if (typeof window === 'undefined') {
    return FALLBACK_DEFAULT_OFFICE_DOCK_WIDTH;
  }
  const target = Math.round(window.innerWidth * 0.56);
  return Math.max(MIN_OFFICE_DOCK_WIDTH, Math.min(MAX_OFFICE_DOCK_WIDTH, target));
}

function tryParse(key: string): Array<Record<string, unknown>> {
  try {
    return JSON.parse(window.localStorage.getItem(key) || '[]') as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

function tryNum(key: string, fallback: number): number {
  const value = window.localStorage.getItem(key);
  return value ? Number.parseFloat(value) || fallback : fallback;
}

function loadStats(bootstrap?: DesktopBootstrap): SidebarStats {
  if (typeof window === 'undefined') {
    return {
      alisList: bootstrap?.navigation.pending_documents ?? bootstrap?.navigation.total_documents ?? 0,
      customerCount: bootstrap?.navigation.total_customers ?? 0,
      depoCount: bootstrap?.navigation.total_inventory ?? 0,
      logCount: bootstrap?.navigation.total_documents ?? 0,
      ayirmaCount: 0,
      eritmeCount: 0,
      goldPrice: Number(bootstrap?.market_rates.yellow_gold ?? 2850),
      silverPrice: Number(bootstrap?.market_rates.silver ?? 8.5),
      platinPrice: Number(bootstrap?.market_rates.platinum ?? 280),
      finguld: 0,
      finsolv: 0,
    };
  }

  const depoItems = tryParse('depolama_stok_v2');
  const alisItems = tryParse('alis_list');
  const custItems = tryParse('customers_list');
  const logItems = tryParse('log_entries');
  const ayirItems = tryParse('ayirma_list');
  const eritItems = tryParse('eritme_list_v2');

  const finguld = depoItems
    .filter((item) => item.mainKat !== 'gumus' && item.mainKat !== 'platin_pd')
    .reduce(
      (sum, item) =>
        sum + (Number(item.birimGram) || 0) * (Number(item.adet) || 1) * (Number(item.saflik) || 0),
      0,
    );
  const finsolv = depoItems
    .filter((item) => item.mainKat === 'gumus')
    .reduce(
      (sum, item) =>
        sum + (Number(item.birimGram) || 0) * (Number(item.adet) || 1) * (Number(item.saflik) || 0),
      0,
    );

  return {
    alisList:
      alisItems.length || bootstrap?.navigation.pending_documents || bootstrap?.navigation.total_documents || 0,
    customerCount: custItems.length || bootstrap?.navigation.total_customers || 0,
    depoCount: depoItems.length || bootstrap?.navigation.total_inventory || 0,
    logCount: logItems.length || bootstrap?.navigation.total_documents || 0,
    ayirmaCount: ayirItems.length,
    eritmeCount: eritItems.length,
    goldPrice: tryNum('market_gold', Number(bootstrap?.market_rates.yellow_gold ?? 2850)),
    silverPrice: tryNum('market_silver', Number(bootstrap?.market_rates.silver ?? 8.5)),
    platinPrice: tryNum('market_platin', Number(bootstrap?.market_rates.platinum ?? 280)),
    finguld,
    finsolv,
  };
}

export function useRootMakeState() {
  const frontendRuntime = getFrontendRuntimeInfo();
  const [stats, setStats] = useState<SidebarStats>(() => loadStats());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem('sero_dark_mode') === 'true',
  );
  const [officeDockDocument, setOfficeDockDocument] = useState<OfficeDockDescriptor | null>(null);
  const [officeDockWidth, setOfficeDockWidth] = useState(resolveDefaultOfficeDockWidth);
  const [desktopRuntime, setDesktopRuntime] = useState<DesktopRuntimeInfo | null>(null);

  const bootstrapQuery = useQuery({
    queryKey: ['bootstrap'],
    queryFn: () => apiRequest<DesktopBootstrap>('/api/v2/bootstrap'),
  });
  const runtimeQuery = useQuery({
    queryKey: ['runtime-status'],
    queryFn: () => apiRequest<RuntimeStatus>('/api/v2/runtime/status'),
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    setStats(loadStats(bootstrapQuery.data));
    const refresh = () => setStats(loadStats(bootstrapQuery.data));
    refresh();
    const interval = window.setInterval(refresh, 3000);
    window.addEventListener('storage', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('storage', refresh);
    };
  }, [bootstrapQuery.data]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    window.localStorage.setItem('sero_dark_mode', darkMode.toString());
  }, [darkMode]);

  useEffect(() => {
    return listenOfficeDock((command) => {
      if (command.action === 'close') {
        setOfficeDockDocument(null);
        return;
      }
      setOfficeDockDocument(command.document);
      setOfficeDockWidth((current) => Math.max(current, resolveDefaultOfficeDockWidth()));
    });
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setDesktopRuntime(null);
      return;
    }
    void getDesktopRuntimeInfo().then((info) => setDesktopRuntime(info));
  }, []);

  const runtimeWarnings: string[] = [];
  if (isTauriRuntime() && !runtimeQuery.data?.desktop_session) {
    runtimeWarnings.push('Kanonik desktop-dev oturumu algılanmadı. Görünen ekran eski veya ad-hoc açılmış olabilir.');
  }
  if (runtimeQuery.data?.desktop_session && runtimeQuery.data.desktop_session.frontend_mode !== frontendRuntime.frontend_mode) {
    runtimeWarnings.push('Frontend runtime modu desktop session kaydıyla uyuşmuyor. Açık ekran beklediğin bundle olmayabilir.');
  }
  if (desktopRuntime?.runtime_mode === 'tauri-dev-url' && frontendRuntime.frontend_mode !== 'vite-dev') {
    runtimeWarnings.push('Tauri dev URL açık ama frontend Vite dev olarak görünmüyor. Değişiklikler beklediğin gibi yansımayabilir.');
  }

  return {
    stats,
    runtime: {
      frontend: frontendRuntime,
      backend: runtimeQuery.data || null,
      desktop: desktopRuntime,
      warnings: runtimeWarnings,
    } satisfies RuntimeDiagnosticsState,
    sidebarOpen,
    darkMode,
    officeDock: {
      document: officeDockDocument,
      widthPx: officeDockWidth,
    } satisfies OfficeDockState,
    onOpenSidebar: () => setSidebarOpen(true),
    onCloseSidebar: () => setSidebarOpen(false),
    onToggleDarkMode: () => setDarkMode((current) => !current),
    onCloseOfficeDock: () => setOfficeDockDocument(null),
    onResizeOfficeDock: (nextWidth: number) =>
      setOfficeDockWidth(Math.max(MIN_OFFICE_DOCK_WIDTH, Math.min(MAX_OFFICE_DOCK_WIDTH, nextWidth))),
  };
}
