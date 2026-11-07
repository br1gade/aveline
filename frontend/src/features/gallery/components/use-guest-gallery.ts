import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiClient } from '@/api/client';
import { isApiError } from '@/api/errors';
import { problemFrom, type Problem } from '@/api/problems';
import { pollUntil, waitFor } from '@/lib/poll';

import { listGuestGallery, removeOwnPhoto, type GalleryLink } from '../api';
import { withFirstPage, withNextPage, withoutPhoto, withShared } from '../list';
import { isSettled } from '../status';
import type { GalleryPage, GalleryPhoto } from '../types';

/**
 * After a share, the first page is read again until the new photos are prepared or failed. No read
 * of one upload exists (FR-41); the waits grow, as the drawn signature's do, about half a minute in
 * all, after which the photos keep their "being prepared" state until the next read.
 */
export const SHARE_POLL_DELAYS_MS: readonly number[] = [
  1000, 2000, 4000, 4000, 4000, 5000, 5000, 5000,
];

/** The list's own state: not read yet, read, refused (the link closed: 404), or failed. */
export type ListState =
  | { kind: 'waiting' }
  | { kind: 'ready' }
  | { kind: 'closed' }
  | { kind: 'failed'; problem: Problem };

export type RemoveResult = 'removed' | 'gone' | Problem;

function stateOf(error: unknown): ListState {
  if (isApiError(error) && error.status === 404) return { kind: 'closed' };
  return { kind: 'failed', problem: problemFrom(error) };
}

function useFirstPage(api: ApiClient, link: GalleryLink, isWanted: boolean) {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<ListState>({ kind: 'waiting' });
  const [attempt, setAttempt] = useState(0);
  const { slug, guestToken } = link;
  useEffect(() => {
    if (!isWanted) return;
    let isCurrent = true;
    listGuestGallery(api, { slug, guestToken }).then(
      (page) => {
        if (!isCurrent) return;
        setPhotos((held) => withFirstPage(held, page));
        setNextCursor(page.nextCursor);
        setState({ kind: 'ready' });
      },
      (error: unknown) => {
        if (isCurrent) setState(stateOf(error));
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [api, slug, guestToken, isWanted, attempt]);
  const retry = () => {
    setState({ kind: 'waiting' });
    setAttempt((count) => count + 1);
  };
  return { photos, setPhotos, nextCursor, setNextCursor, state, setState, retry };
}

/** Reads the first page again until the photos just shared are prepared or failed. */
function useSharePoll(api: ApiClient, link: GalleryLink, fold: (page: GalleryPage) => void) {
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);
  return useCallback(
    (ids: readonly string[]) => {
      stop.current?.abort();
      const current = new AbortController();
      stop.current = current;
      const read = async () => {
        const page = await listGuestGallery(api, link);
        fold(page);
        const pending = page.photos.filter((item) => ids.includes(item.id) && !isSettled(item));
        return pending.length === 0;
      };
      const delays = SHARE_POLL_DELAYS_MS;
      void pollUntil({ read, isDone: Boolean, delays, wait: waitFor, signal: current.signal });
    },
    [api, link, fold],
  );
}

/**
 * The guest's gallery (docs/API.md §11; design PD-63): read once the section nears the screen, a
 * hundred at a time, their own photos in any state and other guests' approved ones.
 */
export function useGuestGallery(api: ApiClient, link: GalleryLink, isWanted: boolean) {
  const first = useFirstPage(api, link, isWanted);
  const { setPhotos, setNextCursor, setState, nextCursor } = first;
  const [more, setMore] = useState<'idle' | 'loading' | Problem>('idle');
  const fold = useCallback(
    (page: GalleryPage) => setPhotos((held) => withFirstPage(held, page)),
    [setPhotos],
  );
  const poll = useSharePoll(api, link, fold);
  /** The first page again, quietly: a link that closed meanwhile (404) closes the gallery. */
  const refresh = async () => {
    try {
      fold(await listGuestGallery(api, link));
    } catch (error) {
      if (isApiError(error) && error.status === 404) setState({ kind: 'closed' });
    }
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setMore('loading');
    try {
      const page = await listGuestGallery(api, link, nextCursor);
      setPhotos((held) => withNextPage(held, page));
      setNextCursor(page.nextCursor);
      setMore('idle');
    } catch (error) {
      if (isApiError(error) && error.status === 404) setState({ kind: 'closed' });
      setMore(problemFrom(error));
    }
  };
  const shared = (photos: GalleryPhoto[]) => {
    if (photos.length === 0) return;
    setPhotos((held) => withShared(held, photos));
    poll(photos.map((item) => item.id));
  };
  const remove = async (id: string): Promise<RemoveResult> => {
    try {
      await removeOwnPhoto(api, link, id);
      setPhotos((held) => withoutPhoto(held, id));
      return 'removed';
    } catch (error) {
      if (!isApiError(error) || error.status !== 404) return problemFrom(error);
      // Already gone, or the link closed: the list is read again to tell which.
      setPhotos((held) => withoutPhoto(held, id));
      void refresh();
      return 'gone';
    }
  };
  return { ...first, more, loadMore, shared, remove };
}
