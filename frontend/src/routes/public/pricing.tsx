import '@/locales/public';
// The plans' words are billing's, in the app's strings; creating an account, the next step, loads them too.
import '@/locales/app';
import { data } from 'react-router';

import { PricingPage, pricingMeta } from '@/features/billing';
import { loadPricing } from '@/features/billing/index.server';
import {
  languageOf,
  negotiatedLanguageHandle,
  negotiateLanguage,
  passLoaderHeaders,
} from '@/lib/i18n';
import { publicListingHeaders } from '@/lib/security/headers';

import type { Route } from './+types/pricing';

/** The price list, public (docs/API.md §6): the page's language negotiated, as browsing's is. */
export async function loader({ request }: Route.LoaderArgs) {
  const { language, setCookie } = negotiateLanguage(request);
  const { plans } = await loadPricing();
  return data(
    { language, plans },
    { headers: { ...publicListingHeaders(), ...(setCookie ? { 'Set-Cookie': setCookie } : {}) } },
  );
}

export const headers = passLoaderHeaders;
export const handle = negotiatedLanguageHandle;

export function meta({ loaderData }: Route.MetaArgs) {
  return pricingMeta(languageOf(loaderData) ?? 'en');
}

export default function Pricing({ loaderData }: Route.ComponentProps) {
  return <PricingPage plans={loaderData.plans} />;
}
