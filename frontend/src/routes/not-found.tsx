import { data } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Route } from './+types/not-found';

export function loader() {
  return data(null, { status: 404 });
}

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
