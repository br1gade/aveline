import { useCallback, useEffect, useRef, useState } from 'react';

import { isApiError } from '@/api/errors';
import { browserSession } from '@/api/session';
import { waitFor } from '@/lib/poll';

import { getSeatingJob, listSeatingJobs, startAutoSeating } from '../api';
import { createRetryKey } from '../idempotency';
import { followJob, isActive, latestJobOf } from '../jobs';
import { refusalOf, type SeatingRefusal } from '../refusals';
import type { SeatingJob } from '../types';

interface AutoSeatingArgs {
  eventId: string;
  arrangementId: string;
  /** The plan's newest run when the page loaded, from the history. */
  latest: SeatingJob | undefined;
  /** Reads the page again: the tables after a run, the history after a start. */
  reload: () => void;
}

/** A run already going for this plan, read from the history after a start was refused with 409. */
async function activeRun(eventId: string, arrangementId: string): Promise<SeatingJob | undefined> {
  const history = await listSeatingJobs(browserSession().api, eventId).catch(() => []);
  const latest = latestJobOf(history, arrangementId);
  return latest && isActive(latest) ? latest : undefined;
}

/**
 * The run on screen, read again until it ends. The run the page loaded with is followed once, if it
 * is still going, or read whole for its result; later reloads of the page do not restart that.
 */
function useFollowedJob(eventId: string, latest: SeatingJob | undefined, reload: () => void) {
  const [job, setJob] = useState<SeatingJob | null>(latest ?? null);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [hasFinishedHere, setHasFinishedHere] = useState(false);
  const [initial] = useState(latest);
  const stop = useRef<AbortController | null>(null);
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  const follow = useCallback(
    (jobId: string, isStartedHere: boolean) => {
      stop.current?.abort();
      const controller = new AbortController();
      stop.current = controller;
      const read = () => getSeatingJob(browserSession().api, eventId, jobId);
      void followJob({ read, onRead: setJob, wait: waitFor, signal: controller.signal }).then(
        (finished) => {
          if (controller.signal.aborted) return;
          if (!finished) return setIsTimedOut(true);
          setJob(finished);
          setHasFinishedHere(isStartedHere);
          reloadRef.current();
        },
      );
    },
    [eventId],
  );
  useEffect(() => {
    if (!initial) return;
    if (isActive(initial)) follow(initial.id, false);
    else
      void getSeatingJob(browserSession().api, eventId, initial.id).then(setJob, () => undefined);
    return () => stop.current?.abort();
  }, [initial, follow, eventId]);
  return { job, setJob, isTimedOut, setIsTimedOut, hasFinishedHere, follow };
}

/**
 * One plan's automatic seating (design PD-70): started with a key that makes a repeat safe, then
 * read again until it ends. A run already going, found on opening the page or met as a 409 on
 * start, is followed; a second is never started. Leaving the page stops the reading, not the run.
 */
export function useAutoSeating({ eventId, arrangementId, latest, reload }: AutoSeatingArgs) {
  const followed = useFollowedJob(eventId, latest, reload);
  const { job, setJob, setIsTimedOut, follow } = followed;
  const [isStarting, setIsStarting] = useState(false);
  const [refusal, setRefusal] = useState<SeatingRefusal | null>(null);
  const retry = useRef(createRetryKey());

  const followFrom = (started: SeatingJob) => {
    setJob(started);
    setIsTimedOut(false);
    follow(started.id, true);
  };
  const start = async () => {
    setRefusal(null);
    setIsStarting(true);
    try {
      const key = retry.current.next();
      const started = await startAutoSeating(browserSession().api, eventId, arrangementId, key);
      retry.current.settle(null);
      reload();
      followFrom(started);
    } catch (error) {
      retry.current.settle(error);
      const isConflict = isApiError(error) && error.status === 409;
      const running = isConflict ? await activeRun(eventId, arrangementId) : undefined;
      if (running) followFrom(running);
      else setRefusal(refusalOf(error, 'start'));
    } finally {
      setIsStarting(false);
    }
  };
  const checkAgain = () => (job ? followFrom(job) : undefined);
  return { ...followed, isStarting, refusal, start, checkAgain };
}
