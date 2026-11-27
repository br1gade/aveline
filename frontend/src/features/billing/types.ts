import type { components } from '@/api/schema';

/**
 * Checked against the schema at each call (FR-1); read against `subscriptions.service.ts` at
 * `34ac1e6`.
 */
export interface Entitlements {
  maxEventsPerPeriod: number | null;
  maxGuestsPerEvent: number | null;
  maxLocales: number;
  invitationLifetimeDays: number | null;
  features: string[];
}

/**
 * A plan's words in the language the backend answered (FR-110): `locale: null` when it holds no
 * translation, so `name` is the plan's own name. A feature's `key` decides; its `label` is shown.
 */
export interface PlanDisplay {
  locale: string | null;
  name: string;
  features: Array<{ key: string; label: string }>;
}

export interface Plan {
  key: string;
  name: string;
  tier: string;
  priceMinor: string;
  currency: string;
  interval: string;
  entitlements: Entitlements;
  display: PlanDisplay;
}

/** A move to a free plan once the paid period ends, which can still be withdrawn (FR-135). */
export interface PendingFree {
  planKey: string;
  effectiveAt: string;
}

/** A next period paid early, which starts when the current one ends (FR-110 e). */
export interface PendingRenewal {
  number: string;
  start: string;
  end: string;
}

export interface Subscription {
  /** The backend's say on "Renew plan"; it weighs status, cancellation, Free changes and the plan. */
  canRenew: boolean;
  /** The current period's end, or the reserved one's when a renewal is paid for. */
  paidThrough: string;
  pendingRenewal: PendingRenewal | null;
  status: string;
  plan: Pick<Plan, 'key' | 'name' | 'priceMinor' | 'currency' | 'interval' | 'display'>;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  pendingFree: PendingFree | null;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  totalMinor: string;
  /** On every plan invoice's line (docs/API.md §6, FR-110). */
  planKey: string | null;
  /** The line in the language asked for; absent from a line older than translations (FR-110). */
  display: { locale: string | null; description: string } | null;
}

export interface Invoice {
  kind: 'PURCHASE' | 'RENEWAL';
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

/** What choosing a plan comes to: at once, at the paid period's end (FR-135), or at the bank. */
export type PlanChoice =
  | { kind: 'activated' }
  | { kind: 'scheduled'; effectiveAt: string }
  | { kind: 'bank'; redirectUrl: string | null };

/** From the schema, so a bank the API stops taking fails the typecheck. */
export type PaymentProvider = components['schemas']['SubscribeDto']['provider'];
