import { useTranslation } from 'react-i18next';

import type { DesignFieldCode } from './schemas';

const CODES: readonly string[] = [
  'url',
  'colour',
  'noPrompt',
  'noChoices',
  'halfFilled',
  'noLabel',
  'labelTooLong',
  'tooManyChoices',
  'altTooLong',
  'refused',
] satisfies DesignFieldCode[];

function isFieldCode(code: string): code is DesignFieldCode {
  return CODES.includes(code);
}

/** A field's error in words, from the code a schema or a refusal gave it. */
export function useFieldText(): (
  error: { message?: string | undefined } | undefined,
) => string | undefined {
  const { t } = useTranslation('design');
  return (error) => {
    if (!error) return undefined;
    const code = error.message ?? '';
    return isFieldCode(code) ? t(`errors.${code}`) : t('errors.other');
  };
}
