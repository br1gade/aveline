import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import { PublicFrame } from '@/features/public-event';
import { holdBrief } from '@/features/vendor-brief';
import {
  createI18n,
  languageOf,
  negotiatedLanguageData,
  negotiatedLanguageHandle,
  passLoaderHeaders,
  SOURCE_LANGUAGE,
} from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';

import type { Route } from './+types/brief-link';

/**
 * The link a host sends a vendor (docs/API.md §6). Its token is a credential: the server renders
 * only a frame and never reads it; straight after hydration the page holds it in memory and the
 * address becomes `/briefs`, so it stays out of the history, bookmarks and screenshots (design
 * PD-124). entry.server.tsx keeps both addresses out of caches, referrers and indexes.
 */
export function loader({ request }: Route.LoaderArgs) {
  return negotiatedLanguageData(request);
}

export const headers = passLoaderHeaders;
export const handle = negotiatedLanguageHandle;

export function meta({ loaderData }: Route.MetaArgs) {
  const { t } = createI18n(languageOf(loaderData) ?? SOURCE_LANGUAGE);
  return [{ title: t('brief:title') }, { name: 'robots', content: 'noindex, nofollow' }];
}

export default function BriefLink({ params }: Route.ComponentProps) {
  const { t } = useTranslation('brief');
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    holdBrief(params.briefToken);
    const language = new URLSearchParams(location.search).get('lang');
    const query = language ? `?${new URLSearchParams({ lang: language }).toString()}` : '';
    void navigate(`${APP_PATHS.briefPage}${query}`, {
      replace: true,
    });
  }, [params.briefToken, location.search, navigate]);
  return (
    <PublicFrame>
      <p role="status" className="m-0">
        {t('opening')}
      </p>
    </PublicFrame>
  );
}
