import { useTranslation } from 'react-i18next';

import { LANGUAGES, SOURCE_LANGUAGE, type Language } from '@/lib/i18n';

import { FooterMark } from './footer-mark';

function Message({ language }: { language: Language }) {
  const { i18n } = useTranslation('invitation');
  const t = i18n.getFixedT(language, 'invitation');
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
 * A link that opens no invitation: wrong, a draft, or past its retention date (spec §7, C-22).
 * Nothing is known about the event or the guest's language, so it says so in all three, English
 * first, and shows no event details.
 */
export function InvitationNotFound() {
  const others = LANGUAGES.filter((language) => language !== SOURCE_LANGUAGE);
  return (
    <div data-theme="bordeaux" className="bg-surface text-text flex min-h-svh flex-col">
      <main className="mx-auto flex w-full max-w-[34rem] flex-auto flex-col justify-center gap-8 px-5 py-16 text-center">
        <Message language={SOURCE_LANGUAGE} />
        {others.map((language) => (
          <Message key={language} language={language} />
        ))}
      </main>
      <FooterMark />
    </div>
  );
}
