import {
  AppLoading,
  AppShell,
  appMeta,
  requireOrganizationChosen,
  requireSignedIn,
} from '@/features/account';
import { BillingReturnFailed, BillingReturnPage, confirmNewestInvoice } from '@/features/billing';
import { readServerEnv } from '@/config/env.server';
import { languageOfMatches } from '@/lib/i18n';
import { revalidateUnlessQueryOnly, useDropBankQuery } from '@/lib/routing';
import { ROUTE_PATHS } from '@/route-paths';

import type { Route } from './+types/billing-return';

/** The bank to pay again at, a server setting until the API says which are set up (FR-109). */
export function loader() {
  return { provider: readServerEnv().TICKET_PAYMENT_PROVIDER };
}

/**
 * Where the bank sends the payer back. It needs the session and asks the bank through the API; the
 * bank's own query goes no further than this address, not into a sign-in's `next` (design PD-130).
 */
export async function clientLoader({ request, serverLoader }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);
  const withoutQuery = new Request(new URL(ROUTE_PATHS.billingPaymentReturn, url.origin));
  const { api } = await requireSignedIn(withoutQuery);
  await requireOrganizationChosen(api, url, ROUTE_PATHS.billingPaymentReturn);
  const [{ provider }, read] = await Promise.all([serverLoader(), confirmNewestInvoice(api)]);
  return { provider, read };
}
clientLoader.hydrate = true as const;

/** Taking the bank's query out of the address must not confirm a second time. */
export const shouldRevalidate = revalidateUnlessQueryOnly;

export function HydrateFallback() {
  return <AppLoading />;
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('billingReturn', languageOfMatches(matches));
}

export default function BillingReturn({ loaderData }: Route.ComponentProps) {
  useDropBankQuery();
  return (
    <AppShell>
      <BillingReturnPage read={loaderData.read} provider={loaderData.provider} />
    </AppShell>
  );
}

/** Back from the bank with nothing read: billing's words, a way to try again, the query gone. */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  useDropBankQuery();
  return (
    <AppShell>
      <BillingReturnFailed error={error} />
    </AppShell>
  );
}
