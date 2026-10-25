import type {
  Contact,
  Guest,
  GuestWire,
  Household,
  HouseholdWire,
  ImportRecord,
  ImportRecordWire,
  ImportResult,
  ImportResultWire,
  RowError,
  RowErrorWire,
} from './types';

/**
 * Where guest data arrives. Every object is built by naming its fields, never by spreading the
 * response, so a guest's `token` (their personal link, a credential) and any field added later stop
 * here: they are never rendered, stored, logged or put in an address.
 */

/** `in`, not a null check: a missing key is "not yours to see"; `null` is "none stored". */
function contactOf(guest: GuestWire): Contact {
  if (!('email' in guest)) return { isShown: false };
  return { isShown: true, email: guest.email ?? null, phone: guest.phone ?? null };
}

function readGuest(guest: GuestWire): Guest {
  return {
    id: guest.id,
    firstName: guest.firstName,
    lastName: guest.lastName,
    name: guest.name,
    locale: guest.locale,
    side: guest.attribution,
    isPrimary: guest.isPrimary,
    isAddedByGuest: guest.addedByGuest,
    isErased: guest.isAnonymized,
    answer: guest.rsvpStatus,
    table: guest.table,
    isCheckedIn: guest.isCheckedIn,
    contact: contactOf(guest),
  };
}

/** The list as it came: households by name, the primary first within each. Never re-sorted. */
export function readHouseholds(households: readonly HouseholdWire[]): Household[] {
  return households.map((household) => ({
    id: household.id,
    name: household.name,
    seatsAllotted: household.seatsAllotted,
    seatsNamed: household.seatsNamed,
    guests: household.guests.map(readGuest),
  }));
}

function readRowError(error: RowErrorWire): RowError {
  return { row: error.row, message: error.message, value: error.value ?? null };
}

export function readImportResult(result: ImportResultWire): ImportResult {
  return {
    status: result.status,
    rowsImported: result.rowsImported,
    rowsFailed: result.rowsFailed,
    errors: result.errors.map(readRowError),
  };
}

/** Newest first. A running import has no errors yet. */
export function readImportHistory(records: readonly ImportRecordWire[]): ImportRecord[] {
  return records.map((record) => ({
    id: record.id,
    filename: record.filename,
    status: record.status,
    rowsImported: record.rowsImported,
    rowsFailed: record.rowsFailed,
    errors: (record.errors ?? []).map(readRowError),
    createdAt: record.createdAt,
  }));
}
