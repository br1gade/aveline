import type { ApiClient } from '@/api/client';
import { fetchPaymentOptions, type PaymentOptions } from '@/api/payment-options';
import type { CursorPage } from '@/ui/app-form';

import { confirmInvoice, currentSubscription, listInvoices, listPlans } from './api';
import { billingRefusalOf, type BillingRefusal } from './refusals';
import type { Invoice, Plan, Subscription } from './types';

type Read<T> = { kind: 'ready'; value: T } | { kind: 'refused'; refusal: BillingRefusal };

export interface BillingData {
  plans: Plan[];
  subscription: Read<Subscription | null>;
  /** The first page; the rest is read on request. */
  invoices: Read<CursorPage<Invoice>>;
  /** Whether a paid plan can be bought now, and with which bank (FR-109). */
  payment: PaymentOptions;
  /** The clock a subscription's standing is read at, so a render never reads it again. */
  now: number;
}

async function orRefusal<T>(read: Promise<T>): Promise<Read<T>> {
  try {
    return { kind: 'ready', value: await read };
  } catch (error) {
    return { kind: 'refused', refusal: billingRefusalOf(error) };
  }
}

/**
 * The price list is public; the rest is the owner's, so its refusal leaves the plans showing. The
 * payment options are read like the plans: without them the page can't say what can be bought.
 */
export async function loadBilling(api: ApiClient): Promise<BillingData> {
  const [plans, subscription, invoices, payment] = await Promise.all([
    listPlans(api),
    orRefusal(currentSubscription(api)),
    orRefusal(listInvoices(api)),
    fetchPaymentOptions(api),
  ]);
  return { plans, subscription, invoices, payment, now: Date.now() };
}

export type ReturnRead =
  | { kind: 'nothing' }
  | { kind: 'confirmed'; invoice: Invoice; organizationId?: string }
  | { kind: 'refused'; refusal: BillingRefusal };

/** Correlation selects an authenticated invoice; server-to-server confirmation proves payment. */
export async function confirmReturnedInvoice(
  api: ApiClient,
  context: { number: string; organizationId: string } | null,
): Promise<ReturnRead> {
  if (!context) return { kind: 'nothing' };
  try {
    return {
      kind: 'confirmed',
      invoice: await confirmInvoice(api, context.number, context.organizationId),
      organizationId: context.organizationId,
    };
  } catch (error) {
    return { kind: 'refused', refusal: billingRefusalOf(error) };
  }
}
