export interface OfficeDockDescriptor {
  kind: string;
  key: string;
  title?: string | null;
  source?: string;
  emitted_at: string;
}

type OfficeDockCommand =
  | {
      action: 'open';
      document: OfficeDockDescriptor;
    }
  | {
      action: 'close';
      emitted_at: string;
    };

type OfficeDockOpenInput = {
  action: 'open';
  document: Omit<OfficeDockDescriptor, 'emitted_at'>;
  emitted_at?: string;
};

type OfficeDockCloseInput = {
  action: 'close';
  emitted_at?: string;
};

const CUSTOM_EVENT = 'sero:office-dock';
const CHANNEL_NAME = 'sero-office-dock';

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

function normalizeCommand(command: OfficeDockOpenInput | OfficeDockCloseInput): OfficeDockCommand {
  if (command.action === 'close') {
    return {
      action: 'close' as const,
      emitted_at: command.emitted_at || new Date().toISOString(),
    };
  }
  return {
    action: 'open' as const,
    document: {
      ...command.document,
      emitted_at: command.emitted_at || new Date().toISOString(),
    },
  };
}

export function openOfficeDock(document: Omit<OfficeDockDescriptor, 'emitted_at'>) {
  if (typeof window === 'undefined') return;
  const payload = normalizeCommand({
    action: 'open',
    document,
  });
  window.dispatchEvent(new CustomEvent<OfficeDockCommand>(CUSTOM_EVENT, { detail: payload }));
  getBroadcastChannel()?.postMessage(payload);
}

export function closeOfficeDock() {
  if (typeof window === 'undefined') return;
  const payload = normalizeCommand({
    action: 'close',
  });
  window.dispatchEvent(new CustomEvent<OfficeDockCommand>(CUSTOM_EVENT, { detail: payload }));
  getBroadcastChannel()?.postMessage(payload);
}

export function listenOfficeDock(listener: (command: OfficeDockCommand) => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  let lastSignature = '';
  const handleCommand = (command: OfficeDockCommand) => {
    const signature =
      command.action === 'open'
        ? `open:${command.document.kind}:${command.document.key}:${command.document.emitted_at}`
        : `close:${command.emitted_at}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    listener(command);
  };

  const onCustomEvent = (event: Event) => {
    const payload = (event as CustomEvent<OfficeDockCommand>).detail;
    if (payload) handleCommand(payload);
  };
  const channel = getBroadcastChannel();
  const onChannelMessage = (event: MessageEvent<OfficeDockCommand>) => {
    if (event.data) handleCommand(event.data);
  };

  window.addEventListener(CUSTOM_EVENT, onCustomEvent);
  channel?.addEventListener('message', onChannelMessage);

  return () => {
    window.removeEventListener(CUSTOM_EVENT, onCustomEvent);
    channel?.removeEventListener('message', onChannelMessage);
  };
}
