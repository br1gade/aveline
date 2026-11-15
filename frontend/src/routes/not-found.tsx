import { data } from 'react-router';
import { useTranslation } from 'react-i18next';

import { negotiateLanguage, negotiatedLanguageHandle, passLoaderHeaders } from '@/lib/i18n';

import type { Route } from './+types/not-found';

/**
 * No such page, in the visitor's language as every page without an event of its own is (design
 * PD-40): an Armenian or Russian guest whose link was mistyped read English (audit F-15).
 */
export function loader({ request }: Route.LoaderArgs) {
  const { language, setCookie } = negotiateLanguage(request);
  return data(
    { language },
    { status: 404, ...(setCookie ? { headers: { 'Set-Cookie': setCookie } } : {}) },
  );
}

export const headers = passLoaderHeaders;
export const handle = negotiatedLanguageHandle;

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Aveline' }, { name: 'robots', content: 'noindex' }];
}

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex min-h-svh max-w-[34rem] flex-col justify-center gap-4 px-5 py-16">
      <h1 className="text-heading font-serif text-[28px] leading-[34px]">{t('notFound.title')}</h1>
      <p>{t('notFound.body')}</p>
    </main>
  );
}
