import { z } from 'zod';

/**
 * The table forms' checks, with the backend's own limits (`CreateTableDto`, `CreateTablesDto`,
 * `UpdateTableDto`), so a refusal is rare. The server stays the authority. Messages are codes,
 * worded by `useTableFieldText`; the last four come only from the server (`server-errors.ts`).
 */
export type TableFieldCode =
  | 'required'
  | 'tooLong'
  | 'seats'
  | 'count'
  | 'belowSeated'
  | 'nameTaken'
  | 'chairsOutside'
  | 'refused';

export const MAX_TABLE_SEATS = 100;
export const MAX_TABLES_AT_ONCE = 200;

const code = (value: TableFieldCode) => ({ error: value });

const text = (minimum: 0 | 1, limit: number) =>
  z.string().trim().min(minimum, code('required')).max(limit, code('tooLong'));

/** A whole number typed into a number input, which the form holds as text. */
function wholeNumber(maximum: number, limits: TableFieldCode, minimum = 1, below = limits) {
  const number = z.number().min(1, code(limits)).max(maximum, code(limits));
  return z
    .string()
    .trim()
    .regex(/^\d+$/, code(limits))
    .transform(Number)
    .pipe(minimum > 1 ? number.min(minimum, code(below)) : number);
}

/** A table's seats never go below the guests already seated at it (docs/API.md §6). */
export function tableFormSchema(seated: number) {
  return z.object({
    name: text(1, 60),
    capacity: wholeNumber(MAX_TABLE_SEATS, 'seats', Math.max(1, seated), 'belowSeated'),
    zone: text(0, 60),
    /** `''` is the plan with no venue. Only correcting a table offers it. */
    venueId: z.string().optional(),
  });
}

type TableFormSchema = ReturnType<typeof tableFormSchema>;
/** What the form holds while it is filled in: the seats as typed. */
export type TableFormInput = z.input<TableFormSchema>;
/** What a valid form gives: trimmed, the seats a number. */
export type TableFormValues = z.output<TableFormSchema>;

/** "Table" twenty times: numbered by the backend after the highest number already used. */
export const bulkTablesSchema = z.object({
  namePrefix: text(1, 40),
  count: wholeNumber(MAX_TABLES_AT_ONCE, 'count'),
  capacity: wholeNumber(MAX_TABLE_SEATS, 'seats'),
  zone: text(0, 60),
});

export type BulkTablesInput = z.input<typeof bulkTablesSchema>;
export type BulkTablesValues = z.output<typeof bulkTablesSchema>;
