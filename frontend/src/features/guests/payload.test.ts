import { describe, expect, it } from 'vitest';

import { guestFormValues, householdFormValues, NEW_HOUSEHOLD } from './form-model';
import { addPayload, guestUpdatePayload, householdUpdatePayload } from './payload';
import { readHouseholds } from './read';
import type { GuestFormValues } from './schemas';
import { guestWire, guestWithoutContact, householdWire } from './test-data';
import type { Guest } from './types';

function guestFrom(wire = guestWire()): Guest {
  const [household] = readHouseholds([householdWire({ guests: [wire] })]);
  const guest = household?.guests[0];
  if (!guest) throw new Error('No guest read');
  return guest;
}

const blank: GuestFormValues = {
  firstName: 'Ani',
  lastName: '',
  email: '',
  phone: '',
  locale: '',
  side: 'UNKNOWN',
  household: NEW_HOUSEHOLD,
  seats: 1,
};

describe('addPayload', () => {
  it('leaves out what the host left blank, and gives a new household its seats', () => {
    expect(addPayload(blank, true)).toEqual({ firstName: 'Ani', seatsAllotted: 1 });
    expect(addPayload({ ...blank, seats: 4 }, true)).toEqual({
      firstName: 'Ani',
      seatsAllotted: 4,
    });
  });

  it('joins an existing household by its id, without seats', () => {
    expect(addPayload({ ...blank, household: 'h1', seats: 4 }, true)).toEqual({
      firstName: 'Ani',
      householdId: 'h1',
    });
  });

  it('sends what was filled in', () => {
    const filled = {
      ...blank,
      lastName: 'Hakobyan',
      email: 'ani@example.am',
      phone: '+374 91 111111',
      locale: 'ru',
      side: 'SIDE_B',
    } satisfies GuestFormValues;
    expect(addPayload(filled, true)).toEqual({
      firstName: 'Ani',
      lastName: 'Hakobyan',
      email: 'ani@example.am',
      phone: '+374 91 111111',
      locale: 'ru',
      attribution: 'SIDE_B',
      seatsAllotted: 1,
    });
  });

  it('never sends email or phone for a caller who cannot see them', () => {
    const typed = { ...blank, email: 'ani@example.am', phone: '+374 91 111111' };
    expect(addPayload(typed, false)).toEqual({ firstName: 'Ani', seatsAllotted: 1 });
  });
});

describe('guestUpdatePayload', () => {
  const guest = guestFrom();
  const initial = guestFormValues(guest, 'h1');

  it('sends nothing when nothing changed', () => {
    expect(guestUpdatePayload(initial, { ...initial }, guest.contact)).toEqual({});
  });

  it('sends only what changed', () => {
    const values = {
      ...initial,
      firstName: 'Armen-Davit',
      side: 'SHARED',
    } satisfies GuestFormValues;
    expect(guestUpdatePayload(initial, values, guest.contact)).toEqual({
      firstName: 'Armen-Davit',
      attribution: 'SHARED',
    });
  });

  it('clears an email or phone the host emptied with an empty string', () => {
    const values = { ...initial, email: '', phone: '' };
    expect(guestUpdatePayload(initial, values, guest.contact)).toEqual({ email: '', phone: '' });
  });

  it('sends nothing for an email that was empty and still is', () => {
    const empty = guestFrom(guestWire({ email: null, lastName: null }));
    const before = guestFormValues(empty, 'h1');
    expect(before.email).toBe('');
    expect(guestUpdatePayload(before, { ...before }, empty.contact)).toEqual({});
  });

  it('clears a last name the host emptied', () => {
    expect(guestUpdatePayload(initial, { ...initial, lastName: '' }, guest.contact)).toEqual({
      lastName: '',
    });
  });

  it('never touches an email or phone it never received', () => {
    const hidden = guestFrom(guestWithoutContact());
    const before = guestFormValues(hidden, 'h1');
    const values = { ...before, email: 'typed@example.am', phone: '', firstName: 'Armo' };
    expect(guestUpdatePayload(before, values, hidden.contact)).toEqual({ firstName: 'Armo' });
  });

  it('moves the guest by sending the household it goes to', () => {
    expect(guestUpdatePayload(initial, { ...initial, household: 'h2' }, guest.contact)).toEqual({
      householdId: 'h2',
    });
  });

  it('never sends an empty language, which the backend would store as it is (FR-31)', () => {
    expect(guestUpdatePayload(initial, { ...initial, locale: '' }, guest.contact)).toEqual({});
    expect(guestUpdatePayload(initial, { ...initial, locale: 'en' }, guest.contact)).toEqual({
      locale: 'en',
    });
  });
});

describe('householdUpdatePayload', () => {
  const household = readHouseholds([householdWire()])[0];
  if (!household) throw new Error('No household read');
  const initial = { name: household.name, seats: household.seatsAllotted };

  it('starts from the household as it is', () => {
    expect(householdFormValues(household)).toEqual({ name: 'Petrosyan family', seats: '3' });
  });

  it('sends only what changed, and nothing when nothing did', () => {
    expect(householdUpdatePayload(initial, { ...initial })).toEqual({});
    expect(householdUpdatePayload(initial, { name: 'The Petrosyans', seats: 3 })).toEqual({
      name: 'The Petrosyans',
    });
    expect(householdUpdatePayload(initial, { name: 'Petrosyan family', seats: 5 })).toEqual({
      seatsAllotted: 5,
    });
  });
});
