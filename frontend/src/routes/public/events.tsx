import '@/locales/public';
import { data } from 'react-router';

import { ListingPage, publicListingMeta, readListingQuery } from '@/features/public-event';
import { loadPublicListing } from '@/features/public-event/index.server';
import {
  languageOf,
  negotiatedLanguageHandle,
  negotiateLanguage,
  passLoaderHeaders,
} from '@/lib/i18n';
import { publicListingHeaders } from '@/lib/security/headers';

import type { Route } from './+types/events';

/** Browsing public events: the page's language negotiated (design PD-40), and asked of the API. */
export async function loader({ request }: Route.LoaderArgs) {
  const { language, setCookie } = negotiateLanguage(request);
  const query = readListingQuery(new URL(request.url).searchParams);
  const listing = await loadPublicListing({ ...query, locale: language });
  return data(
    { language, query, listing },
    { headers: { ...publicListingHeaders(), ...(setCookie ? { 'Set-Cookie': setCookie } : {}) } },
  );
}

export const headers = passLoaderHeaders;
export const handle = negotiatedLanguageHandle;

export function meta({ loaderData }: Route.MetaArgs) {
  return publicListingMeta(languageOf(loaderData) ?? 'en');
}

export default function PublicEvents({ loaderData }: Route.ComponentProps) {
  return <ListingPage {...loaderData} />;
}
