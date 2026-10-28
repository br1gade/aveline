import type { FieldError } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { VenueFieldCode } from './schemas';

const CODES: readonly string[] = [
  'required',
  'choose',
  'tooLong',
  'mapUrl',
  'arrivalPair',
  'dateInvalid',
  'timeSkipped',
  'refused',
] satisfies VenueFieldCode[];

function isFieldCode(code: string): code is VenueFieldCode {
  return CODES.includes(code);
}

/** A field's error in words, from the code the schema or `refusedVenueFields` gave it. */
export function useVenueFieldText(): (error: FieldError | undefined) => string | undefined {
  const { t } = useTranslation('venues');
  return (error) => {
    if (!error) return undefined;
    const code = error.message ?? '';
    return isFieldCode(code) ? t(`fields.errors.${code}`) : t('fields.errors.other');
  };
}
