export interface ArtifactSyncSignal {
  kind: string;
  key: string;
  source: string;
  artifact_updated_at?: string | null;
  emitted_at: string;
}

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
  return {
    ...signal,
    artifact_updated_at: signal.artifact_updated_at ?? null,
    emitted_at: signal.emitted_at || new Date().toISOString(),
  };
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
