import type { Invoice, InvoiceLine, Plan, PlanChoice, Subscription } from './types';

/**
 * Each field kept is named. A payment's order number opens its state to anyone (docs/API.md §1), so
 * neither it nor the bank's reason, which may quote it, goes further than here.
 */
interface InvoiceWire extends Omit<Invoice, 'lines' | 'paymentStatus'> {
  lines: unknown;
}

function readLine(wire: unknown): InvoiceLine[] {
  if (typeof wire !== 'object' || wire === null) return [];
  const { description, quantity, totalMinor, planKey } = wire as Record<string, unknown>;
  if (typeof description !== 'string' || typeof totalMinor !== 'string') return [];
  return [
    {
      description,
      quantity: typeof quantity === 'number' ? quantity : 1,
      totalMinor,
      planKey: typeof planKey === 'string' ? planKey : null,
    },
  ];
}

export function readInvoice(wire: InvoiceWire): Invoice {
  return {
    number: wire.number,
    status: wire.status,
    subtotalMinor: wire.subtotalMinor,
    taxMinor: wire.taxMinor,
    totalMinor: wire.totalMinor,
    currency: wire.currency,
    lines: Array.isArray(wire.lines) ? wire.lines.flatMap(readLine) : [],
    issuedAt: wire.issuedAt,
    dueAt: wire.dueAt,
    paidAt: wire.paidAt,
    paymentStatus: null,
  };
}

/** A confirm that didn't settle the invoice adds the payment; only its state is kept. */
export function readConfirmed(wire: InvoiceWire & { payment?: { status: string } }): Invoice {
  return { ...readInvoice(wire), paymentStatus: wire.payment?.status ?? null };
}

export function readPlan(wire: Plan): Plan {
  const { key, name, tier, priceMinor, currency, interval, entitlements } = wire;
  const { maxEventsPerPeriod, maxGuestsPerEvent, maxLocales, invitationLifetimeDays, features } =
    entitlements;
  return {
    key,
    name,
    tier,
    priceMinor,
    currency,
    interval,
    entitlements: {
      maxEventsPerPeriod,
      maxGuestsPerEvent,
      maxLocales,
      invitationLifetimeDays,
      features,
    },
  };
}

export function readSubscription(wire: Subscription): Subscription {
  const { key, name, priceMinor, currency, interval } = wire.plan;
  return {
    status: wire.status,
    plan: { key, name, priceMinor, currency, interval },
    currentPeriodEnd: wire.currentPeriodEnd,
    cancelAtPeriodEnd: wire.cancelAtPeriodEnd,
  };
}

interface ChoiceWire {
  subscription: unknown;
  invoice: unknown;
  payment: { redirectUrl: string | null } | null;
}

/** `invoice: null` is a free plan, active already; a paid one goes on at the bank's page. */
export function readChoice(wire: ChoiceWire): PlanChoice {
  return wire.invoice === null
    ? { kind: 'activated' }
    : { kind: 'bank', redirectUrl: wire.payment?.redirectUrl ?? null };
}
