import { useTranslation } from 'react-i18next';

import type { EventFieldCode } from './schemas';

const CODES: readonly string[] = [
  'required',
  'choose',
  'tooLong',
  'titleShort',
  'dateInvalid',
  'timeSkipped',
  'languages',
  'defaultLanguage',
  'timezone',
  'endsBefore',
  'endPair',
  'refused',
] satisfies EventFieldCode[];

function isFieldCode(code: string): code is EventFieldCode {
  return CODES.includes(code);
}

/** A field's error in words, from the code the schema or `refusedFields` gave it. */
export function useEventFieldText(): (
  error: { message?: unknown } | undefined,
) => string | undefined {
  const { t } = useTranslation('events');
  return (error) => {
    // A section whose own fields carry the errors has no message of its own: nothing to say.
    if (typeof error?.message !== 'string') return undefined;
    const code = error.message;
    return isFieldCode(code) ? t(`fields.errors.${code}`) : t('fields.errors.other');
  };
}
