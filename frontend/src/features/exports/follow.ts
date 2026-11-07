import { pollUntil } from '@/lib/poll';

import { isActive } from './states';
import type { Snapshot } from './types';

/**
 * About three minutes, as automatic seating's: soon at first, as most files are made within
 * seconds, then every five seconds. An export outlives the page; the page offers to look again
 * rather than read on.
 */
export const POLL_DELAYS: readonly number[] = [1000, 2000, 3000, ...Array<number>(35).fill(5000)];

interface FollowOptions {
  /** The exports still going. */
  ids: readonly string[];
  readOne: (id: string) => Promise<Snapshot>;
  /** The history, which holds every export going within the newest fifty. */
  readAll: () => Promise<Snapshot[]>;
  /** Each read, so the page can say where each export stands. */
  onRead: (read: Snapshot[]) => void;
  wait: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  delays?: readonly number[];
}

/**
 * Reads the exports going until each has ended (design PD-75). **One read a tick:** the export's
 * own while one is followed, the history while several are, so ten exports cost what one does
 * against the account's hundred requests a minute. One the history no longer lists is let go.
 * Resolves `true` once all ended, `false` when the waits ran out or the page left.
 */
export async function followSnapshots(options: FollowOptions): Promise<boolean> {
  const { readOne, readAll, onRead, wait, signal, delays = POLL_DELAYS } = options;
  const going = new Set(options.ids);
  if (going.size === 0) return true;
  const left = await pollUntil({
    read: async () => {
      const [only] = going;
      const read = going.size === 1 && only ? [await readOne(only)] : await readAll();
      if (signal.aborted) return undefined;
      onRead(read);
      for (const id of going) {
        const found = read.find((each) => each.id === id);
        if (!found || !isActive(found)) going.delete(id);
      }
      return going.size;
    },
    isDone: (count) => count === 0,
    delays,
    wait,
    signal,
  });
  return left === 0;
}
