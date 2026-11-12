import '@/locales/public';
import { data } from 'react-router';

import { PrivacyNoticePage, privacyNoticeMeta } from '@/features/privacy-request';
import {
  languageOf,
  negotiatedLanguageHandle,
  negotiateLanguage,
  passLoaderHeaders,
} from '@/lib/i18n';
import { publicListingHeaders } from '@/lib/security/headers';

import type { Route } from './+types/privacy';

/** For anyone, with no session: the page's language negotiated, as the Help page's is. */
export function loader({ request }: Route.LoaderArgs) {
  const { language, setCookie } = negotiateLanguage(request);
  return data(
    { language },
    { headers: { ...publicListingHeaders(), ...(setCookie ? { 'Set-Cookie': setCookie } : {}) } },
  );
}

export const headers = passLoaderHeaders;
export const handle = negotiatedLanguageHandle;

export function meta({ loaderData }: Route.MetaArgs) {
  return privacyNoticeMeta(languageOf(loaderData) ?? 'en');
}

export default function Privacy() {
  return <PrivacyNoticePage />;
}
