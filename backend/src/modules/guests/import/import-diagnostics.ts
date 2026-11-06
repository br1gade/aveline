import type { RowError } from './csv-guests';

// Stored diagnostics outlive guests and are readable without contact permission.
// Rebuild their text from codes, including when reading older unsafe records.
const STORED_MESSAGES = {
  NAME_COLUMN_MISSING: 'No first-name column found',
  NO_ROWS: 'The file contains no guest rows',
  CSV_UNREADABLE: 'The CSV file could not be read',
  FILE_UNREADABLE: 'The guest-list file could not be read',
  NAME_REQUIRED: 'This row needs a first name',
  INVALID_SEATS: 'Seats must be a valid whole-number allowance',
  INVALID_EMAIL: 'Email address is invalid',
  INVALID_PHONE: 'Phone number is invalid',
  FIELD_TOO_LONG: 'Field exceeds the allowed length',
  SUBJECT_ERASED: 'This row matches a data-erasure exclusion',
  HOUSEHOLD_FULL: 'Household allowance cannot fit this guest',
  NOT_SAVED: 'Could not save this row; try again',
} as const;
const FIELDS = new Set(['firstName', 'lastName', 'seats', 'email', 'phone', 'household', 'locale']);

export function storedImportDiagnostic(value: unknown): RowError {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const reason = knownReason(input.reason);
  const field = typeof input.field === 'string' && FIELDS.has(input.field) ? input.field : undefined;
  return {
    row: typeof input.row === 'number' && Number.isInteger(input.row) ? Math.max(0, input.row) : 0,
    message: reason ? STORED_MESSAGES[reason] : 'This row could not be imported',
    ...(reason ? { reason } : {}),
    ...(field ? { field } : {}),
  };
}

function knownReason(value: unknown): keyof typeof STORED_MESSAGES | undefined {
  return typeof value === 'string' && Object.hasOwn(STORED_MESSAGES, value) ? value as keyof typeof STORED_MESSAGES : undefined;
}

export function storedImportDiagnostics(value: unknown): RowError[] {
  return Array.isArray(value) ? value.map(storedImportDiagnostic) : [];
}
