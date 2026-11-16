import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import {
  createI18n,
  languageOf,
  negotiatedLanguageData,
  negotiatedLanguageHandle,
  passLoaderHeaders,
} from '@/lib/i18n';
import { APP_PATHS, ROUTE_PATHS } from '@/route-paths';

import type { Route } from './+types/home';

/** In the visitor's language, as every page without an event of its own is (design PD-40). */
export function loader({ request }: Route.LoaderArgs) {
  return negotiatedLanguageData(request);
}

export const headers = passLoaderHeaders;
export const handle = negotiatedLanguageHandle;

const LINK =
  'text-action inline-flex min-h-11 items-center underline decoration-1 underline-offset-3 hover:decoration-2';

/** Search engines may list it (provisional, PD-204), with a description in the page's language. */
export function meta({ loaderData }: Route.MetaArgs) {
  const language = languageOf(loaderData) ?? 'en';
  const t = createI18n(language).getFixedT(language, 'common');
  return [{ title: 'Aveline' }, { name: 'description', content: t('home.body') }];
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
        {/* Hosts' way in: the front page had none (audit F-26). */}
        <Link to={ROUTE_PATHS.signIn} className={LINK}>
          {t('home.signIn')}
        </Link>
        <Link to={APP_PATHS.register} className={LINK}>
          {t('home.register')}
        </Link>
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
