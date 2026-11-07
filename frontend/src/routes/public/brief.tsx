import '@/locales/public';
import { BriefPage } from '@/features/vendor-brief';
import {
  createI18n,
  languageOf,
  negotiatedLanguageData,
  negotiatedLanguageHandle,
  passLoaderHeaders,
  SOURCE_LANGUAGE,
} from '@/lib/i18n';

import type { Route } from './+types/brief';

/**
 * A vendor's brief, read in the browser with the token this page holds (design PD-124). The server
 * renders only the frame: it never sees the token. entry.server.tsx keeps the page out of caches,
 * referrers and indexes. The brief names no language (FR-104), so the page negotiates one (PD-40).
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

export default function Brief() {
  return <BriefPage />;
}
