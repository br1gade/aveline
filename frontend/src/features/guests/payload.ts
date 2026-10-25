import type { components } from '@/api/schema';

import { NEW_HOUSEHOLD } from './form-model';
import type { GuestFormValues, HouseholdFormValues } from './schemas';
import type { Contact } from './types';

type Schemas = components['schemas'];

type ContactFields = Pick<Schemas['AddGuestDto'], 'email' | 'phone'>;

/** Only for a caller who sees contact details; anyone else's form never had them. */
function contactToAdd(values: GuestFormValues, isContactShown: boolean): ContactFields {
  if (!isContactShown) return {};
  return {
    ...(values.email ? { email: values.email } : {}),
    ...(values.phone ? { phone: values.phone } : {}),
  };
}

/**
 * A new guest. Blank optional fields are left out, and an unknown side too, which the backend
 * defaults to. Without a household they get one of their own, with the seats typed.
 */
export function addPayload(
  values: GuestFormValues,
  isContactShown: boolean,
): Schemas['AddGuestDto'] {
  const body: Schemas['AddGuestDto'] = {
    firstName: values.firstName,
    ...contactToAdd(values, isContactShown),
  };
  if (values.lastName) body.lastName = values.lastName;
  if (values.locale) body.locale = values.locale;
  if (values.side !== 'UNKNOWN') body.attribution = values.side;
  if (values.household === NEW_HOUSEHOLD) body.seatsAllotted = values.seats;
  else body.householdId = values.household;
  return body;
}

/** An emptied email or phone is sent as `""`, which clears it; one that stayed empty is not sent. */
function changedContact(initial: GuestFormValues, values: GuestFormValues): ContactFields {
  return {
    ...(values.email === initial.email ? {} : { email: values.email }),
    ...(values.phone === initial.phone ? {} : { phone: values.phone }),
  };
}

/**
 * Only what the host changed (docs/API.md §6: omitted means unchanged), so an edit never writes back
 * a value someone else changed meanwhile, and never touches an email or phone this caller never
 * received. A changed household moves the guest.
 */
export function guestUpdatePayload(
  initial: GuestFormValues,
  values: GuestFormValues,
  contact: Contact,
): Schemas['UpdateGuestDto'] {
  const body: Schemas['UpdateGuestDto'] = contact.isShown ? changedContact(initial, values) : {};
  if (values.firstName !== initial.firstName) body.firstName = values.firstName;
  if (values.lastName !== initial.lastName) body.lastName = values.lastName;
  // Never `""`: the backend would store it as it is rather than clear the language (FR-31).
  if (values.locale && values.locale !== initial.locale) body.locale = values.locale;
  if (values.side !== initial.side) body.attribution = values.side;
  if (values.household !== initial.household) body.householdId = values.household;
  return body;
}

export function householdUpdatePayload(
  initial: HouseholdFormValues,
  values: HouseholdFormValues,
): Schemas['UpdateHouseholdDto'] {
  const body: Schemas['UpdateHouseholdDto'] = {};
  if (values.name !== initial.name) body.name = values.name;
  if (values.seats !== initial.seats) body.seatsAllotted = values.seats;
  return body;
}
