import {
  AppLoading,
  AppShell,
  appMeta,
  requireOrganizationChosen,
  requireSignedIn,
} from '@/features/account';
import { BillingReturnFailed, BillingReturnPage, confirmReturnedInvoice } from '@/features/billing';
import { fetchPaymentOptions, NO_PAYMENTS, paymentProviderOf } from '@/api/payment-options';
import { languageOfMatches } from '@/lib/i18n';
import { revalidateUnlessQueryOnly, useDropBankQuery } from '@/lib/routing';
import { billingReturnContext, billingReturnPath } from '@/lib/routing/billing-return';

import type { Route } from './+types/billing-return';

/**
 * Where the bank sends the payer back. It needs the session and asks the bank through the API; the
 * bank's own query goes no further than this address, not into a sign-in's `next` (design PD-130).
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);
  const context = billingReturnContext(url);
  const path = billingReturnPath(url);
  const { api } = await requireSignedIn(new Request(new URL(path, url.origin)));
  if (!context) await requireOrganizationChosen(api, url, path);
  // The bank to pay again at: the API's, or none while payments are off (FR-109). Only "Pay again"
  // uses it, and its press words any refusal, so a failed read must not hide a confirmed payment.
  const [payment, read] = await Promise.all([
    fetchPaymentOptions(api).catch(() => NO_PAYMENTS),
    confirmReturnedInvoice(api, context),
  ]);
  return { provider: paymentProviderOf(payment), read };
}
clientLoader.hydrate = true as const;

/** Taking the bank's query out of the address must not confirm a second time. */
export const shouldRevalidate: typeof revalidateUnlessQueryOnly = (args) => {
  if (billingReturnPath(args.currentUrl) !== billingReturnPath(args.nextUrl)) return true;
  return revalidateUnlessQueryOnly(args);
};

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
