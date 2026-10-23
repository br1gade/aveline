import { useTranslation } from 'react-i18next';

import type { Route } from './+types/home';

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Aveline' }, { name: 'robots', content: 'noindex' }];
}

/** A placeholder until the public site exists. Guests arrive on their personal links. */
export default function Home() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex min-h-svh max-w-[34rem] flex-col justify-center gap-4 px-5 py-16">
      <h1 className="text-heading font-serif text-[36px] leading-[42px] font-light">
        {t('home.title')}
      </h1>
      <p>{t('home.body')}</p>
    </main>
  );
}
