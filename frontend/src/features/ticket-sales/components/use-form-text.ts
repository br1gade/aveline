import { useTranslation } from 'react-i18next';

/** A field's message in words: our codes are worded here; anything else is a refusal. */
export function useFormText() {
  const { t } = useTranslation('ticket-sales');
  return (message: string | undefined) =>
    message ? t(`errors.${message}`, { defaultValue: t('errors.refused') }) : undefined;
}

/**
 * A language's label on a form: its own name, the default marked, and one the event no longer
 * publishes marked too, since it is only there to keep its words.
 */
export function useLanguageLabel(event: { defaultLocale: string; locales: readonly string[] }) {
  const { t } = useTranslation('ticket-sales');
  return (language: string) => {
    const name = t(`common:language.${language}`, { defaultValue: language });
    if (language === event.defaultLocale) return `${name} · ${t('typeForm.default')}`;
    return event.locales.includes(language) ? name : `${name} · ${t('typeForm.notPublished')}`;
  };
}

/** The event's languages, its default first, as each form lists them. */
export function eventLanguages(event: {
  defaultLocale: string;
  locales: readonly string[];
}): string[] {
  return [
    event.defaultLocale,
    ...event.locales.filter((language) => language !== event.defaultLocale),
  ];
}
