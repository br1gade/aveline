import { useState } from 'react';

import { isApiError, type ApiError } from '@/api/errors';

/** One page of a list read by offset, and where the next starts, if there is one. */
export interface OffsetPage<T> {
  items: T[];
  nextOffset: number | null;
}

/**
 * A list read a page at a time, from the first page given or from none, which the first press reads
 * (the answers and guest book, FR-117; who must not be contacted, FR-99). A new first page, as when
 * the route reads itself again, starts it over.
 */
export function useMore<T>(
  first: OffsetPage<T> | null,
  read: (offset: number) => Promise<OffsetPage<T>>,
) {
  const [shown, setShown] = useState(first);
  const [items, setItems] = useState<T[] | null>(first?.items ?? null);
  const [nextOffset, setNextOffset] = useState<number | null>(first ? first.nextOffset : 0);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  if (shown !== first) {
    setShown(first);
    setItems(first?.items ?? null);
    setNextOffset(first ? first.nextOffset : 0);
    setState('idle');
  }
  const more = async () => {
    if (nextOffset === null) return;
    setState('loading');
    try {
      const page = await read(nextOffset);
      setItems((held) => [...(held ?? []), ...page.items]);
      setNextOffset(page.nextOffset);
      setState('idle');
    } catch (error) {
      if (!isApiError(error)) throw error;
      setState('failed');
    }
  };
  return { items, hasMore: nextOffset !== null, state, more: () => void more() };
}

/** One page of a list read by cursor (docs/API.md §1), and the cursor that continues it. */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * A list read by cursor from a first page the route read, with "Show more" for the rest (customers,
 * data requests, invoices, access reviews). Pages read later belong to the first page they followed,
 * so a new one, as when the route reads itself again after a change, starts the list over. A refusal
 * is kept for the feature to word; anything but an API error is thrown.
 */
export function useMoreByCursor<T>(
  first: CursorPage<T>,
  read: (cursor: string) => Promise<CursorPage<T>>,
) {
  const [more, setMore] = useState<{ after: CursorPage<T>; pages: CursorPage<T>[] } | null>(null);
  const [failure, setFailure] = useState<{ after: CursorPage<T>; error: ApiError } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const pages = more?.after === first ? more.pages : [];
  const last = pages.at(-1) ?? first;
  const readMore = async () => {
    if (!last.nextCursor) return;
    setFailure(null);
    setIsLoading(true);
    try {
      const next = await read(last.nextCursor);
      setMore({ after: first, pages: [...pages, next] });
    } catch (error) {
      if (!isApiError(error)) throw error;
      setFailure({ after: first, error });
    } finally {
      setIsLoading(false);
    }
  };
  return {
    items: [first, ...pages].flatMap((page) => page.items),
    hasMore: last.nextCursor !== null,
    isLoading,
    error: failure?.after === first ? failure.error : null,
    more: () => void readMore(),
  };
}
