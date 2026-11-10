import type { DoorRefusal } from './refusals';
import type { DoorAdmission, DoorArrival, DoorGuest, DoorSeat } from './types';

/**
 * What this phone knows beyond the last list read, and the outcome on screen (design PD-92, PD-94).
 * Nothing is marked before the server answers: a 409 is a routine outcome at the door, not something
 * to roll back. A linked guest and their ticket are one arrival, written once by the server, so an
 * admission marks the guest's row and an undo goes through the guest.
 */
export type DoorResult =
  | {
      kind: 'arrived';
      guestId: string;
      name: string;
      arrivedAt: string;
      seats: DoorSeat[];
      /** `false` when they declined or never answered: let in, and worth telling the host. */
      wasExpected: boolean;
    }
  /** A ticket with no guest: nothing counts it and nothing can undo it (FR-81). */
  | { kind: 'admittedUnlinked'; name: string | null; arrivedAt: string }
  | {
      kind: 'alreadyHere';
      guestId: string | null;
      name: string | null;
      arrivedAt: string | null;
      /** This phone's own earlier press, whose answer never came, probably did this. */
      isOurEarlierPress: boolean;
    }
  | {
      kind: 'ticketUsed';
      isOurEarlierPress: boolean;
      /** When it was used, whose and who holds it, when the refusal said (FR-76). */
      usedAt?: string;
      guestId?: string;
      name?: string;
    }
  | { kind: 'undone'; name: string }
  | { kind: 'refused'; refusal: DoorRefusal; guestId: string | null; name: string | null }
  /** A walk-in on the list now, whose check-in was refused: they can be checked in from it. */
  | { kind: 'addedNotHere'; refusal: DoorRefusal; guestId: string; name: string };

interface Mark {
  isHere: boolean;
  at: string | null;
  /** Which write made it, so a list read begun before it does not wipe it. */
  write: number;
}

export interface DoorState {
  /** What runs now: a guest's id, `CODE_RUNNING` or `WALK_IN_RUNNING`. One at a time. */
  running: string | null;
  marks: ReadonlyMap<string, Mark>;
  writes: number;
  /** How many writes the latest list read began after. */
  listStartedAtWrite: number;
  /** Guests whose last press got no answer. */
  lostPresses: ReadonlySet<string>;
  /** The code in the field last got no answer. The code itself is kept only in the field. */
  isCodeLost: boolean;
  result: DoorResult | null;
}

export const CODE_RUNNING = 'code';
/** A walk-in being added, before they have an id. */
export const WALK_IN_RUNNING = 'walk-in';

export const INITIAL_DOOR: DoorState = {
  running: null,
  marks: new Map(),
  writes: 0,
  listStartedAtWrite: 0,
  lostPresses: new Set(),
  isCodeLost: false,
  result: null,
};

export type DoorEvent =
  | { type: 'sent'; running: string }
  | { type: 'checkedIn'; answer: DoorArrival }
  /** Adding a walk-in was refused: nothing changed but that nothing runs. */
  | { type: 'walkInRefused' }
  | { type: 'walkInNotHere'; guestId: string; name: string; refusal: DoorRefusal }
  | { type: 'checkInRefused'; guest: DoorGuest; refusal: DoorRefusal }
  | { type: 'admitted'; answer: DoorAdmission; guest: DoorGuest | undefined }
  | { type: 'admitRefused'; refusal: DoorRefusal; nameOf: (guestId: string) => string | null }
  | { type: 'undone'; guest: DoorGuest }
  | { type: 'undoRefused'; guest: DoorGuest; refusal: DoorRefusal }
  | { type: 'listReadStarted' }
  | { type: 'listRead' }
  | { type: 'codeEdited' }
  | { type: 'dismissed' };

export interface Arrival {
  isHere: boolean;
  at: string | null;
}

export function arrivalOf(guest: DoorGuest, state: DoorState): Arrival {
  const mark = state.marks.get(guest.id);
  return mark
    ? { isHere: mark.isHere, at: mark.at }
    : { isHere: guest.arrivedAt !== null, at: guest.arrivedAt };
}

function marked(state: DoorState, guestId: string, arrival: Arrival): DoorState {
  const write = state.writes + 1;
  const marks = new Map(state.marks).set(guestId, { ...arrival, write });
  return { ...state, marks, writes: write };
}

function withoutLost(state: DoorState, guestId: string): DoorState {
  const lostPresses = new Set(state.lostPresses);
  lostPresses.delete(guestId);
  return { ...state, lostPresses };
}

function seatsOf(guest: DoorGuest | undefined): DoorSeat[] {
  return (guest?.seats ?? []).map(({ table, venue }) => ({ table, venue }));
}

function checkedIn(state: DoorState, answer: DoorArrival): DoorState {
  const next = marked(withoutLost(state, answer.guestId), answer.guestId, {
    isHere: true,
    at: answer.arrivedAt,
  });
  return { ...next, result: { kind: 'arrived', ...answer } };
}

function alreadyHere(state: DoorState, guest: DoorGuest, known: string | null): DoorState {
  const at = known ?? arrivalOf(guest, state).at;
  const isOurEarlierPress = state.lostPresses.has(guest.id);
  const next = marked(withoutLost(state, guest.id), guest.id, { isHere: true, at });
  const result: DoorResult = {
    kind: 'alreadyHere',
    guestId: guest.id,
    name: guest.name,
    arrivedAt: at,
    isOurEarlierPress,
  };
  return { ...next, result };
}

/** Added, not let in. A check-in with no answer may still have counted, as anyone else's may. */
function walkInNotHere(
  state: DoorState,
  { guestId, name, refusal }: Extract<DoorEvent, { type: 'walkInNotHere' }>,
): DoorState {
  const result: DoorResult = { kind: 'addedNotHere', guestId, name, refusal };
  return refusal.kind === 'noAnswer'
    ? { ...state, lostPresses: new Set(state.lostPresses).add(guestId), result }
    : { ...state, result };
}

function checkInRefused(state: DoorState, guest: DoorGuest, refusal: DoorRefusal): DoorState {
  if (refusal.kind === 'alreadyHere') return alreadyHere(state, guest, refusal.arrivedAt);
  // A backend that checks agreements before the arrival (before `9827cf5`, FR-77): a second arrival.
  if (refusal.kind === 'mustAgree' && arrivalOf(guest, state).isHere)
    return alreadyHere(state, guest, null);
  const result: DoorResult = { kind: 'refused', refusal, guestId: guest.id, name: guest.name };
  if (refusal.kind === 'noAnswer')
    return { ...state, lostPresses: new Set(state.lostPresses).add(guest.id), result };
  // "Too many tries" says nothing about the guest, so a lost press may still have counted.
  return refusal.kind === 'rateLimited'
    ? { ...state, result }
    : { ...withoutLost(state, guest.id), result };
}

function admitted(
  state: DoorState,
  answer: DoorAdmission,
  guest: DoorGuest | undefined,
): DoorState {
  const name = answer.holderName ?? guest?.name ?? null;
  const settled = { ...state, isCodeLost: false };
  if (answer.guestId === null) {
    const result: DoorResult = { kind: 'admittedUnlinked', name, arrivedAt: answer.admittedAt };
    return { ...settled, result };
  }
  const arrival = { isHere: true, at: answer.admittedAt };
  const result: DoorResult = {
    kind: 'arrived',
    guestId: answer.guestId,
    name: name ?? '',
    arrivedAt: answer.admittedAt,
    seats: seatsOf(guest),
    wasExpected: guest ? guest.answer === 'ATTENDING' : true,
  };
  return { ...marked(settled, answer.guestId, arrival), result };
}

type NameOf = (guestId: string) => string | null;

/** Who a refused code is about: the answer's own name, else the list's. */
function holderOf(whose: { guestId?: string; holderName?: string }, nameOf: NameOf) {
  return whose.holderName ?? (whose.guestId ? nameOf(whose.guestId) : null);
}

/** A code that says whose arrival it was, and when, marks their row here. */
function markedHere(state: DoorState, guestId: string | undefined, at: string | null | undefined) {
  return guestId && at ? marked(state, guestId, { isHere: true, at }) : state;
}

function codeUsed(
  state: DoorState,
  refusal: Extract<DoorRefusal, { kind: 'ticketUsed' }>,
  isOurEarlierPress: boolean,
  nameOf: NameOf,
): DoorState {
  const name = holderOf(refusal, nameOf);
  const result: DoorResult = {
    kind: 'ticketUsed',
    isOurEarlierPress,
    ...(refusal.usedAt ? { usedAt: refusal.usedAt } : {}),
    ...(refusal.guestId ? { guestId: refusal.guestId } : {}),
    ...(name ? { name } : {}),
  };
  return { ...markedHere(state, refusal.guestId, refusal.usedAt), result };
}

function codeAlreadyHere(
  state: DoorState,
  refusal: Extract<DoorRefusal, { kind: 'alreadyHere' }>,
  isOurEarlierPress: boolean,
  nameOf: NameOf,
): DoorState {
  const result: DoorResult = {
    kind: 'alreadyHere',
    guestId: refusal.guestId ?? null,
    name: holderOf(refusal, nameOf),
    arrivedAt: refusal.arrivedAt,
    isOurEarlierPress,
  };
  return { ...markedHere(state, refusal.guestId, refusal.arrivedAt), result };
}

function admitRefused(state: DoorState, refusal: DoorRefusal, nameOf: NameOf): DoorState {
  const isOurEarlierPress = state.isCodeLost;
  const isStillLost = refusal.kind === 'rateLimited' && state.isCodeLost;
  const settled = { ...state, isCodeLost: refusal.kind === 'noAnswer' || isStillLost };
  if (refusal.kind === 'ticketUsed') return codeUsed(settled, refusal, isOurEarlierPress, nameOf);
  if (refusal.kind === 'alreadyHere')
    return codeAlreadyHere(settled, refusal, isOurEarlierPress, nameOf);
  const guestId = refusal.kind === 'mustAgree' ? refusal.guestId : null;
  const name = refusal.kind === 'mustAgree' ? holderOf(refusal, nameOf) : null;
  return { ...settled, result: { kind: 'refused', refusal, guestId, name } };
}

function undone(state: DoorState, guest: DoorGuest): DoorState {
  const next = marked(withoutLost(state, guest.id), guest.id, { isHere: false, at: null });
  return { ...next, result: { kind: 'undone', name: guest.name } };
}

function undoRefused(state: DoorState, guest: DoorGuest, refusal: DoorRefusal): DoorState {
  if (refusal.kind === 'notCheckedIn') return undone(state, guest);
  return { ...state, result: { kind: 'refused', refusal, guestId: guest.id, name: guest.name } };
}

/** The list now knows everything written before its read began; what came later stays marked. */
function listRead(state: DoorState): DoorState {
  const marks = new Map(
    [...state.marks].filter(([, mark]) => mark.write > state.listStartedAtWrite),
  );
  return { ...state, marks };
}

/** What no write's answer brought: nothing here ends what is running. */
function quietChange(
  state: DoorState,
  event: Extract<DoorEvent, { type: 'listReadStarted' | 'listRead' | 'codeEdited' | 'dismissed' }>,
): DoorState {
  switch (event.type) {
    case 'listReadStarted':
      return { ...state, listStartedAtWrite: state.writes };
    case 'listRead':
      return listRead(state);
    case 'codeEdited':
      return { ...state, isCodeLost: false };
    default:
      return { ...state, result: null };
  }
}

export function doorReducer(state: DoorState, event: DoorEvent): DoorState {
  const settled = { ...state, running: null };
  switch (event.type) {
    case 'sent':
      return { ...state, running: event.running };
    case 'checkedIn':
      return checkedIn(settled, event.answer);
    case 'walkInRefused':
      return settled;
    case 'walkInNotHere':
      return walkInNotHere(settled, event);
    case 'checkInRefused':
      return checkInRefused(settled, event.guest, event.refusal);
    case 'admitted':
      return admitted(settled, event.answer, event.guest);
    case 'admitRefused':
      return admitRefused(settled, event.refusal, event.nameOf);
    case 'undone':
      return undone(settled, event.guest);
    case 'undoRefused':
      return undoRefused(settled, event.guest, event.refusal);
    default:
      return quietChange(state, event);
  }
}

const POLL_MS = 20_000;
const LONGEST_POLL_MS = 120_000;

/** How long the counts wait before their next read: longer after each failure in a row. */
export function pollDelay(failures: number): number {
  return Math.min(POLL_MS * 2 ** failures, LONGEST_POLL_MS);
}
