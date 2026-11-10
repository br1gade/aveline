import { describe, expect, it } from 'vitest';

import {
  arrivalOf,
  doorReducer,
  INITIAL_DOOR,
  WALK_IN_RUNNING,
  pollDelay,
  type DoorEvent,
  type DoorState,
} from './arrival';
import type { DoorRefusal } from './refusals';
import { doorGuest } from './test-data';

const ARRIVED_AT = '2026-10-05T18:02:11.000Z';
const LATER = '2026-10-05T18:30:00.000Z';

const armen = doorGuest('g1', 'Armen Petrosyan');
const answer = {
  guestId: 'g1',
  name: 'Armen Petrosyan',
  arrivedAt: ARRIVED_AT,
  seats: [{ table: 'Table 4', venue: 'Hall' }],
  wasExpected: true,
};

function play(...events: DoorEvent[]): DoorState {
  return events.reduce(doorReducer, INITIAL_DOOR);
}

const refusedCheckIn = (refusal: DoorRefusal, guest = armen): DoorEvent => ({
  type: 'checkInRefused',
  guest,
  refusal,
});
const noAnswer: DoorRefusal = { kind: 'noAnswer' };

describe('checking someone in', () => {
  it('marks them here and says so, with their table', () => {
    const state = play({ type: 'sent', running: 'g1' }, { type: 'checkedIn', answer });
    expect(state.running).toBeNull();
    expect(arrivalOf(armen, state)).toEqual({ isHere: true, at: ARRIVED_AT });
    expect(state.result).toMatchObject({
      kind: 'arrived',
      name: 'Armen Petrosyan',
      seats: [{ table: 'Table 4', venue: 'Hall' }],
      wasExpected: true,
      guestId: 'g1',
    });
  });

  it('flags someone who declined or never answered, who is let in all the same', () => {
    const state = play({
      type: 'checkedIn',
      answer: { ...answer, wasExpected: false },
    });
    expect(state.result).toMatchObject({ kind: 'arrived', wasExpected: false });
    expect(arrivalOf(armen, state).isHere).toBe(true);
  });

  it('reads a second check-in as already here, with the first arrival’s time', () => {
    const state = play(refusedCheckIn({ kind: 'alreadyHere', arrivedAt: ARRIVED_AT }));
    expect(state.result).toEqual({
      kind: 'alreadyHere',
      guestId: 'g1',
      name: 'Armen Petrosyan',
      arrivedAt: ARRIVED_AT,
      isOurEarlierPress: false,
    });
    expect(arrivalOf(armen, state)).toEqual({ isHere: true, at: ARRIVED_AT });
  });

  it('fills a used ticket’s missing time from the list, when it knows', () => {
    const known = doorGuest('g1', 'Armen', { isCheckedIn: true, arrivedAt: ARRIVED_AT });
    const state = play(refusedCheckIn({ kind: 'alreadyHere', arrivedAt: null }, known));
    expect(state.result).toMatchObject({ kind: 'alreadyHere', arrivedAt: ARRIVED_AT });
  });

  it('says already here with no time when nothing knows it', () => {
    const state = play(refusedCheckIn({ kind: 'alreadyHere', arrivedAt: null }));
    expect(state.result).toMatchObject({ kind: 'alreadyHere', arrivedAt: null });
    expect(arrivalOf(armen, state)).toEqual({ isHere: true, at: null });
  });

  it('reads the agreement gate as already here for someone the list shows has arrived', () => {
    const here = doorGuest('g1', 'Armen', { isCheckedIn: true, arrivedAt: ARRIVED_AT });
    const state = play(
      refusedCheckIn({ kind: 'mustAgree', guestId: 'g1', questionId: 'q1' }, here),
    );
    expect(state.result).toMatchObject({ kind: 'alreadyHere', arrivedAt: ARRIVED_AT });
  });

  it('keeps the agreement refusal for someone not here', () => {
    const refusal: DoorRefusal = { kind: 'mustAgree', guestId: 'g1', questionId: 'q1' };
    const state = play(refusedCheckIn(refusal));
    expect(state.result).toEqual({
      kind: 'refused',
      refusal,
      guestId: 'g1',
      name: 'Armen Petrosyan',
    });
    expect(arrivalOf(armen, state).isHere).toBe(false);
  });
});

describe('a walk-in, added and checked in at the door (PD-148)', () => {
  it('marks them here and says they weren’t expected', () => {
    const state = play(
      { type: 'sent', running: 'g9' },
      {
        type: 'checkedIn',
        answer: { ...answer, guestId: 'g9', name: 'Narek', wasExpected: false },
      },
    );
    expect(state.running).toBeNull();
    expect(arrivalOf(doorGuest('g9', 'Narek'), state)).toEqual({ isHere: true, at: ARRIVED_AT });
    expect(state.result).toMatchObject({ kind: 'arrived', guestId: 'g9', wasExpected: false });
  });

  it('frees the door for the next write when adding them is refused', () => {
    const state = play({ type: 'sent', running: WALK_IN_RUNNING }, { type: 'walkInRefused' });
    expect(state.running).toBeNull();
    expect(state.result).toBeNull();
  });

  it('remembers a walk-in’s check-in that got no answer as an earlier press', () => {
    const narek = doorGuest('g9', 'Narek');
    const state = play(
      { type: 'sent', running: 'g9' },
      { type: 'walkInNotHere', guestId: 'g9', name: 'Narek', refusal: noAnswer },
      refusedCheckIn({ kind: 'alreadyHere', arrivedAt: ARRIVED_AT }, narek),
    );
    expect(state.result).toMatchObject({ kind: 'alreadyHere', isOurEarlierPress: true });
  });

  it('says they were added but aren’t here yet when the check-in is refused', () => {
    const state = play(
      { type: 'sent', running: 'g9' },
      { type: 'walkInNotHere', guestId: 'g9', name: 'Narek', refusal: noAnswer },
    );
    expect(state.running).toBeNull();
    expect(state.result).toEqual({
      kind: 'addedNotHere',
      guestId: 'g9',
      name: 'Narek',
      refusal: noAnswer,
    });
    expect(arrivalOf(doorGuest('g9', 'Narek'), state).isHere).toBe(false);
  });
});

describe('when no answer comes', () => {
  it('says it may have counted, and marks nobody', () => {
    const state = play(refusedCheckIn(noAnswer));
    expect(state.result).toMatchObject({ kind: 'refused', refusal: noAnswer });
    expect(arrivalOf(armen, state).isHere).toBe(false);
  });

  it('reads a repeat’s "already here" as probably the earlier press', () => {
    const state = play(
      refusedCheckIn(noAnswer),
      refusedCheckIn({ kind: 'alreadyHere', arrivedAt: ARRIVED_AT }),
    );
    expect(state.result).toMatchObject({ kind: 'alreadyHere', isOurEarlierPress: true });
  });

  it('keeps the earlier press through "too many tries", which says nothing about the guest', () => {
    const state = play(
      refusedCheckIn(noAnswer),
      refusedCheckIn({ kind: 'rateLimited' }),
      refusedCheckIn({ kind: 'alreadyHere', arrivedAt: ARRIVED_AT }),
    );
    expect(state.result).toMatchObject({ kind: 'alreadyHere', isOurEarlierPress: true });
  });

  it('keeps a code’s earlier press through "too many tries" too', () => {
    const refused = (refusal: DoorRefusal): DoorEvent => ({
      type: 'admitRefused',
      refusal,
      nameOf: () => null,
    });
    const state = play(
      refused(noAnswer),
      refused({ kind: 'rateLimited' }),
      refused({ kind: 'ticketUsed' }),
    );
    expect(state.result).toEqual({ kind: 'ticketUsed', isOurEarlierPress: true });
  });

  it('forgets the earlier press once that guest has an answer', () => {
    const state = play(
      refusedCheckIn(noAnswer),
      { type: 'checkedIn', answer },
      { type: 'undone', guest: armen },
      refusedCheckIn({ kind: 'alreadyHere', arrivedAt: ARRIVED_AT }),
    );
    expect(state.result).toMatchObject({ kind: 'alreadyHere', isOurEarlierPress: false });
  });

  it('does not take another guest’s lost press for this one’s', () => {
    const other = doorGuest('g2', 'Lusine');
    const state = play(
      refusedCheckIn(noAnswer, other),
      refusedCheckIn({ kind: 'alreadyHere', arrivedAt: ARRIVED_AT }),
    );
    expect(state.result).toMatchObject({ isOurEarlierPress: false });
  });

  it('reads a repeated code’s "used" as probably the earlier press, until it is retyped', () => {
    const lost: DoorEvent = { type: 'admitRefused', refusal: noAnswer, nameOf: () => null };
    const used: DoorEvent = {
      type: 'admitRefused',
      refusal: { kind: 'ticketUsed' },
      nameOf: () => null,
    };
    expect(play(lost, used).result).toEqual({ kind: 'ticketUsed', isOurEarlierPress: true });
    expect(play(lost, { type: 'codeEdited' }, used).result).toEqual({
      kind: 'ticketUsed',
      isOurEarlierPress: false,
    });
    expect(play(used).result).toEqual({ kind: 'ticketUsed', isOurEarlierPress: false });
  });
});

describe('admitting a ticket: one arrival with its guest', () => {
  const admitted = { admittedAt: ARRIVED_AT, holderName: 'Armen Petrosyan' };

  it('marks a linked holder’s row here, with the list’s table, and offers undo', () => {
    const seated = doorGuest('g1', 'Armen Petrosyan', {
      seats: [
        {
          arrangementId: 'a1',
          tableId: 't1',
          venue: 'Hall',
          table: 'Table 4',
          isReservation: false,
        },
      ],
    });
    const state = play({
      type: 'admitted',
      answer: { ...admitted, guestId: 'g1' },
      guest: seated,
    });
    expect(arrivalOf(seated, state)).toEqual({ isHere: true, at: ARRIVED_AT });
    expect(state.result).toEqual({
      kind: 'arrived',
      guestId: 'g1',
      name: 'Armen Petrosyan',
      arrivedAt: ARRIVED_AT,
      seats: [{ table: 'Table 4', venue: 'Hall' }],
      wasExpected: true,
    });
  });

  it('flags a linked holder the list shows as not coming', () => {
    const declined = doorGuest('g1', 'Armen', { answer: 'DECLINED' });
    const state = play({
      type: 'admitted',
      answer: { ...admitted, guestId: 'g1' },
      guest: declined,
    });
    expect(state.result).toMatchObject({ wasExpected: false });
  });

  it('still names a linked holder missing from a list not read yet', () => {
    const state = play({
      type: 'admitted',
      answer: { ...admitted, guestId: 'g9' },
      guest: undefined,
    });
    expect(state.result).toMatchObject({
      kind: 'arrived',
      guestId: 'g9',
      seats: [],
      wasExpected: true,
    });
    expect(arrivalOf(doorGuest('g9', 'Ani'), state).isHere).toBe(true);
  });

  it('says an unlinked ticket can’t be undone, and that it is not counted', () => {
    const state = play({
      type: 'admitted',
      answer: { ...admitted, guestId: null },
      guest: undefined,
    });
    expect(state.result).toEqual({
      kind: 'admittedUnlinked',
      name: 'Armen Petrosyan',
      arrivedAt: ARRIVED_AT,
    });
  });

  it('names whoever a refused code’s agreement belongs to, from the list', () => {
    const refusal: DoorRefusal = { kind: 'mustAgree', guestId: 'g1', questionId: 'q1' };
    const state = play({
      type: 'admitRefused',
      refusal,
      nameOf: (id) => (id === 'g1' ? 'Armen Petrosyan' : null),
    });
    expect(state.result).toEqual({
      kind: 'refused',
      refusal,
      guestId: 'g1',
      name: 'Armen Petrosyan',
    });
  });
});

describe('a refused code that says who and when (FR-76)', () => {
  const refusedCode = (refusal: DoorRefusal): DoorEvent => ({
    type: 'admitRefused',
    refusal,
    nameOf: (guestId) => (guestId === 'g1' ? 'Armen Petrosyan' : null),
  });

  it('marks a used code’s holder here, with when it was used, named by the answer', () => {
    const state = play(
      refusedCode({
        kind: 'ticketUsed',
        usedAt: ARRIVED_AT,
        guestId: 'g1',
        holderName: 'Armen P.',
      }),
    );
    expect(state.result).toEqual({
      kind: 'ticketUsed',
      isOurEarlierPress: false,
      usedAt: ARRIVED_AT,
      guestId: 'g1',
      name: 'Armen P.',
    });
    expect(arrivalOf(armen, state)).toEqual({ isHere: true, at: ARRIVED_AT });
  });

  it('names a used code’s holder from the list when the answer doesn’t', () => {
    const state = play(refusedCode({ kind: 'ticketUsed', usedAt: ARRIVED_AT, guestId: 'g1' }));
    expect(state.result).toMatchObject({ name: 'Armen Petrosyan', guestId: 'g1' });
  });

  it('marks nobody for a used code with no time', () => {
    const state = play(refusedCode({ kind: 'ticketUsed', guestId: 'g1' }));
    expect(arrivalOf(armen, state)).toEqual({ isHere: false, at: null });
  });

  it('names and marks a code’s holder who is already here', () => {
    const state = play(
      refusedCode({
        kind: 'alreadyHere',
        arrivedAt: ARRIVED_AT,
        guestId: 'g1',
        holderName: 'Armen P.',
      }),
    );
    expect(state.result).toMatchObject({
      kind: 'alreadyHere',
      guestId: 'g1',
      name: 'Armen P.',
      arrivedAt: ARRIVED_AT,
    });
    expect(arrivalOf(armen, state)).toEqual({ isHere: true, at: ARRIVED_AT });
  });

  it('names who must agree by the answer before the list', () => {
    const state = play(
      refusedCode({ kind: 'mustAgree', guestId: 'g1', questionId: 'q1', holderName: 'Armen P.' }),
    );
    expect(state.result).toMatchObject({ kind: 'refused', guestId: 'g1', name: 'Armen P.' });
  });
});

describe('undoing', () => {
  it('takes them off, restoring the row', () => {
    const state = play({ type: 'checkedIn', answer }, { type: 'undone', guest: armen });
    expect(arrivalOf(armen, state)).toEqual({ isHere: false, at: null });
    expect(state.result).toEqual({ kind: 'undone', name: 'Armen Petrosyan' });
  });

  it('overrules a list that still says they arrived', () => {
    const listed = doorGuest('g1', 'Armen', { isCheckedIn: true, arrivedAt: ARRIVED_AT });
    expect(arrivalOf(listed, play({ type: 'undone', guest: listed })).isHere).toBe(false);
  });

  it('counts someone not checked in as undone already', () => {
    const state = play(
      { type: 'checkedIn', answer },
      { type: 'undoRefused', guest: armen, refusal: { kind: 'notCheckedIn' } },
    );
    expect(state.result).toEqual({ kind: 'undone', name: 'Armen Petrosyan' });
    expect(arrivalOf(armen, state).isHere).toBe(false);
  });

  it('leaves them here when the undo is refused', () => {
    const state = play(
      { type: 'checkedIn', answer },
      { type: 'undoRefused', guest: armen, refusal: { kind: 'forbidden' } },
    );
    expect(arrivalOf(armen, state).isHere).toBe(true);
    expect(state.result).toMatchObject({ kind: 'refused', refusal: { kind: 'forbidden' } });
  });
});

describe('reading the list again', () => {
  const started: DoorEvent = { type: 'listReadStarted' };
  const read: DoorEvent = { type: 'listRead' };

  it('lets the list replace what this phone marked', () => {
    const state = play({ type: 'checkedIn', answer }, started, read);
    const listed = doorGuest('g1', 'Armen', { isCheckedIn: true, arrivedAt: LATER });
    expect(arrivalOf(listed, state)).toEqual({ isHere: true, at: LATER });
    expect(state.marks.size).toBe(0);
  });

  it('lets it fill in a time, for a read begun straight after the answer without one', () => {
    const state = play(refusedCheckIn({ kind: 'alreadyHere', arrivedAt: null }), started, read);
    const listed = doorGuest('g1', 'Armen', { isCheckedIn: true, arrivedAt: LATER });
    expect(arrivalOf(listed, state)).toEqual({ isHere: true, at: LATER });
  });

  it('keeps a mark made after that read began, which the list can’t know', () => {
    const state = play(started, { type: 'checkedIn', answer }, read);
    expect(arrivalOf(armen, state)).toEqual({ isHere: true, at: ARRIVED_AT });
  });

  it('keeps the result on screen', () => {
    const before = play({ type: 'checkedIn', answer });
    expect(doorReducer(doorReducer(before, started), read).result).toEqual(before.result);
  });
});

describe('dismissing', () => {
  it('clears the result and nothing else', () => {
    const state = play({ type: 'checkedIn', answer }, { type: 'dismissed' });
    expect(state.result).toBeNull();
    expect(arrivalOf(armen, state).isHere).toBe(true);
  });
});

describe('how long the counts wait', () => {
  it.each([
    [0, 20_000],
    [1, 40_000],
    [2, 80_000],
    [3, 120_000],
    [10, 120_000],
  ])('after %i failures waits %i ms', (failures, delay) => {
    expect(pollDelay(failures)).toBe(delay);
  });
});
