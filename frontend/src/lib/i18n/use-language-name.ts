import { useTranslation } from 'react-i18next';

import { isLanguage } from './i18n';

/** A language in its own name; a code Aveline does not offer is shown as the code. */
export function useLanguageName(): (code: string) => string {
  const { t } = useTranslation('common');
  return (code) => (isLanguage(code) ? t(`language.${code}`) : code);
}
