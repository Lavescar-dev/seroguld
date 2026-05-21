/** Modüller arası senkronizasyon için tanımlı kanal isimleri.
 *  - `alis`            : alış sayfasının query'leri (saved purchases vs.)
 *  - `alis-workspace`  : alış office workbook
 *  - `log`             : log sayfası workspace + melt lots
 *  - `depolama`        : depolama sayfası inventory grid
 *  - `uniconta`        : uniconta sync ve faturalar
 *  - `inventory`       : eski legacy key, depolama ile birlikte invalidate edilir
 */
export type ArtifactSyncKind =
  | 'alis'
  | 'alis-workspace'
  | 'log'
  | 'depolama'
  | 'uniconta'
  | 'inventory'
  | (string & {});

export interface ArtifactSyncSignal {
  kind: ArtifactSyncKind;
  key: string;
  source: string;
  /** Cross-module trigger zinciri: bu sinyalin invalidate etmesi gereken ek kind'lar.
   *  Örnek: Log batch-apply emit eder → kind='log', triggers=['depolama','alis'] */
  triggers?: ArtifactSyncKind[];
  artifact_updated_at?: string | null;
  emitted_at: string;
}

/** Modüller arası standart trigger zinciri. emit ederken otomatik enjekte edilir. */
const DEFAULT_CROSS_TRIGGERS: Record<string, ArtifactSyncKind[]> = {
  // Alış finalize → log ve depolama'da yeni AFG belge satırları belirir
  alis: ['log', 'depolama'],
  // Log route → depolama'da yeni stoklar belirir, alış listesindeki
  // uniconta_sync_status da değişebilir
  log: ['depolama', 'alis'],
  // Depolama'da Product silme/melted geçişi → log eritme havuzu güncellenir
  depolama: ['log'],
  // Uniconta retry → alış listesi sync_status'u günceller
  uniconta: ['alis'],
};

const STORAGE_KEY = 'sero_artifact_sync_event';
const CUSTOM_EVENT = 'sero:artifact-sync';
const CHANNEL_NAME = 'sero-artifact-sync';

let sharedChannel: BroadcastChannel | null | undefined;

function getBroadcastChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (sharedChannel !== undefined) {
    return sharedChannel;
  }
  try {
    sharedChannel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    sharedChannel = null;
  }
  return sharedChannel;
}

function normalizeSignal(signal: Omit<ArtifactSyncSignal, 'emitted_at'> & { emitted_at?: string }): ArtifactSyncSignal {
  const triggers =
    signal.triggers && signal.triggers.length > 0
      ? signal.triggers
      : DEFAULT_CROSS_TRIGGERS[signal.kind as string] || undefined;
  return {
    ...signal,
    triggers,
    artifact_updated_at: signal.artifact_updated_at ?? null,
    emitted_at: signal.emitted_at || new Date().toISOString(),
  };
}

/** Sinyalin bu dinleyici için relevant olup olmadığını döner.
 *  Hem `kind === watch` hem `triggers.includes(watch)` durumlarını yakalar. */
export function signalMatches(
  signal: ArtifactSyncSignal,
  watch: ArtifactSyncKind | ArtifactSyncKind[],
): boolean {
  const watches = Array.isArray(watch) ? watch : [watch];
  if (watches.includes(signal.kind as ArtifactSyncKind)) return true;
  if (signal.triggers && signal.triggers.some((t) => watches.includes(t))) return true;
  return false;
}

function parseSignal(raw: string | null): ArtifactSyncSignal | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ArtifactSyncSignal>;
    if (!parsed || typeof parsed.kind !== 'string' || typeof parsed.key !== 'string' || typeof parsed.source !== 'string') {
      return null;
    }
    return normalizeSignal(parsed as ArtifactSyncSignal);
  } catch {
    return null;
  }
}

export function emitArtifactSync(signal: Omit<ArtifactSyncSignal, 'emitted_at'> & { emitted_at?: string }) {
  if (typeof window === 'undefined') return;
  const payload = normalizeSignal(signal);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage write failures
  }
  try {
    window.dispatchEvent(new CustomEvent<ArtifactSyncSignal>(CUSTOM_EVENT, { detail: payload }));
  } catch {
    // ignore custom event failures
  }
  getBroadcastChannel()?.postMessage(payload);
}

export function listenArtifactSync(listener: (signal: ArtifactSyncSignal) => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  let lastSignature = '';
  const handleSignal = (signal: ArtifactSyncSignal) => {
    const signature = `${signal.kind}:${signal.key}:${signal.source}:${signal.emitted_at}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    listener(signal);
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    const payload = parseSignal(event.newValue);
    if (payload) handleSignal(payload);
  };
  const onCustomEvent = (event: Event) => {
    const payload = (event as CustomEvent<ArtifactSyncSignal>).detail;
    if (payload) handleSignal(payload);
  };
  const channel = getBroadcastChannel();
  const onChannelMessage = (event: MessageEvent<ArtifactSyncSignal>) => {
    if (event.data) handleSignal(normalizeSignal(event.data));
  };

  window.addEventListener('storage', onStorage);
  window.addEventListener(CUSTOM_EVENT, onCustomEvent);
  channel?.addEventListener('message', onChannelMessage);

  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CUSTOM_EVENT, onCustomEvent);
    channel?.removeEventListener('message', onChannelMessage);
  };
}
