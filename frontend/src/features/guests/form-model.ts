import type { EventDetail } from '@/features/events';

import type { GuestFormInput, GuestFormValues, HouseholdFormInput } from './schemas';
import type { Guest, Household, Side } from './types';

/** The household choice meaning "a new household of their own", named after the guest. */
export const NEW_HOUSEHOLD = '';

export function newGuestValues(household: string = NEW_HOUSEHOLD): GuestFormInput {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    locale: '',
    side: 'UNKNOWN',
    household,
    seats: '1',
  };
}

/**
 * A guest as the edit form shows them, and the baseline its payload compares against. Contact
 * fields are empty when they never arrived; the payload then never sends them.
 */
export function guestFormValues(guest: Guest, householdId: string): GuestFormValues {
  const contact = guest.contact.isShown ? guest.contact : { email: null, phone: null };
  return {
    firstName: guest.firstName.trim(),
    lastName: (guest.lastName ?? '').trim(),
    email: (contact.email ?? '').trim(),
    phone: (contact.phone ?? '').trim(),
    locale: guest.locale ?? '',
    side: guest.side,
    household: householdId,
    seats: 1,
  };
}

export function toGuestFormInput(values: GuestFormValues): GuestFormInput {
  return { ...values, seats: String(values.seats) };
}

export function householdFormValues(household: Household): HouseholdFormInput {
  return { name: household.name, seats: String(household.seatsAllotted) };
}

export function hasFreeSeat(household: Household): boolean {
  return household.seatsNamed < household.seatsAllotted;
}

/**
 * The households a guest may join or move to: those with a free seat, and the guest's own. A full
 * one would be refused (`householdId:`), so it is not offered.
 */
export function joinableHouseholds(households: readonly Household[], ownId?: string): Household[] {
  return households.filter((household) => household.id === ownId || hasFreeSeat(household));
}

/**
 * The languages a guest may be given: the event's own, and any other the guest already has, so an
 * edit never changes it silently. "Not set" is offered only while none is set (FR-31).
 */
export function guestLanguages(eventLocales: readonly string[], current: string): string[] {
  return current && !eventLocales.includes(current)
    ? [...eventLocales, current]
    : [...eventLocales];
}

/**
 * The side is asked once the event names both sides, as the guest's own reply form does, or when
 * the guest already has one, which an edit must be able to show.
 */
export function offersSides(
  event: Pick<EventDetail, 'sideALabel' | 'sideBLabel'>,
  current: Side,
): boolean {
  return Boolean(event.sideALabel && event.sideBLabel) || current !== 'UNKNOWN';
}
