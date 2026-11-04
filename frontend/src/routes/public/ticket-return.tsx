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

import { useDropBankQuery } from '@/lib/routing';

import type { Route } from './+types/ticket-return';

/**
 * Where the bank sends the buyer back (docs/API.md §5). The return proves nothing: the page
 * confirms with the token this tab holds, server to server through the API, and shows what that
 * says (design PD-82). The bank's own query is taken out of the address first.
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

export default function TicketReturn() {
  useDropBankQuery();
  return <OrderPage confirmFirst />;
}
