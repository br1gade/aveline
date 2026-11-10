import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { isApiError } from '@/api/errors';
import { browserSession } from '@/api/session';
import { problemFrom, type Problem } from '@/api/problems';
import { waitFor } from '@/lib/poll';

import { listDoorRoster } from '../api';
import { householdsOf } from '../read';
import { indexGuests } from '../search';
import type { DoorGuest } from '../types';

/** Coming back to the page after this long reads the roster again. */
const STALE_AFTER_MS = 60_000;
/**
 * At a hundred a page, 2,000 people. An account may make 10 requests a second and 100 a minute
 * (docs/API.md, "Rate limits"), shared with the counts, the agreements and every check-in, so a
 * read stops here and the door says the list is partial (design PD-94; FR-142 asks for more).
 */
export const MAX_ROSTER_PAGES = 20;
/** Between pages, so a read stays well under ten requests a second beside the door's others. */
const PAGE_GAP_MS = 200;

export type GuestRead =
  | { kind: 'loading' }
  | { kind: 'refused' }
  | { kind: 'failed'; problem: Problem }
  | {
      kind: 'ready';
      guests: DoorGuest[];
      /** `false` when the page limit stopped the read before the roster ended. */
      isComplete: boolean;
      /** When it was read, on this phone's clock. */
      readAt: string;
      /** The last read again failed; this is the roster from before. */
      isOutOfDate: boolean;
    };

/** The roster, kept when a read fails. A 403 and a failure with nothing to keep say so instead. */
function afterFailure(before: GuestRead, error: unknown): GuestRead {
  if (!isApiError(error)) throw error;
  if (error.status === 403) return { kind: 'refused' };
  return before.kind === 'ready'
    ? { ...before, isOutOfDate: true }
    : { kind: 'failed', problem: problemFrom(error) };
}

const isTooMany = (error: unknown) => isApiError(error) && error.status === 429;

/**
 * Every page, spaced out, until the roster ends or the page limit. A page refused for too many
 * requests ends the read with the pages already read, as partial, rather than losing them; a read
 * begun since (`signal`) stops this one between pages.
 */
async function readRosterWhole(eventId: string, signal: AbortSignal) {
  const { api } = browserSession();
  const guests: DoorGuest[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_ROSTER_PAGES && !signal.aborted; page += 1) {
    if (page > 0) await waitFor(PAGE_GAP_MS, signal);
    let read;
    try {
      read = await listDoorRoster(api, eventId, cursor ? { cursor } : {});
    } catch (error) {
      if (page > 0 && isTooMany(error)) return { items: guests, isComplete: false };
      throw error;
    }
    guests.push(...read.guests);
    if (!read.nextCursor || read.guests.length === 0) return { items: guests, isComplete: true };
    cursor = read.nextCursor;
  }
  return { items: guests, isComplete: false };
}

const isSameGuest = (one: DoorGuest, other: DoorGuest) =>
  JSON.stringify(one) === JSON.stringify(other);

/**
 * The people a search for one name found, in place of the rows the roster held for them, and added
 * when it held none (a walk-in, or someone past a partial read). The roster stays the same object
 * when nothing changed, so nothing is grouped or indexed again.
 */
function withRefreshed(read: GuestRead, found: readonly DoorGuest[]): GuestRead {
  if (read.kind !== 'ready' || found.length === 0) return read;
  const fresh = new Map(found.map((guest) => [guest.id, guest]));
  let isChanged = false;
  const guests = read.guests.map((guest) => {
    const next = fresh.get(guest.id);
    if (!next) return guest;
    fresh.delete(guest.id);
    if (isSameGuest(guest, next)) return guest;
    isChanged = true;
    return next;
  });
  const added = [...fresh.values()];
  if (!isChanged && added.length === 0) return read;
  return { ...read, guests: [...guests, ...added] };
}

/** Coming back to the page after a minute reads the roster again. */
function useReadOnReturn(reload: () => Promise<void>, lastRead: RefObject<number>) {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRead.current >= STALE_AFTER_MS) void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload, lastRead]);
}

/**
 * The door roster (FR-79), read whole, page by page, and searched on this phone: so a name is found
 * in any alphabet and with its household, and the door still finds people when the signal drops. It
 * carries no token or contact. It is never polled: it is read on opening, when asked, when an answer
 * shows it out of date, and on coming back to the page; between reads a second arrival is caught by
 * the server's refusal, and after a check-in that person alone is read again. A 403 is not asked
 * again.
 *
 * `onStart` and `onRead` tell the door when a read begins and ends, so that what was written after
 * it began stays marked.
 */
export function useGuestRead(eventId: string, onStart: () => void, onRead: () => void) {
  const [read, setRead] = useState<GuestRead>({ kind: 'loading' });
  const [isReading, setIsReading] = useState(false);
  const latest = useRef(0);
  const lastRead = useRef(0);
  const isRefused = useRef(false);
  const running = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if (isRefused.current) return;
    latest.current += 1;
    const attempt = latest.current;
    running.current?.abort();
    const stop = new AbortController();
    running.current = stop;
    onStart();
    lastRead.current = Date.now();
    setIsReading(true);
    try {
      const { items, isComplete } = await readRosterWhole(eventId, stop.signal);
      if (attempt !== latest.current) return;
      const readAt = new Date().toISOString();
      setRead({ kind: 'ready', guests: items, isComplete, readAt, isOutOfDate: false });
      onRead();
    } catch (error) {
      isRefused.current = isApiError(error) && error.status === 403;
      if (attempt === latest.current) setRead((before) => afterFailure(before, error));
    } finally {
      if (attempt === latest.current) setIsReading(false);
    }
  }, [eventId, onStart, onRead]);

  /**
   * One person read again by name, after their check-in (docs/CLIENT_LARGER_REQUESTS_PLAN.md,
   * FR-79). Nothing waits on it: their row is already marked from the answer, so a failure leaves
   * that mark, and the next whole read brings the rest.
   */
  const refreshGuest = useCallback(
    async (name: string) => {
      if (isRefused.current || !name.trim()) return;
      const startedAt = latest.current;
      try {
        // One page: a name rarely matches a hundred people, and the row is marked already.
        const { guests } = await listDoorRoster(browserSession().api, eventId, { search: name });
        // A whole read begun since knows better than this answer.
        if (latest.current === startedAt) setRead((before) => withRefreshed(before, guests));
      } catch {
        // The mark from the answer stands; nothing here is the guest's or the door's to act on.
      }
    },
    [eventId],
  );

  useEffect(() => {
    void reload();
    return () => {
      latest.current += 1;
      running.current?.abort();
    };
  }, [reload]);
  useReadOnReturn(reload, lastRead);

  const guests = useMemo(() => (read.kind === 'ready' ? read.guests : []), [read]);
  const households = useMemo(() => householdsOf(guests), [guests]);
  const index = useMemo(() => indexGuests(households), [households]);
  const byId = useMemo(() => new Map(guests.map((guest) => [guest.id, guest])), [guests]);

  return { read, households, index, isReading, reload, refreshGuest, byId };
}
