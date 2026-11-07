import { useTranslation } from 'react-i18next';

import { LANGUAGES, SOURCE_LANGUAGE, type Language } from '@/lib/i18n';

import { PublicFrame } from './public-frame';

function Message({ language }: { language: Language }) {
  const { i18n } = useTranslation('public-event');
  const t = i18n.getFixedT(language, 'public-event');
  if (language === SOURCE_LANGUAGE) {
    return (
      <div lang={language} className="flex flex-col gap-4">
        <h1 className="type-display-l text-heading m-0">{t('notFound.title')}</h1>
        <p className="m-0">{t('notFound.body')}</p>
      </div>
    );
  }
  return (
    <p lang={language} className="text-text-muted m-0">
      {t('notFound.sentence')}
    </p>
  );
}

/**
 * An address that opens no public event: unpublished, private, archived or never there. Nothing
 * says which language to use, so it says so in all four, English first, as the invitation does.
 */
export function EventNotFound() {
  const others = LANGUAGES.filter((language) => language !== SOURCE_LANGUAGE);
  return (
    <PublicFrame>
      <div className="flex flex-col gap-8 py-10 text-center">
        <Message language={SOURCE_LANGUAGE} />
        {others.map((language) => (
          <Message key={language} language={language} />
        ))}
      </div>
    </PublicFrame>
  );
}
