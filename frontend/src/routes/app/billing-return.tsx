import {
  AppLoading,
  AppShell,
  appMeta,
  requireOrganizationChosen,
  requireSignedIn,
} from '@/features/account';
import { BillingReturnFailed, BillingReturnPage, confirmNewestInvoice } from '@/features/billing';
import { fetchPaymentOptions, NO_PAYMENTS, paymentProviderOf } from '@/api/payment-options';
import { languageOfMatches } from '@/lib/i18n';
import { revalidateUnlessQueryOnly, useDropBankQuery } from '@/lib/routing';
import { ROUTE_PATHS } from '@/route-paths';

import type { Route } from './+types/billing-return';

/**
 * Where the bank sends the payer back. It needs the session and asks the bank through the API; the
 * bank's own query goes no further than this address, not into a sign-in's `next` (design PD-130).
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);
  const withoutQuery = new Request(new URL(ROUTE_PATHS.billingPaymentReturn, url.origin));
  const { api } = await requireSignedIn(withoutQuery);
  await requireOrganizationChosen(api, url, ROUTE_PATHS.billingPaymentReturn);
  // The bank to pay again at: the API's, or none while payments are off (FR-109). Only "Pay again"
  // uses it, and its press words any refusal, so a failed read must not hide a confirmed payment.
  const [payment, read] = await Promise.all([
    fetchPaymentOptions(api).catch(() => NO_PAYMENTS),
    confirmNewestInvoice(api),
  ]);
  return { provider: paymentProviderOf(payment), read };
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
