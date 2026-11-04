import { appMeta, requireSignedIn } from '@/features/account';
import { BillingPage, loadBilling } from '@/features/billing';
import { EventUnavailable } from '@/features/events';
import { readServerEnv } from '@/config/env.server';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/billing';

/** The bank a paid plan is sent to, a server setting until the API says which are set up (FR-109). */
export function loader() {
  return { provider: readServerEnv().TICKET_PAYMENT_PROVIDER };
}

export async function clientLoader({ request, serverLoader }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  const [{ provider }, data] = await Promise.all([serverLoader(), loadBilling(api)]);
  return { provider, data };
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
  return <BillingPage data={loaderData.data} provider={loaderData.provider} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
