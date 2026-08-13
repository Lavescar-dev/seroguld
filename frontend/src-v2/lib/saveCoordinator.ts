export type PendingSaveHandler = () => void | Promise<void>;

export type PendingSaveFailure = {
  id: string;
  error: unknown;
};

export class PendingSaveError extends Error {
  readonly failures: PendingSaveFailure[];

  constructor(failures: PendingSaveFailure[]) {
    super('Bekleyen kayıtlar tamamlanamadı.');
    this.name = 'PendingSaveError';
    this.failures = failures;
  }
}

const handlers = new Map<string, PendingSaveHandler>();
let activeFlush: Promise<void> | null = null;
// A discard is an explicit user decision made while leaving the current
// session.  Keep the intent until the mounted workbook effects have cleaned
// themselves up; otherwise their unmount cleanup could enqueue a late save
// after the user chose to leave without saving.
let discardRequested = false;

export function isPendingSaveDiscarded(): boolean {
  return discardRequested;
}

export function discardPendingSaves(): void {
  discardRequested = true;
}

export function resetPendingSaveDiscard(): void {
  discardRequested = false;
}

/** Register a latest-value save callback and return an idempotent cleanup. */
export function registerPendingSaveHandler(id: string, handler: PendingSaveHandler): () => void {
  // A new workbook mounted after a completed logout starts a fresh save
  // lifecycle. Do not carry the previous session's explicit discard choice
  // into that new session.
  discardRequested = false;
  handlers.set(id, handler);
  return () => {
    if (handlers.get(id) === handler) {
      handlers.delete(id);
    }
  };
}

function runWithTimeout(handler: PendingSaveHandler, timeoutMs: number): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.resolve().then(handler);
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Kayıt zaman aşımına uğradı (${timeoutMs} ms).`));
    }, timeoutMs);

    Promise.resolve()
      .then(handler)
      .then(
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

/**
 * Flush all currently registered saves. Concurrent callers share one flush,
 * which prevents logout and window-close handlers from sending duplicate
 * writes. A failed or timed-out handler rejects the aggregate operation.
 */
export function flushPendingSaves(options: { timeoutMs?: number } = {}): Promise<void> {
  if (discardRequested) return Promise.resolve();
  if (activeFlush) return activeFlush;

  const timeoutMs = options.timeoutMs ?? 10_000;
  const snapshot = [...handlers.entries()];
  activeFlush = Promise.all(
    snapshot.map(async ([id, handler]) => {
      try {
        await runWithTimeout(handler, timeoutMs);
        return null;
      } catch (error) {
        return { id, error } satisfies PendingSaveFailure;
      }
    }),
  ).then((results) => {
    const failures = results.filter((result): result is PendingSaveFailure => result !== null);
    if (failures.length > 0) {
      throw new PendingSaveError(failures);
    }
  });

  return activeFlush.finally(() => {
    activeFlush = null;
  });
}
