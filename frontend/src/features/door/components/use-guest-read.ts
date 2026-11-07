import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isApiError } from '@/api/errors';
import { browserSession } from '@/api/session';
import { problemFrom, type Problem } from '@/api/problems';
import { listGuests, type Guest, type Household } from '@/features/guests';

import { readDeadline } from '../api';
import { indexGuests, type GuestIndex } from '../search';

/** Coming back to the page after this long reads the list again. */
const STALE_AFTER_MS = 60_000;

export type GuestRead =
  | { kind: 'loading' }
  | { kind: 'refused' }
  | { kind: 'failed'; problem: Problem }
  | {
      kind: 'ready';
      households: Household[];
      index: GuestIndex;
      /** When it was read, on this phone's clock. */
      readAt: string;
      /** The last read again failed; this is the list from before. */
      isOutOfDate: boolean;
    };

/** The list, kept when a read fails. A 403 and a failure with nothing to keep say so instead. */
function afterFailure(before: GuestRead, error: unknown): GuestRead {
  if (!isApiError(error)) throw error;
  if (error.status === 403) return { kind: 'refused' };
  return before.kind === 'ready'
    ? { ...before, isOutOfDate: true }
    : { kind: 'failed', problem: problemFrom(error) };
}

/**
 * The guest list, through its own reader, which drops every token (FR-79). It is never polled: it is
 * the event's largest read. It is read on opening, when asked, when an answer shows it out of date,
 * and on coming back to the page; between reads a second arrival is caught by the server's refusal.
 * A 403 is not asked again.
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

  const reload = useCallback(async () => {
    if (isRefused.current) return;
    latest.current += 1;
    const attempt = latest.current;
    onStart();
    lastRead.current = Date.now();
    setIsReading(true);
    try {
      const households = await listGuests(browserSession().api, eventId, readDeadline());
      if (attempt !== latest.current) return;
      setRead({
        kind: 'ready',
        households,
        index: indexGuests(households),
        readAt: new Date().toISOString(),
        isOutOfDate: false,
      });
      onRead();
    } catch (error) {
      isRefused.current = isApiError(error) && error.status === 403;
      if (attempt === latest.current) setRead((before) => afterFailure(before, error));
    } finally {
      if (attempt === latest.current) setIsReading(false);
    }
  }, [eventId, onStart, onRead]);

  useEffect(() => {
    void reload();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRead.current >= STALE_AFTER_MS) void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      latest.current += 1;
    };
  }, [reload]);

  const byId = useMemo(
    () =>
      new Map<string, Guest>(
        read.kind === 'ready'
          ? read.households.flatMap(({ guests }) => guests.map((guest) => [guest.id, guest]))
          : [],
      ),
    [read],
  );

  return { read, isReading, reload, byId };
}
