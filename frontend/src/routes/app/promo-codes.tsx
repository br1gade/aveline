import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { loadPromoCodes, PromoCodesPage } from '@/features/promo-codes';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/promo-codes';

/** The organization's codes, and its events to limit one to. */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadPromoCodes(api);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('promoCodes', languageOfMatches(matches));
}

export default function PromoCodes({ loaderData }: Route.ComponentProps) {
  return <PromoCodesPage data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
