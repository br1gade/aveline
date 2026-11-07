import type { FieldError } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { TableFieldCode } from './schemas';

const CODES: readonly string[] = [
  'required',
  'tooLong',
  'seats',
  'count',
  'belowSeated',
  'nameTaken',
  'chairsOutside',
  'refused',
] satisfies TableFieldCode[];

function isFieldCode(code: string): code is TableFieldCode {
  return CODES.includes(code);
}

/** A field's error in words, from the code the schema or `refusedTableFields` gave it. */
export function useTableFieldText(): (error: FieldError | undefined) => string | undefined {
  const { t } = useTranslation('seating');
  return (error) => {
    if (!error) return undefined;
    const code = error.message ?? '';
    return isFieldCode(code) ? t(`fields.errors.${code}`) : t('fields.errors.other');
  };
}
