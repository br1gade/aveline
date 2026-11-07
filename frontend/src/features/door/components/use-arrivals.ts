import { useCallback, useEffect, useRef, useState } from 'react';

import { isApiError } from '@/api/errors';
import { browserSession } from '@/api/session';
import { waitFor } from '@/lib/poll';

import { getArrivals } from '../api';
import { pollDelay } from '../arrival';
import type { ArrivalCounts } from '../types';

/** At most one read after a write in this long, inside the 100 a minute per account. */
const AFTER_WRITE_GAP_MS = 5_000;

export type ArrivalsProblem = 'refused' | 'failed' | null;

export interface ArrivalsRead {
  /** The last counts read, kept when a later read fails. */
  counts: ArrivalCounts | null;
  /** When they were read, on this phone's clock. */
  readAt: string | null;
  problem: ArrivalsProblem;
}

const NOTHING_YET: ArrivalsRead = { counts: null, readAt: null, problem: null };

/**
 * The counts, polled as the API asks: there is no push yet (design PD-94). Paused while the page is
 * hidden, longer between reads after each failure, and stopped by a 403, which never helps to retry.
 */
export function useArrivals(eventId: string) {
  const [read, setRead] = useState<ArrivalsRead>(NOTHING_YET);
  const lastRead = useRef(0);
  const isRefused = useRef(false);
  const afterWrite = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Whether another read could help. */
  const readNow = useCallback(async (): Promise<ArrivalsProblem> => {
    if (isRefused.current) return 'refused';
    lastRead.current = Date.now();
    try {
      const counts = await getArrivals(browserSession().api, eventId);
      setRead({ counts, readAt: new Date().toISOString(), problem: null });
      return null;
    } catch (error) {
      if (!isApiError(error)) throw error;
      isRefused.current = error.status === 403;
      const problem = isRefused.current ? 'refused' : 'failed';
      setRead((before) => ({ ...before, problem }));
      return problem;
    }
  }, [eventId]);

  useEffect(() => {
    const stop = new AbortController();
    const run = async () => {
      let failures = 0;
      while (!stop.signal.aborted) {
        if (document.visibilityState === 'visible') {
          const problem = await readNow();
          if (problem === 'refused') return;
          failures = problem ? failures + 1 : 0;
        }
        await waitFor(pollDelay(failures), stop.signal);
      }
    };
    void run();
    return () => stop.abort();
  }, [readNow]);

  useEffect(
    () => () => {
      if (afterWrite.current) clearTimeout(afterWrite.current);
    },
    [],
  );

  /** After a write: read soon, however many writes come at once. */
  const refresh = useCallback(() => {
    if (afterWrite.current) return;
    const wait = Math.max(0, lastRead.current + AFTER_WRITE_GAP_MS - Date.now());
    afterWrite.current = setTimeout(() => {
      afterWrite.current = null;
      void readNow();
    }, wait);
  }, [readNow]);

  return { read, refresh };
}
