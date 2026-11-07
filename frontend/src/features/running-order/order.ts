import type { OrderVenue, TimelineEntry } from './types';

/** The backend's cap on `sortOrder` (`UpsertTimelineEntryDto`). */
const MAX_SORT_ORDER = 1000;

function minuteOf(iso: string): number {
  return Math.floor(Date.parse(iso) / 60_000);
}

/**
 * Where an entry goes among those at the same minute: last. The backend orders by time, then by
 * `sortOrder`, which only breaks ties, so the client sets it (design PD-107). An entry moved here
 * comes from another minute, so it is never among them.
 */
export function sortOrderFor(entries: readonly TimelineEntry[], occursAt: string): number {
  const minute = minuteOf(occursAt);
  const tied = entries.filter((entry) => minuteOf(entry.occursAt) === minute);
  if (tied.length === 0) return 0;
  return Math.min(MAX_SORT_ORDER, Math.max(...tied.map((entry) => entry.sortOrder)) + 1);
}

export function isSameMinute(a: string, b: string): boolean {
  return minuteOf(a) === minuteOf(b);
}

/** What a press would do to the list: an entry saved (new when it has no id), or removed. */
export type EntryChange =
  | { kind: 'save'; id?: string | undefined; venueId: string | null; isInternal: boolean }
  | { kind: 'remove'; id: string };

type Placement = Pick<TimelineEntry, 'id' | 'venueId' | 'isInternal'>;

function placementsAfter(entries: readonly Placement[], change: EntryChange): Placement[] {
  if (change.kind === 'remove') return entries.filter((entry) => entry.id !== change.id);
  const saved = { id: change.id ?? '', venueId: change.venueId, isInternal: change.isInternal };
  return change.id
    ? entries.map((entry) => (entry.id === change.id ? saved : entry))
    : [...entries, saved];
}

/**
 * The backend's rule (`guest-facing-venues.ts`): a venue guests see is one that isn't for getting
 * ready, and whose running-order entries are not all for the team.
 */
function guestFacingIds(venues: readonly OrderVenue[], entries: readonly Placement[]): Set<string> {
  const facing = venues.filter((venue) => {
    if (venue.role === 'PREPARATION') return false;
    const here = entries.filter((entry) => entry.venueId === venue.id);
    return here.length === 0 || here.some((entry) => !entry.isInternal);
  });
  return new Set(facing.map((venue) => venue.id));
}

/**
 * The venues guests see now and would no longer see after the change: marking a venue's last
 * guest entry for the team takes the venue off the invitation and out of answering per venue.
 */
export function venuesHiddenBy(
  venues: readonly OrderVenue[],
  entries: readonly Placement[],
  change: EntryChange,
): OrderVenue[] {
  const before = guestFacingIds(venues, entries);
  const after = guestFacingIds(venues, placementsAfter(entries, change));
  return venues.filter((venue) => before.has(venue.id) && !after.has(venue.id));
}
