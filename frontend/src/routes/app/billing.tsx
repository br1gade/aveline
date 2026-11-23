import { appMeta, requireSignedIn } from '@/features/account';
import { BillingPage, loadBilling } from '@/features/billing';
import { EventUnavailable } from '@/features/events';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/billing';

/** The plans, the organization's own, and whether a paid plan can be bought now (FR-109). */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return { data: await loadBilling(api) };
}
clientLoader.hydrate = true as const;

/** The layout above shows the loading state until the session is read. */
export function HydrateFallback() {
  return null;
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('billing', languageOfMatches(matches));
}

export default function Billing({ loaderData }: Route.ComponentProps) {
  return <BillingPage data={loaderData.data} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
