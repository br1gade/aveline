import { expectData, type PublicApiClient, type ResponseOf } from './client';

/**
 * Whether anything can be paid for now, and the banks a paid order or plan may name (docs/API.md,
 * "Plans and subscriptions"). While payments are off, the free pilot, it is always "no, none".
 * Checkout, the price list and the host's ticket form all read it before anyone types (audit F-09).
 */
export type PaymentOptions = ResponseOf<'PaymentOptionsController_optionsResponse'>;

export type PaymentProvider = PaymentOptions['providers'][number];

/**
 * Nothing can be paid for: what the pilot answers, and how a malformed `checkout.payment` or a
 * failed read is taken where the page must not fail over it (the bank's return page).
 */
export const NO_PAYMENTS: PaymentOptions = { isPaymentAvailable: false, providers: [] };

export async function fetchPaymentOptions(api: PublicApiClient): Promise<PaymentOptions> {
  return expectData(api.GET('/api/v1/payment-options'));
}

/** The bank a paid order or plan goes to: the first the API offers, or none. */
export function paymentProviderOf(options: PaymentOptions): PaymentProvider | undefined {
  return options.isPaymentAvailable ? options.providers[0] : undefined;
}
