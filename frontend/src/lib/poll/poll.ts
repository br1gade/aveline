/**
 * Waiting for the backend's worker: read, and read again after each wait, until the value is done,
 * the waits run out or the page stops waiting. The drawn signature and the guest's shared photos
 * use it; neither has a status read of its own (FR-41).
 */
export interface PollOptions<T> {
  /** The value now; `undefined` when the read did not find it. A failed read counts as not done. */
  read: () => Promise<T | undefined>;
  isDone: (value: T) => boolean;
  /** One wait before each read, in milliseconds. */
  delays: readonly number[];
  wait: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
}

/** The first value that is done, or `undefined` when the waits ran out or the page stopped. */
export async function pollUntil<T>(options: PollOptions<T>): Promise<T | undefined> {
  const { read, isDone, delays, wait, signal } = options;
  for (const delay of delays) {
    await wait(delay, signal);
    if (signal.aborted) return undefined;
    const value = await read().catch(() => undefined);
    if (value !== undefined && isDone(value)) return value;
  }
  return undefined;
}

/** A timer that ends early, quietly, when the page stops waiting. */
export function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
