import type { UploadStatus } from './signatures';

/**
 * Waiting for a drawn signature to be checked (docs/API.md §11: "poll for READY/FAILED"). The
 * backend's worker usually takes a second or two; the waits grow so a slow worker is not pressed,
 * and after about half a minute the guest is offered to draw again or type instead.
 */
export const POLL_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 4000, 4000, 5000, 5000, 5000];

export type PollOutcome = 'READY' | 'FAILED' | 'TIMEOUT';

export interface PollDependencies {
  /** The upload's status now; `undefined` when the read did not list it. */
  read: () => Promise<UploadStatus | undefined>;
  wait: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
}

/** Reads after each wait until the drawing is READY or FAILED, the waits run out, or it stops. */
export async function pollUpload({ read, wait, signal }: PollDependencies): Promise<PollOutcome> {
  for (const delay of POLL_DELAYS_MS) {
    await wait(delay, signal);
    if (signal.aborted) return 'TIMEOUT';
    const status = await read().catch(() => undefined);
    if (status === 'READY' || status === 'FAILED') return status;
  }
  return 'TIMEOUT';
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
