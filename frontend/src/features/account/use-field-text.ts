import type { FieldError } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { FieldCode } from './schemas';

const CODES: readonly string[] = [
  'required',
  'email',
  'passwordShort',
  'nameShort',
  'tooLong',
] satisfies FieldCode[];

function isFieldCode(code: string): code is FieldCode {
  return CODES.includes(code);
}

/** A field's error in words, from the code the schema gave it. */
export function useFieldText(): (error: FieldError | undefined) => string | undefined {
  const { t } = useTranslation('account');
  return (error) => {
    if (!error) return undefined;
    const code = error.message ?? '';
    return isFieldCode(code) ? t(`fields.errors.${code}`) : t('fields.errors.other');
  };
}
