import { isActive, NEWEST } from './states';
import type { Snapshot } from './types';

/**
 * What a read says, laid over what is on screen: each export read replaces its old self, any new
 * one joins, newest first, and the list keeps the newest fifty as the API's does.
 */
export function mergeSnapshots(
  current: readonly Snapshot[],
  read: readonly Snapshot[],
): Snapshot[] {
  const byId = new Map(current.map((each) => [each.id, each]));
  for (const each of read) byId.set(each.id, each);
  return [...byId.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, NEWEST);
}

/** The exports that were going on screen and have ended in this read, for the status line. */
export function endedIn(before: readonly Snapshot[], read: readonly Snapshot[]): Snapshot[] {
  const wasGoing = new Set(before.filter(isActive).map((each) => each.id));
  return read.filter((each) => wasGoing.has(each.id) && !isActive(each));
}
