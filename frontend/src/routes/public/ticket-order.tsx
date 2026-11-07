import '@/locales/public';
import { OrderPage } from '@/features/ticket-order';
import {
  createI18n,
  languageOf,
  negotiatedLanguageData,
  negotiatedLanguageHandle,
  passLoaderHeaders,
  SOURCE_LANGUAGE,
} from '@/lib/i18n';

import type { Route } from './+types/ticket-order';

/**
 * The buyer's order, read in the browser with the token this tab holds (design PD-81). The server
 * renders only the frame: it never sees the token. entry.server.tsx keeps the page out of caches,
 * referrers and indexes. The order names no language (FR-62), so the page negotiates one (PD-40).
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

export default function TicketOrder() {
  return <OrderPage />;
}
