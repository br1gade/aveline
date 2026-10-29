import { isApiError } from '@/api/errors';

/**
 * Every page of a list read by cursor, newest first. The hosts' gallery has no status filter and no
 * counts (FR-47), so the moderation page reads it whole and sorts it into tabs: **a stand-in** until
 * FR-47 is answered. At 100 a page, 1,000 photos are ten reads; `maxPages` stops a runaway list.
 *
 * A cursor names the last item read; if that item is removed meanwhile the backend answers 404, and
 * the read starts again once from the first page.
 */
export const MAX_GALLERY_PAGES = 11;

interface Page<T> {
  photos: T[];
  nextCursor: string | null;
}

export interface EveryPage<T> {
  photos: T[];
  /** `false` when the page limit stopped the read before the list ended. */
  isComplete: boolean;
}

async function walk<T>(read: (after?: string) => Promise<Page<T>>, maxPages: number) {
  const photos: T[] = [];
  let after: string | undefined;
  for (let count = 0; count < maxPages; count += 1) {
    const page = await read(after);
    photos.push(...page.photos);
    if (!page.nextCursor || page.photos.length === 0) return { photos, isComplete: true };
    after = page.nextCursor;
  }
  return { photos, isComplete: false };
}

export async function readEveryPage<T>(
  read: (after?: string) => Promise<Page<T>>,
  maxPages = MAX_GALLERY_PAGES,
): Promise<EveryPage<T>> {
  let isFirstCursorGone = false;
  const tracked = async (after?: string) => {
    try {
      return await read(after);
    } catch (error) {
      if (after !== undefined && isApiError(error) && error.status === 404)
        isFirstCursorGone = true;
      throw error;
    }
  };
  try {
    return await walk(tracked, maxPages);
  } catch (error) {
    if (!isFirstCursorGone) throw error;
    return walk(read, maxPages);
  }
}
