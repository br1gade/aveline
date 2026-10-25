import type { GuestFieldCode } from './schemas';

export type GuestField =
  'firstName' | 'lastName' | 'email' | 'phone' | 'locale' | 'side' | 'household' | 'seats';
export type HouseholdField = 'name' | 'seats';

export interface FieldRefusal<Field extends string> {
  field: Field;
  code: GuestFieldCode;
}

/**
 * Where each property's refusal goes on the guest form. The service prefixes its messages with the
 * property ("householdId: …", "email: …"); class-validator starts with it and no colon
 * ("firstName must be…", FR-20). Both put the property name first, which is all this reads. The
 * words are the page's own.
 */
const GUEST_FIELDS: Readonly<Record<string, FieldRefusal<GuestField>>> = {
  firstName: { field: 'firstName', code: 'refused' },
  lastName: { field: 'lastName', code: 'refused' },
  email: { field: 'email', code: 'email' },
  phone: { field: 'phone', code: 'phone' },
  locale: { field: 'locale', code: 'refused' },
  attribution: { field: 'side', code: 'refused' },
  householdId: { field: 'household', code: 'householdFull' },
  seatsAllotted: { field: 'seats', code: 'seats' },
};

/** The service refuses seats below the guests already named; the form checks the rest first. */
const HOUSEHOLD_FIELDS: Readonly<Record<string, FieldRefusal<HouseholdField>>> = {
  name: { field: 'name', code: 'refused' },
  seatsAllotted: { field: 'seats', code: 'seatsBelowNamed' },
};

const LEADING_PROPERTY = /^([A-Za-z]+)(?::| )/;

function refusedFields<Field extends string>(
  messages: readonly string[],
  fields: Readonly<Record<string, FieldRefusal<Field>>>,
): FieldRefusal<Field>[] {
  return messages.flatMap((message) => {
    const property = LEADING_PROPERTY.exec(message)?.[1] ?? '';
    const refusal = Object.hasOwn(fields, property) ? fields[property] : undefined;
    return refusal ? [refusal] : [];
  });
}

/** The guest form's fields a 400 names. Anything else is the dialog's general message. */
export function refusedGuestFields(messages: readonly string[]): FieldRefusal<GuestField>[] {
  return refusedFields(messages, GUEST_FIELDS);
}

export function refusedHouseholdFields(
  messages: readonly string[],
): FieldRefusal<HouseholdField>[] {
  return refusedFields(messages, HOUSEHOLD_FIELDS);
}
