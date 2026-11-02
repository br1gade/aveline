/**
 * Buying tickets for a public event (docs/API.md §5, design PD-79 and PD-80): one named person
 * per ticket, their own venue choices and answers, a promo code, and the order with one
 * idempotency key per attempt. The hosts' registration of a legacy ticket reuses the person's
 * details.
 */
export { CheckoutPage, type CheckoutPageProps } from './components/checkout-page';
export { HolderForm, type HolderFormProps } from './components/holder-form';
export type { AttendeeBody, PaymentProvider } from './types';
