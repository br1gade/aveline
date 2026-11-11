import { useState } from 'react';

import { isApiError } from '@/api/errors';

import type { Page } from '../types';

/**
 * A list read a page at a time, from the first page given or from none, which the first press reads
 * (FR-117). A new first page, as when the route reads itself again, starts it over.
 */
export function useMore<T>(first: Page<T> | null, read: (offset: number) => Promise<Page<T>>) {
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
