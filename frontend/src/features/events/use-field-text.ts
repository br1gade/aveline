import type { FieldError } from 'react-hook-form';
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
  'refused',
] satisfies EventFieldCode[];

function isFieldCode(code: string): code is EventFieldCode {
  return CODES.includes(code);
}

/** A field's error in words, from the code the schema or `refusedFields` gave it. */
export function useEventFieldText(): (error: FieldError | undefined) => string | undefined {
  const { t } = useTranslation('events');
  return (error) => {
    if (!error) return undefined;
    const code = error.message ?? '';
    return isFieldCode(code) ? t(`fields.errors.${code}`) : t('fields.errors.other');
  };
}
