import { expectData, type ApiClient, type PublicApiClient } from '@/api/client';

import { readChoice, readConfirmed, readInvoice, readPlan, readSubscription } from './read';

import type { Invoice, PaymentProvider, Plan, PlanChoice, Subscription } from './types';

export async function listPlans(api: PublicApiClient): Promise<Plan[]> {
  return (await expectData(api.GET('/api/v1/plans'))).map(readPlan);
}

/** `{ subscription: null }`: never subscribed, which is not an error. */
export async function currentSubscription(api: ApiClient): Promise<Subscription | null> {
  const { subscription } = await expectData(api.GET('/api/v1/subscription'));
  return subscription && readSubscription(subscription);
}

/** Newest first, at most a hundred (FR-110). */
export async function listInvoices(api: ApiClient): Promise<Invoice[]> {
  return (await expectData(api.GET('/api/v1/invoices'))).map(readInvoice);
}

/**
 * Starts or changes the plan. `returnUrl` is left out, so the bank returns to the backend's default,
 * `/billing/return`, on its own `PUBLIC_APP_URL`. A free plan needs no bank.
 */
export async function choosePlan(
  api: ApiClient,
  planKey: string,
  provider: PaymentProvider,
): Promise<PlanChoice> {
  const body = { planKey, ...(provider ? { provider } : {}) };
  return readChoice(await expectData(api.POST('/api/v1/subscription', { body })));
}

export async function cancelSubscription(api: ApiClient): Promise<void> {
  await expectData(api.POST('/api/v1/subscription/cancel'));
}

export async function resumeSubscription(api: ApiClient): Promise<void> {
  await expectData(api.POST('/api/v1/subscription/resume'));
}

/** Keeps the paid plan past its period's end; refused once the change has taken effect (FR-135). */
export async function withdrawFreeChange(api: ApiClient): Promise<void> {
  await expectData(api.DELETE('/api/v1/subscription/pending-free'));
}

/** Asks the bank, server to server. Safe to call twice (docs/API.md §6). */
export async function confirmInvoice(api: ApiClient, number: string): Promise<Invoice> {
  return readConfirmed(
    await expectData(
      api.POST('/api/v1/invoices/{number}/confirm', { params: { path: { number } } }),
    ),
  );
}
