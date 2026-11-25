import type { Invoice, InvoiceLine, Plan, PlanChoice, Subscription, PendingFree } from './types';

/**
 * Each field kept is named. A payment's order number opens its state to anyone (docs/API.md §1), so
 * neither it nor the bank's reason, which may quote it, goes further than here.
 */
interface InvoiceWire extends Omit<Invoice, 'lines' | 'paymentStatus'> {
  lines: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A line's words in the language asked for, if the line was issued with them (FR-110). */
function readLineDisplay(wire: unknown): InvoiceLine['display'] {
  if (!isRecord(wire) || typeof wire.description !== 'string') return null;
  return {
    locale: typeof wire.locale === 'string' ? wire.locale : null,
    description: wire.description,
  };
}

/** Lines are stored JSON: one written before a field existed lacks it (docs/API.md §6). */
function readLine(wire: unknown): InvoiceLine[] {
  if (!isRecord(wire)) return [];
  const { description, quantity, totalMinor, planKey, display } = wire;
  if (typeof description !== 'string' || typeof totalMinor !== 'string') return [];
  return [
    {
      description,
      quantity: typeof quantity === 'number' ? quantity : 1,
      totalMinor,
      planKey: typeof planKey === 'string' ? planKey : null,
      display: readLineDisplay(display),
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

function readPlanDisplay({ locale, name, features }: Plan['display']): Plan['display'] {
  return { locale, name, features: features.map(({ key, label }) => ({ key, label })) };
}

export function readPlan(wire: Plan): Plan {
  const { key, name, tier, priceMinor, currency, interval, entitlements, display } = wire;
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
    display: readPlanDisplay(display),
  };
}

/** `pendingFree` is absent from an older backend's answer, which never schedules one. */
type SubscriptionWire = Omit<Subscription, 'pendingFree'> & { pendingFree?: PendingFree | null };

export function readSubscription(wire: SubscriptionWire): Subscription {
  const { key, name, priceMinor, currency, interval, display } = wire.plan;
  const pending = wire.pendingFree ?? null;
  return {
    status: wire.status,
    plan: { key, name, priceMinor, currency, interval, display: readPlanDisplay(display) },
    currentPeriodEnd: wire.currentPeriodEnd,
    cancelAtPeriodEnd: wire.cancelAtPeriodEnd,
    pendingFree: pending && { planKey: pending.planKey, effectiveAt: pending.effectiveAt },
  };
}

/** `invoice` and `payment` are optional only to the type: openapi-fetch drops a field typed `null`. */
interface ChoiceWire {
  subscription: { pendingFree?: PendingFree | null } | null;
  invoice?: unknown;
  payment?: { redirectUrl: string | null } | null;
}

/**
 * `invoice: null` is a free plan: active already, or scheduled for the paid period's end when the
 * answer carries `pendingFree` (FR-135). A paid one goes on at the bank's page.
 */
export function readChoice(wire: ChoiceWire): PlanChoice {
  if (wire.invoice !== null && wire.invoice !== undefined)
    return { kind: 'bank', redirectUrl: wire.payment?.redirectUrl ?? null };
  const pending = wire.subscription?.pendingFree;
  return pending ? { kind: 'scheduled', effectiveAt: pending.effectiveAt } : { kind: 'activated' };
}
