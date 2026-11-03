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
  'capacity',
  'cantClear',
] satisfies VenueFieldCode[];

function isFieldCode(code: string): code is VenueFieldCode {
  return CODES.includes(code);
}

/** A field's error in words, from the code the schema or `refusedVenueFields` gave it. */
export function useVenueFieldText(): (
  error: { message?: unknown } | undefined,
) => string | undefined {
  const { t } = useTranslation('venues');
  return (error) => {
    // A section whose own fields carry the errors has no message of its own: nothing to say.
    if (typeof error?.message !== 'string') return undefined;
    const code = error.message;
    return isFieldCode(code) ? t(`fields.errors.${code}`) : t('fields.errors.other');
  };
}
