import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import { PublicFrame } from '@/features/public-event';
import { holdOrder } from '@/features/ticket-order';
import {
  createI18n,
  languageOf,
  negotiatedLanguageData,
  negotiatedLanguageHandle,
  passLoaderHeaders,
  SOURCE_LANGUAGE,
} from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';

import type { Route } from './+types/ticket-link';

/**
 * The order link the backend emails (`ticket-notifier.service.ts`). Its token is a credential:
 * the server renders only a frame and never reads it; straight after hydration the tab holds it
 * and the address becomes `/tickets`, so it stays out of the history, bookmarks and screenshots
 * (frontend CLAUDE.md §4, design PD-81).
 */
export function loader({ request }: Route.LoaderArgs) {
  return negotiatedLanguageData(request);
}

export const headers = passLoaderHeaders;
export const handle = negotiatedLanguageHandle;

export function meta({ loaderData }: Route.MetaArgs) {
  const { t } = createI18n(languageOf(loaderData) ?? SOURCE_LANGUAGE);
  return [{ title: t('ticket-order:title') }, { name: 'robots', content: 'noindex, nofollow' }];
}

export default function TicketLink({ params }: Route.ComponentProps) {
  const { t } = useTranslation('ticket-order');
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    holdOrder({ accessToken: params.accessToken });
    const language = new URLSearchParams(location.search).get('lang');
    void navigate(`${APP_PATHS.ticketOrder}${language ? `?lang=${language}` : ''}`, {
      replace: true,
    });
  }, [params.accessToken, location.search, navigate]);
  return (
    <PublicFrame>
      <p role="status" className="m-0">
        {t('opening')}
      </p>
    </PublicFrame>
  );
}
