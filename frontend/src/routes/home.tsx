import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { APP_PATHS, ROUTE_PATHS } from '@/route-paths';

import type { Route } from './+types/home';

const LINK =
  'text-action inline-flex min-h-11 items-center underline decoration-1 underline-offset-3 hover:decoration-2';

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
      <nav className="flex flex-wrap gap-x-6">
        <Link to={APP_PATHS.publicEvents} className={LINK}>
          {t('home.browse')}
        </Link>
        <Link to={APP_PATHS.pricing} className={LINK}>
          {t('home.pricing')}
        </Link>
        <Link to={ROUTE_PATHS.privacyRequest} className={LINK}>
          {t('home.privacy')}
        </Link>
        <Link to={APP_PATHS.help} className={LINK}>
          {t('support.link')}
        </Link>
      </nav>
    </main>
  );
}
