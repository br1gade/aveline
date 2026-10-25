import type { FieldError } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { GuestFieldCode } from './schemas';

const CODES: readonly string[] = [
  'required',
  'tooLong',
  'seats',
  'seatsBelowNamed',
  'tooLarge',
  'householdFull',
  'email',
  'phone',
  'refused',
] satisfies GuestFieldCode[];

function isFieldCode(code: string): code is GuestFieldCode {
  return CODES.includes(code);
}

/** A field's error in words, from the code the schema or `server-errors.ts` gave it. */
export function useGuestFieldText(): (error: FieldError | undefined) => string | undefined {
  const { t } = useTranslation('guests');
  return (error) => {
    if (!error) return undefined;
    const code = error.message ?? '';
    return isFieldCode(code) ? t(`fields.errors.${code}`) : t('fields.errors.other');
  };
}
