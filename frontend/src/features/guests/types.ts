/**
 * What the guest calls return (docs/API.md §6: "Reading the guest list", "Editing the guest list",
 * "Importing a guest list"). Interim until FR-1: the schema declares no response types, so these
 * are written from the guide and the backend's services, and only the fields the screens read are
 * typed.
 *
 * The `…Wire` types say what arrives and are read by `read.ts` alone. It builds the client's own
 * objects field by field, so a guest's `token`, a credential to their invitation, goes no further.
 */

export const ANSWERS = ['ATTENDING', 'DECLINED', 'UNDECIDED', 'PENDING'] as const;
/** `PENDING` is a guest who has not answered yet. */
export type Answer = (typeof ANSWERS)[number];

export const SIDES = ['UNKNOWN', 'SIDE_A', 'SIDE_B', 'SHARED'] as const;
/** Whose guest they are; `UNKNOWN` until someone says. */
export type Side = (typeof SIDES)[number];

/**
 * Email and phone arrive only for callers holding `guest:contact:read`. Missing means "not yours to
 * see", which is not the same as empty: a guest shown without them may well have both.
 */
export type Contact =
  { isShown: false } | { isShown: true; email: string | null; phone: string | null };

export interface Guest {
  id: string;
  firstName: string;
  lastName: string | null;
  /** First and last name, as the backend joins them. */
  name: string;
  locale: string | null;
  side: Side;
  /** The household member the invitation is sent to. */
  isPrimary: boolean;
  /** Named by their household on its reply, not by the host. */
  isAddedByGuest: boolean;
  /** Erased at their request: still on the list, never edited again (docs/API.md §6). */
  isErased: boolean;
  answer: Answer;
  /** The table's name once seated. */
  table: string | null;
  /** Checked in at the door, which is the record that they came: they cannot be removed. */
  isCheckedIn: boolean;
  contact: Contact;
}

export interface Household {
  id: string;
  name: string;
  seatsAllotted: number;
  seatsNamed: number;
  /** The one who receives the invitation first, then in the order they were added. */
  guests: Guest[];
}

export type ImportStatus = 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';

/**
 * A row the import refused. `row` is the spreadsheet's own number, the header being row 1; row 0
 * is the file itself (it could not be read, or has no rows).
 */
export interface RowError {
  row: number;
  /** In English, whatever the page's language (FR-26). */
  message: string;
  /** The cell that was refused. A contact value is quoted only in the import's own response. */
  value: string | null;
}

export interface ImportResult {
  status: ImportStatus;
  rowsImported: number;
  rowsFailed: number;
  errors: RowError[];
}

export interface ImportRecord extends ImportResult {
  id: string;
  filename: string;
  /** ISO 8601 UTC; shown in the event's zone. */
  createdAt: string;
}

export interface GuestWire {
  id: string;
  firstName: string;
  lastName: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  /** The guest's personal link segment. Never read. */
  token?: string;
  locale: string | null;
  attribution: Side;
  isPrimary: boolean;
  addedByGuest: boolean;
  isAnonymized: boolean;
  rsvpStatus: Answer;
  table: string | null;
  isCheckedIn: boolean;
}

export interface HouseholdWire {
  id: string;
  name: string;
  seatsAllotted: number;
  seatsNamed: number;
  guests: GuestWire[];
}

export interface RowErrorWire {
  row: number;
  message: string;
  value?: string;
}

export interface ImportResultWire {
  importId: string;
  status: ImportStatus;
  rowsImported: number;
  rowsFailed: number;
  errors: RowErrorWire[];
}

/** The stored record, which the backend returns whole (BACKEND_REQUESTS §3). */
export interface ImportRecordWire {
  id: string;
  filename: string;
  status: ImportStatus;
  rowsImported: number;
  rowsFailed: number;
  errors: RowErrorWire[] | null;
  createdAt: string;
}

export interface RemovedWire {
  removed: string;
  isHouseholdRemoved: boolean;
}
