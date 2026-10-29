import { z } from 'zod';

/**
 * The backend's own limits (`CorrectNameDto`): trimmed, at most 100 characters, a first name, and
 * no null character, which the database cannot store. The server stays the authority. Messages
 * are codes, worded by the form.
 */
export type NameFieldCode = 'required' | 'tooLong' | 'invalid' | 'refused';

export const NAME_LIMIT = 100;

const NUL = String.fromCharCode(0);

function name(minimum: 0 | 1) {
  return z
    .string()
    .trim()
    .min(minimum, { error: 'required' })
    .max(NAME_LIMIT, { error: 'tooLong' })
    .refine((value) => !value.includes(NUL), { error: 'invalid' });
}

export const nameSchema = z.object({ firstName: name(1), lastName: name(0) });

export type NameValues = z.input<typeof nameSchema>;
export type NameField = keyof NameValues;
