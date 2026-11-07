import { isApiError } from './errors';

/**
 * Every page of a list read by cursor, newest first, for a list the API gives no filter or count
 * for: the hosts' gallery (FR-47) and, at the door, who agreed (FR-78). Each caller sets `maxPages`,
 * which stops a runaway list and keeps the read inside the rate limit.
 *
 * A cursor names the last item read; if that item is removed meanwhile the backend answers 404, and
 * the read starts again once from the first page.
 */
interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface EveryPage<T> {
  items: T[];
  /** `false` when the page limit stopped the read before the list ended. */
  isComplete: boolean;
}

async function walk<T>(read: (after?: string) => Promise<Page<T>>, maxPages: number) {
  const items: T[] = [];
  let after: string | undefined;
  for (let count = 0; count < maxPages; count += 1) {
    const page = await read(after);
    items.push(...page.items);
    if (!page.nextCursor || page.items.length === 0) return { items, isComplete: true };
    after = page.nextCursor;
  }
  return { items, isComplete: false };
}

export async function readEveryPage<T>(
  read: (after?: string) => Promise<Page<T>>,
  maxPages: number,
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
