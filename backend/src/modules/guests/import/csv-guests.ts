import { GuestAttribution } from '@prisma/client';
import { parse } from 'csv-parse/sync';

export interface ParsedGuest {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  /** Guests sharing a household name are invited and seated together. */
  household: string;
  seatsAllotted: number;
  attribution: GuestAttribution;
  locale?: string;
}

export interface RowError {
  row: number;
  message: string;
  value?: string;
}

export interface ParsedGuestList {
  guests: ParsedGuest[];
  errors: RowError[];
}

/** Accepted spellings for each column. Hosts export from everywhere. */
/** A household of more than twenty is a data-entry mistake, not a family. */
const MAX_SEATS = 20;

const COLUMNS: Record<string, string[]> = {
  firstName: ['firstname', 'first name', 'first', 'name', 'guest', 'անուն'],
  lastName: ['lastname', 'last name', 'surname', 'last', 'ազգանուն'],
  email: ['email', 'e-mail', 'mail'],
  phone: ['phone', 'mobile', 'telephone', 'tel'],
  household: ['household', 'family', 'group', 'party'],
  seats: ['seats', 'seatsallotted', 'seats allotted', 'allowance', 'plusones', 'plus ones'],
  side: ['side', 'attribution', 'invitedby', 'invited by'],
  locale: ['locale', 'language', 'lang'],
};

const SIDES: Record<string, GuestAttribution> = {
  a: GuestAttribution.SIDE_A,
  'side a': GuestAttribution.SIDE_A,
  b: GuestAttribution.SIDE_B,
  'side b': GuestAttribution.SIDE_B,
  both: GuestAttribution.SHARED,
  shared: GuestAttribution.SHARED,
};

/**
 * Reads a guest list out of a CSV.
 *
 * Tolerant by design. A host exports from Excel, Google Sheets or a phone's
 * contacts, so column names vary and rows are messy. Anything unreadable
 * becomes a reported error against its row number rather than a failed
 * upload: rejecting four hundred good rows because twelve are wrong is how a
 * host gives up and goes back to a spreadsheet.
 *
 * Only `firstName` is required. Everything else has a sensible default,
 * because a list of names is the minimum a host actually has.
 */
export function parseGuestCsv(content: string): ParsedGuestList {
  const rows = readRows(content);
  if ('error' in rows) return { guests: [], errors: [{ row: 0, message: rows.error }] };

  const guests: ParsedGuest[] = [];
  const errors: RowError[] = [];

  rows.records.forEach((record, index) => {
    // Row 1 is the header, so the first record is row 2 — which is what the
    // host sees in their spreadsheet.
    const parsed = parseRow(record, index + 2);
    if ('message' in parsed) errors.push(parsed);
    else guests.push(parsed);
  });

  return { guests, errors };
}

/** Reads one named field from a row, whatever the host spelled it. */
type FieldReader = (key: keyof typeof COLUMNS) => string;

/** One row in, either a guest or the reason it was rejected. */
function parseRow(record: Record<string, string>, row: number): ParsedGuest | RowError {
  const field: FieldReader = (key) => findValue(record, COLUMNS[key]);

  const rejection = rejectionFor(field);
  return rejection ? { row, ...rejection } : toGuest(field);
}

/** The first reason this row cannot become a guest, or null if it can. */
function rejectionFor(field: FieldReader): Omit<RowError, 'row'> | null {
  if (!field('firstName')) return { message: 'No name in this row' };

  const seats = field('seats');
  if (seats && !isValidSeatCount(seats)) {
    return { message: `Seats must be a whole number between 1 and ${MAX_SEATS}`, value: seats };
  }

  const email = field('email');
  if (email && !email.includes('@')) {
    return { message: 'That does not look like an email address', value: email };
  }

  return null;
}

function isValidSeatCount(seats: string): boolean {
  const count = Number(seats);
  return Number.isInteger(count) && count >= 1 && count <= MAX_SEATS;
}

function toGuest(field: FieldReader): ParsedGuest {
  const firstName = field('firstName');
  const lastName = field('lastName');
  const seats = field('seats');

  return {
    firstName,
    lastName: lastName || undefined,
    email: field('email') || undefined,
    phone: field('phone') || undefined,
    // A guest with no household named is their own household, so they are
    // never silently grouped with a stranger.
    household: field('household') || [firstName, lastName].filter(Boolean).join(' '),
    seatsAllotted: seats ? Number(seats) : 1,
    attribution: SIDES[field('side').toLowerCase()] ?? GuestAttribution.UNKNOWN,
    locale: field('locale') || undefined,
  };
}

function readRows(content: string): { records: Record<string, string>[] } | { error: string } {
  try {
    const records = parse<Record<string, string>>(content, {
      columns: (header: string[]) => header.map((name) => name.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    });

    if (records.length === 0) return { error: 'The file has a header but no rows' };
    return { records };
  } catch (error) {
    return { error: `Could not read the file: ${error instanceof Error ? error.message : 'unknown'}` };
  }
}

function findValue(record: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const value = record[name];
    if (value !== undefined && value !== '') return value.trim();
  }
  return '';
}
