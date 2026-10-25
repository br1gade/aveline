import { z } from 'zod';

import { SIDES } from './types';

/**
 * The guest forms' checks, with the backend's own limits (`AddGuestDto`, `UpdateGuestDto`,
 * `UpdateHouseholdDto`, the import's 2 MB), so a refusal is rare. The server stays the authority:
 * an address's form is left to it. Messages are codes, worded by `useGuestFieldText`; the last four
 * come only from the server (`server-errors.ts`).
 */
export type GuestFieldCode =
  | 'required'
  | 'tooLong'
  | 'seats'
  | 'seatsBelowNamed'
  | 'tooLarge'
  | 'householdFull'
  | 'email'
  | 'phone'
  | 'refused';

const code = (value: GuestFieldCode) => ({ error: value });

/** The same limit `docs/API.md` §6 gives an import, refused as it arrives with a 413. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** A household holds at most twenty: more is a data-entry mistake (`csv-guests.ts`). */
export const MAX_SEATS = 20;

const text = (minimum: 0 | 1, limit: number) =>
  z.string().trim().min(minimum, code('required')).max(limit, code('tooLong'));

/** A whole number typed into a number input, which the form holds as text. */
function seatCount(minimum: number, belowMinimum: GuestFieldCode) {
  return z
    .string()
    .trim()
    .regex(/^\d+$/, code('seats'))
    .transform(Number)
    .pipe(z.number().min(minimum, code(belowMinimum)).max(MAX_SEATS, code('seats')));
}

const newHouseholdSeats = seatCount(1, 'seats');

/** The empty household value is "a new household of their own" (`form-model.ts`). */
function checkNewSeats(values: { household: string; seats: string }, ctx: z.RefinementCtx): void {
  if (values.household !== '') return;
  if (!newHouseholdSeats.safeParse(values.seats).success) {
    ctx.addIssue({ code: 'custom', path: ['seats'], message: 'seats' });
  }
}

/**
 * Adding and correcting a guest share one form. Seats count only for a new household; when the
 * guest joins one, the backend ignores them.
 */
export const guestFormSchema = z
  .object({
    firstName: text(1, 80),
    lastName: text(0, 80),
    email: text(0, 320),
    phone: text(0, 40),
    locale: z.string(),
    side: z.enum(SIDES),
    household: z.string(),
    seats: z.string(),
  })
  .superRefine(checkNewSeats)
  .transform(({ seats, ...values }) => ({ ...values, seats: Number(seats) || 1 }));

/** What the form holds while it is filled in: the seats as typed. */
export type GuestFormInput = z.input<typeof guestFormSchema>;
/** What a valid form gives: trimmed, the seats a number. */
export type GuestFormValues = z.output<typeof guestFormSchema>;

/** A household's seats never go below the guests already named in it (docs/API.md §6). */
export function householdFormSchema(seatsNamed: number) {
  const isAboveNamed = seatsNamed > 1;
  return z.object({
    name: text(1, 120),
    seats: seatCount(Math.max(1, seatsNamed), isAboveNamed ? 'seatsBelowNamed' : 'seats'),
  });
}

type HouseholdFormSchema = ReturnType<typeof householdFormSchema>;
export type HouseholdFormInput = z.input<HouseholdFormSchema>;
export type HouseholdFormValues = z.output<HouseholdFormSchema>;

/**
 * The chosen file. A `FileList` exists only in browsers, so it is checked by shape, never with
 * `instanceof`: this module is also read on the server.
 */
export const importFormSchema = z.object({
  files: z
    .custom<FileList>((value) => typeof value === 'object' && value !== null && 'length' in value)
    .refine((files) => files.length > 0, code('required'))
    .refine((files) => (files[0]?.size ?? 0) <= MAX_IMPORT_BYTES, code('tooLarge')),
});

export type ImportFormValues = z.output<typeof importFormSchema>;
