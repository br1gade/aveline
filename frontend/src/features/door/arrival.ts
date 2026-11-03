import type { Guest } from '@/features/guests';

import type { DoorRefusal } from './refusals';
import type { DoorAdmission, DoorArrival, DoorSeat } from './types';

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
  | { kind: 'ticketUsed'; isOurEarlierPress: boolean }
  | { kind: 'undone'; name: string }
  | { kind: 'refused'; refusal: DoorRefusal; guestId: string | null; name: string | null };

interface Mark {
  isHere: boolean;
  at: string | null;
  /** Which write made it, so a list read begun before it does not wipe it. */
  write: number;
}

export interface DoorState {
  /** What runs now: a guest's id, or `CODE_RUNNING`. One at a time. */
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
  | { type: 'checkedIn'; guest: Guest; answer: DoorArrival }
  | { type: 'checkInRefused'; guest: Guest; refusal: DoorRefusal }
  | { type: 'admitted'; answer: DoorAdmission; guest: Guest | undefined }
  | { type: 'admitRefused'; refusal: DoorRefusal; nameOf: (guestId: string) => string | null }
  | { type: 'undone'; guest: Guest }
  | { type: 'undoRefused'; guest: Guest; refusal: DoorRefusal }
  | { type: 'listReadStarted' }
  | { type: 'listRead' }
  | { type: 'codeEdited' }
  | { type: 'dismissed' };

export interface Arrival {
  isHere: boolean;
  at: string | null;
}

export function arrivalOf(guest: Guest, state: DoorState): Arrival {
  const mark = state.marks.get(guest.id);
  return mark
    ? { isHere: mark.isHere, at: mark.at }
    : { isHere: guest.isCheckedIn, at: guest.arrivedAt };
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

function seatsOf(guest: Guest | undefined): DoorSeat[] {
  return (guest?.seats ?? []).map(({ table, venue }) => ({ table, venue }));
}

function checkedIn(state: DoorState, guest: Guest, answer: DoorArrival): DoorState {
  const next = marked(withoutLost(state, guest.id), guest.id, {
    isHere: true,
    at: answer.arrivedAt,
  });
  return { ...next, result: { kind: 'arrived', ...answer } };
}

function alreadyHere(state: DoorState, guest: Guest, known: string | null): DoorState {
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

function checkInRefused(state: DoorState, guest: Guest, refusal: DoorRefusal): DoorState {
  if (refusal.kind === 'alreadyHere') return alreadyHere(state, guest, refusal.arrivedAt);
  // The agreement gate runs before the arrival check (FR-77): this is a second arrival.
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

function admitted(state: DoorState, answer: DoorAdmission, guest: Guest | undefined): DoorState {
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

function admitRefused(
  state: DoorState,
  refusal: DoorRefusal,
  nameOf: (guestId: string) => string | null,
): DoorState {
  const isOurEarlierPress = state.isCodeLost;
  const isStillLost = refusal.kind === 'rateLimited' && state.isCodeLost;
  const settled = { ...state, isCodeLost: refusal.kind === 'noAnswer' || isStillLost };
  if (refusal.kind === 'ticketUsed')
    return { ...settled, result: { kind: 'ticketUsed', isOurEarlierPress } };
  if (refusal.kind === 'alreadyHere') {
    const { arrivedAt } = refusal;
    const result: DoorResult = {
      kind: 'alreadyHere',
      guestId: null,
      name: null,
      arrivedAt,
      isOurEarlierPress,
    };
    return { ...settled, result };
  }
  const guestId = refusal.kind === 'mustAgree' ? refusal.guestId : null;
  const name = guestId === null ? null : nameOf(guestId);
  return { ...settled, result: { kind: 'refused', refusal, guestId, name } };
}

function undone(state: DoorState, guest: Guest): DoorState {
  const next = marked(withoutLost(state, guest.id), guest.id, { isHere: false, at: null });
  return { ...next, result: { kind: 'undone', name: guest.name } };
}

function undoRefused(state: DoorState, guest: Guest, refusal: DoorRefusal): DoorState {
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
      return checkedIn(settled, event.guest, event.answer);
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
