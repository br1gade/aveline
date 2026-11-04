import { isApiError } from '@/api/errors';
import { problemFrom, type Problem } from '@/api/problems';

export type SeatingAction =
  | 'addTable'
  | 'addTables'
  | 'editTable'
  | 'removeTable'
  | 'seat'
  | 'move'
  | 'seatAgain'
  | 'unseat'
  | 'dismiss'
  | 'start'
  | 'publish'
  | 'unpublish';

type ForbiddenKey =
  'addTable' | 'editTable' | 'removeTable' | 'seat' | 'unseat' | 'start' | 'publish';
type MissingKey = 'plan' | 'table' | 'seat' | 'notSeated' | 'event';
type ConflictKey =
  | 'tableFull'
  | 'venueFull'
  | 'tableMoved'
  | 'chairTaken'
  | 'chairOutside'
  | 'seat'
  | 'tableOccupied'
  | 'start'
  | 'venueHasGuests';

/** Under the `seating` namespace's `problems.`. */
export type RefusalKey =
  | 'check'
  | 'other'
  | `forbidden.${ForbiddenKey}`
  | `missing.${MissingKey}`
  | `conflict.${ConflictKey}`;

/** A failed seating write: our words for it, and whether the page on screen is now out of date. */
export interface SeatingRefusal {
  problem: Problem;
  /** Only read for a refusal (`problem.code` `refused`). */
  key: RefusalKey;
  /** The backend's sentences, shown in English under ours where they say more. */
  messages: readonly string[];
  /** The plan changed underneath: the page reloads behind the message (docs/API.md §6). */
  isStale: boolean;
}

/** Which words a 403 and a 404 take, by what was being done. */
const BY_ACTION: Readonly<Record<SeatingAction, { forbidden: ForbiddenKey; missing: MissingKey }>> =
  {
    addTable: { forbidden: 'addTable', missing: 'plan' },
    addTables: { forbidden: 'addTable', missing: 'plan' },
    editTable: { forbidden: 'editTable', missing: 'table' },
    removeTable: { forbidden: 'removeTable', missing: 'table' },
    seat: { forbidden: 'seat', missing: 'seat' },
    move: { forbidden: 'seat', missing: 'seat' },
    seatAgain: { forbidden: 'seat', missing: 'seat' },
    unseat: { forbidden: 'unseat', missing: 'notSeated' },
    dismiss: { forbidden: 'unseat', missing: 'notSeated' },
    start: { forbidden: 'start', missing: 'plan' },
    publish: { forbidden: 'publish', missing: 'event' },
    unpublish: { forbidden: 'publish', missing: 'event' },
  };

const SEATING: readonly SeatingAction[] = ['seat', 'move', 'seatAgain'];
const TABLE_FORMS: readonly SeatingAction[] = ['addTable', 'addTables', 'editTable'];

/**
 * A seat's refusals share one status and one code (409 `CONFLICT`, FR-28), so they are told apart
 * by the backend's exact words (`seating.service.ts`, `assertSeatFits`, `assign`). **A temporary
 * stand-in**, as PD-54's are: a reworded sentence falls back to the seat's own words, never to the
 * wrong reason. The venue's comes first: it also ends "is full".
 */
const SEAT_CONFLICTS: ReadonlyArray<readonly [RegExp, ConflictKey]> = [
  [/^Venue capacity is full$/, 'venueFull'],
  [/^The table changed venue/, 'tableMoved'],
  [/^position: /, 'chairTaken'],
  [/ is full$/, 'tableFull'],
];

function seatConflictOf(messages: readonly string[]): RefusalKey {
  const found = SEAT_CONFLICTS.find(([pattern]) =>
    messages.some((message) => pattern.test(message)),
  );
  return `conflict.${found?.[1] ?? 'seat'}`;
}

function conflictKey(action: SeatingAction, messages: readonly string[]): RefusalKey {
  if (SEATING.includes(action)) return seatConflictOf(messages);
  if (action === 'removeTable') return 'conflict.tableOccupied';
  if (action === 'editTable' && messages.some((message) => message.startsWith('venueId: '))) {
    return 'conflict.venueHasGuests';
  }
  if (action === 'start') return 'conflict.start';
  return 'other';
}

function badRequestKey(action: SeatingAction, messages: readonly string[]): RefusalKey {
  if (TABLE_FORMS.includes(action)) return 'check';
  if (!SEATING.includes(action)) return 'other';
  const isPastTheTable = messages.some((message) => message.startsWith('position: outside'));
  return isPastTheTable ? 'conflict.chairOutside' : 'conflict.seat';
}

function keyOf(action: SeatingAction, status: number, messages: readonly string[]): RefusalKey {
  if (status === 403) return `forbidden.${BY_ACTION[action].forbidden}`;
  if (status === 404) return `missing.${BY_ACTION[action].missing}`;
  if (status === 409) return conflictKey(action, messages);
  if (status === 400) return badRequestKey(action, messages);
  return 'other';
}

/**
 * A 404 is something gone meanwhile; a seat's 409 or 400, and a removal's 409, are the plan
 * changing underneath. Each leaves the page out of date, so it reloads behind the words. There is no
 * permissions endpoint (FR-6), so every action is offered and a 403 explained after the fact.
 */
function isStaleAfter(action: SeatingAction, status: number): boolean {
  if (status === 404) return true;
  if (status === 409) {
    return SEATING.includes(action) || action === 'removeTable' || action === 'editTable';
  }
  return status === 400 && SEATING.includes(action);
}

export function refusalOf(error: unknown, action: SeatingAction): SeatingRefusal {
  const problem = problemFrom(error);
  const status = problem.code === 'refused' ? problem.status : 0;
  const messages = isApiError(error) ? error.messages : [];
  return {
    problem,
    key: keyOf(action, status, messages),
    messages,
    isStale: isStaleAfter(action, status),
  };
}
