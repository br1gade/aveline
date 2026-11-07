import { useCallback, useEffect, useRef, useState } from 'react';

import { browserSession } from '@/api/session';
import { waitFor } from '@/lib/poll';

import { getSnapshot, listSnapshots } from '../api';
import { followSnapshots } from '../follow';
import { endedIn, mergeSnapshots } from '../list';
import { isActive } from '../states';
import type { Snapshot } from '../types';

export interface SnapshotList {
  snapshots: readonly Snapshot[];
  /** The reading stopped after about three minutes with exports still going. */
  isTimedOut: boolean;
  /** Lays a read over the list on screen. */
  apply: (read: readonly Snapshot[]) => void;
  /** Reads again whatever is going, from the start of the waits. */
  follow: () => void;
  /** Reads the whole history again and puts it on screen; `undefined` when the read failed. */
  reload: () => Promise<Snapshot[] | undefined>;
}

/**
 * The history on screen, read again while anything is going (design PD-75): exports found going
 * when the page opens, and every one started here. One follower serves the page; starting another
 * export starts it again with everything going. Leaving the page stops the reading, never the
 * exports. `onEnded` hears each export that ended, to say so in the status line.
 */
export function useSnapshotList(
  eventId: string,
  initial: readonly Snapshot[],
  onEnded: (ended: readonly Snapshot[]) => void,
): SnapshotList {
  const [snapshots, setSnapshots] = useState<readonly Snapshot[]>(initial);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const current = useRef<readonly Snapshot[]>(initial);
  const stop = useRef<AbortController | null>(null);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  });

  const show = useCallback((next: readonly Snapshot[], read: readonly Snapshot[]) => {
    const ended = endedIn(current.current, read);
    current.current = next;
    setSnapshots(next);
    if (ended.length > 0) onEndedRef.current(ended);
  }, []);
  const apply = useCallback(
    (read: readonly Snapshot[]) => show(mergeSnapshots(current.current, read), read),
    [show],
  );

  /** Starts the one follower over everything going; the reading before it stops. */
  const start = useCallback(() => {
    stop.current?.abort();
    const controller = new AbortController();
    stop.current = controller;
    const { api } = browserSession();
    void followSnapshots({
      ids: current.current.filter(isActive).map((each) => each.id),
      readOne: (id) => getSnapshot(api, eventId, id),
      readAll: () => listSnapshots(api, eventId),
      onRead: apply,
      wait: waitFor,
      signal: controller.signal,
    }).then((isDone) => {
      if (!controller.signal.aborted && !isDone) setIsTimedOut(true);
    });
  }, [eventId, apply]);
  const follow = useCallback(() => {
    setIsTimedOut(false);
    start();
  }, [start]);

  const reload = useCallback(async () => {
    const read = await listSnapshots(browserSession().api, eventId).catch(() => undefined);
    if (read) show(read, read);
    return read;
  }, [eventId, show]);

  useEffect(() => {
    start();
    return () => stop.current?.abort();
  }, [start]);
  return { snapshots, isTimedOut, apply, follow, reload };
}
