/** Every reason the backend gives a refused row or file, in the order the page words them (FR-26). */
export const IMPORT_REASONS = [
  'NAME_REQUIRED',
  'INVALID_SEATS',
  'INVALID_EMAIL',
  'INVALID_PHONE',
  'FIELD_TOO_LONG',
  'SUBJECT_ERASED',
  'HOUSEHOLD_FULL',
  'NOT_SAVED',
  'NAME_COLUMN_MISSING',
  'NO_ROWS',
  'CSV_UNREADABLE',
  'FILE_UNREADABLE',
] as const;

/** The columns a reason can name (docs/API.md §6, "Importing a guest list"). */
export const IMPORT_FIELDS = [
  'firstName',
  'lastName',
  'seats',
  'email',
  'phone',
  'household',
  'locale',
] as const;

export type ImportReason = (typeof IMPORT_REASONS)[number];
export type ImportField = (typeof IMPORT_FIELDS)[number];
