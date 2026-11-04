import { isApiError } from '@/api/errors';

import type { GalleryPhoto } from './types';

export interface BatchApproval {
  approved: GalleryPhoto[];
  /** Changed or removed meanwhile: the page is out of date, and the rest can still go. */
  gone: string[];
  /** Not reached: kept chosen, for pressing again. */
  rest: string[];
  /** What stopped it; `null` when every photo was tried. */
  stop: unknown;
}

const PHOTO_ALONE: ReadonlySet<number> = new Set([404, 409]);

/**
 * Approves several photos, one request each, in order (design PD-136). **A temporary stand-in** under
 * FR-112: the API moderates one photo a request, at the default allowance of 100 a minute. A photo
 * gone meanwhile (404, 409) doesn't bear on the next; anything else would refuse it too, so it stops
 * there, with the rest kept chosen. Deleted when the backend moderates several in one request.
 */
export async function approveOneByOne(
  ids: readonly string[],
  approve: (id: string) => Promise<GalleryPhoto>,
  onProgress?: (position: number) => void,
): Promise<BatchApproval> {
  const outcome: BatchApproval = { approved: [], gone: [], rest: [], stop: null };
  for (const [index, id] of ids.entries()) {
    onProgress?.(index + 1);
    try {
      outcome.approved.push(await approve(id));
    } catch (error) {
      if (!isApiError(error)) throw error;
      if (!PHOTO_ALONE.has(error.status)) {
        return { ...outcome, rest: ids.slice(index), stop: error };
      }
      outcome.gone.push(id);
    }
  }
  return outcome;
}
