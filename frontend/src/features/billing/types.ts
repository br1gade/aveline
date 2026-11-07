import type { components } from '@/api/schema';

/** Interim until FR-1: read against `subscriptions.service.ts` at `34ac1e6`. */
export interface Entitlements {
  maxEventsPerPeriod: number | null;
  maxGuestsPerEvent: number | null;
  maxLocales: number;
  invitationLifetimeDays: number | null;
  features: string[];
}

export interface Plan {
  key: string;
  name: string;
  tier: string;
  priceMinor: string;
  currency: string;
  interval: string;
  entitlements: Entitlements;
}

export interface Subscription {
  status: string;
  plan: Pick<Plan, 'key' | 'name' | 'priceMinor' | 'currency' | 'interval'>;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  totalMinor: string;
  /** Not in docs/API.md; the backend stores it on every plan invoice (FR-110). */
  planKey: string | null;
}

export interface Invoice {
  number: string;
  status: string;
  subtotalMinor: string;
  taxMinor: string;
  totalMinor: string;
  currency: string;
  lines: InvoiceLine[];
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  /** What a confirm learned of the payment; absent from a list. */
  paymentStatus: string | null;
}

/** What choosing a plan comes to. */
export type PlanChoice = { kind: 'activated' } | { kind: 'bank'; redirectUrl: string | null };

/** From the schema, so a bank the API stops taking fails the typecheck. */
export type PaymentProvider = components['schemas']['SubscribeDto']['provider'];
