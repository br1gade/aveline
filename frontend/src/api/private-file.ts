import { waitFor } from '@/lib/poll';
import { abortError } from '@/lib/queue';

import { isApiError } from './errors';

/**
 * A private file, read through an API client rather than an `<img src>`: a guest's file address
 * carries their token, which must never reach the page, and a host's needs the bearer token, which
 * an image element cannot send. The bytes are shown from an object URL (`ui/private-image.tsx`).
 *
 * Processed images share the guest page's read allowance, and docs/API.md §11 asks for a delayed
 * retry on 429. Nothing else is tried again: 403 never is (§1), and 404 means the picture is gone.
 */
export const FILE_RETRY_DELAYS_MS: readonly number[] = [2000, 4000];

export interface PrivateFileOptions {
  signal?: AbortSignal | undefined;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export async function readPrivateFile(
  load: () => Promise<Blob>,
  { signal = new AbortController().signal, wait = waitFor }: PrivateFileOptions = {},
): Promise<Blob> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      const delay = FILE_RETRY_DELAYS_MS[attempt];
      if (!isApiError(error) || error.status !== 429 || delay === undefined) throw error;
      await wait(delay, signal);
      if (signal.aborted) throw abortError();
    }
  }
}
