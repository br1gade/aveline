// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';
import { organizationChoice } from '@/api/session';
import { plantedToken } from '../../../test/tokens';

import { choiceKind, isFree, offerFor, standing } from './plans';
import { readChoice, readConfirmed, readInvoice, readSubscription } from './read';
import { billingRefusalOf, PILOT_SENTENCE } from './refusals';
import { returnOutcome } from './return-outcome';
import type { Invoice, Plan, Subscription } from './types';

const BACKEND = join(import.meta.dirname, '../../../../backend/src/modules');

const NOW = Date.parse('2026-11-04T10:00:00Z');
const LATER = '2026-12-04T10:00:00Z';
const EARLIER = '2026-10-04T10:00:00Z';

function plan(key: string, priceMinor: string): Plan {
  return {
    key,
    name: key,
    tier: 'MANAGED',
    priceMinor,
    currency: 'AMD',
    interval: 'MONTHLY',
    entitlements: {
      maxEventsPerPeriod: 3,
      maxGuestsPerEvent: 400,
      maxLocales: 3,
      invitationLifetimeDays: null,
      features: [],
    },
  };
}

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    status: 'ACTIVE',
    plan: { key: 'paid', name: 'Paid', priceMinor: '25000', currency: 'AMD', interval: 'MONTHLY' },
    currentPeriodEnd: LATER,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  number: 'AV-2026-000001',
  status: 'ISSUED',
  subtotalMinor: '25000',
  taxMinor: '0',
  totalMinor: '25000',
  currency: 'AMD',
  lines: [],
  issuedAt: null,
  dueAt: null,
  paidAt: null,
  paymentStatus: null,
  ...overrides,
});

function apiError(status: number, message: string, code?: string) {
  return new ApiError({
    status,
    messages: [message],
    requestId: 'req-1',
    feedback: { code, action: undefined, userMessage: undefined, details: [] },
  });
}

describe('a price of nothing', () => {
  it.each([
    ['0', true],
    ['00', true],
    ['1', false],
    ['25000', false],
    ['90071992547409930', false],
  ])('%s free: %s', (priceMinor, expected) => {
    expect(isFree(priceMinor)).toBe(expected);
  });
});

describe('where a subscription stands', () => {
  it.each<[Partial<Subscription>, string]>([
    [{}, 'active'],
    [{ cancelAtPeriodEnd: true }, 'ending'],
    [{ currentPeriodEnd: EARLIER }, 'lapsed'],
    [{ currentPeriodEnd: EARLIER, cancelAtPeriodEnd: true }, 'lapsed'],
    [{ status: 'TRIALING' }, 'trial'],
    [{ status: 'PAST_DUE' }, 'pastDue'],
    [{ status: 'CANCELLED' }, 'ended'],
    [{ status: 'EXPIRED' }, 'ended'],
    [{ status: 'SOMETHING_NEW' }, 'unknown'],
  ])('%o is %s', (overrides, expected) => {
    expect(standing(subscription(overrides), NOW)).toBe(expected);
  });

  it('counts the very moment the period ends as still inside it', () => {
    expect(standing(subscription({ currentPeriodEnd: new Date(NOW).toISOString() }), NOW)).toBe(
      'active',
    );
  });
});

describe('what a plan offers', () => {
  it('offers everything to an organization with no subscription', () => {
    expect(offerFor(plan('paid', '25000'), null, NOW)).toBe('choose');
  });

  it('marks the current plan rather than offering it', () => {
    expect(offerFor(plan('paid', '25000'), subscription(), NOW)).toBe('current');
    expect(offerFor(plan('paid', '25000'), subscription({ cancelAtPeriodEnd: true }), NOW)).toBe(
      'current',
    );
  });

  it('offers the same plan again once its period lapsed or it ended', () => {
    const lapsed = subscription({ currentPeriodEnd: EARLIER });
    expect(offerFor(plan('paid', '25000'), lapsed, NOW)).toBe('choose');
    expect(offerFor(plan('paid', '25000'), subscription({ status: 'CANCELLED' }), NOW)).toBe(
      'choose',
    );
  });

  it('offers another plan', () => {
    expect(offerFor(plan('other', '9000'), subscription(), NOW)).toBe('choose');
  });
});

describe('what choosing says first', () => {
  it.each([
    ['paid first', plan('paid', '25000'), null, 'paid'],
    ['a free first', plan('free', '0'), null, 'free'],
    ['a change of paid plan', plan('other', '9000'), subscription(), 'paidChange'],
    ['free over a paid period', plan('free', '0'), subscription(), 'freeOverPaid'],
    [
      'free over a lapsed period',
      plan('free', '0'),
      subscription({ currentPeriodEnd: EARLIER }),
      'free',
    ],
    [
      'free over free',
      plan('free2', '0'),
      subscription({ plan: { ...subscription().plan, priceMinor: '0' } }),
      'free',
    ],
  ])('%s', (_name, target, current, expected) => {
    expect(choiceKind(target, current, NOW)).toBe(expected);
  });
});

describe('the readers keep no order number and no bank address beyond the one to follow', () => {
  const orderNumber = `AVL-${plantedToken()}`;

  it('an invoice', () => {
    const wire = {
      number: 'AV-2026-000001',
      status: 'ISSUED',
      subtotalMinor: '25000',
      taxMinor: '0',
      totalMinor: '25000',
      currency: 'AMD',
      lines: [
        {
          description: 'Managed (monthly)',
          planKey: 'managed-monthly',
          quantity: 1,
          unitPriceMinor: '25000',
          totalMinor: '25000',
        },
      ],
      issuedAt: EARLIER,
      dueAt: LATER,
      paidAt: null,
      paymentOrderNumber: orderNumber,
    };
    const read = readInvoice(wire);
    expect(JSON.stringify(read)).not.toContain(orderNumber);
    expect(read.lines).toEqual([
      {
        description: 'Managed (monthly)',
        planKey: 'managed-monthly',
        quantity: 1,
        totalMinor: '25000',
      },
    ]);
  });

  it('an invoice whose stored lines are not what they should be', () => {
    const read = readInvoice({ ...invoice(), lines: 'not a list' });
    expect(read.lines).toEqual([]);
  });

  it('a confirm answers with the payment state alone', () => {
    const wire = {
      ...invoice(),
      paymentOrderNumber: orderNumber,
      payment: {
        orderNumber,
        status: 'FAILED',
        provider: 'FAKE',
        amountMinor: '25000',
        refundedMinor: '0',
        currency: 'AMD',
        redirectUrl: 'https://bank.example/x',
        failureReason: `declined ${orderNumber}`,
      },
    };
    const read = readConfirmed(wire);
    expect(read.paymentStatus).toBe('FAILED');
    expect(JSON.stringify(read)).not.toContain(orderNumber);
    expect(JSON.stringify(read)).not.toContain('bank.example');
  });

  it('a subscription', () => {
    const wire = {
      ...subscription(),
      plan: { ...subscription().plan, tier: 'MANAGED' },
      entitlements: {},
      currentPeriodStart: EARLIER,
      cancelledAt: null,
      trialEndsAt: null,
    };
    const read = readSubscription(wire);
    expect(Object.keys(read).sort()).toEqual(
      ['cancelAtPeriodEnd', 'currentPeriodEnd', 'plan', 'status'].sort(),
    );
  });

  it('a free plan activated', () => {
    expect(
      readChoice({
        subscription: { ...subscription() },
        invoice: null,
        payment: null,
      }),
    ).toEqual({ kind: 'activated' });
  });

  it('a paid plan to pay at the bank', () => {
    const wire = {
      subscription: null,
      invoice: { ...invoice(), paymentOrderNumber: orderNumber },
      payment: { orderNumber, redirectUrl: 'https://bank.example/pay' },
    };
    expect(readChoice(wire)).toEqual({ kind: 'bank', redirectUrl: 'https://bank.example/pay' });
  });

  it('a paid plan the bank gave no page for', () => {
    const wire = {
      subscription: null,
      invoice: invoice(),
      payment: { orderNumber, redirectUrl: null },
    };
    expect(readChoice(wire)).toEqual({ kind: 'bank', redirectUrl: null });
  });
});

describe('what the return says', () => {
  it.each<[Partial<Invoice>, string]>([
    [{ status: 'PAID' }, 'paid'],
    [{ status: 'PAID', paymentStatus: 'CAPTURED' }, 'paid'],
    [{ status: 'ISSUED' }, 'awaitingBank'],
    [{ status: 'ISSUED', paymentStatus: 'CREATED' }, 'awaitingBank'],
    [{ status: 'ISSUED', paymentStatus: 'PENDING' }, 'awaitingBank'],
    [{ status: 'ISSUED', paymentStatus: 'AUTHORIZED' }, 'awaitingBank'],
    [{ status: 'ISSUED', paymentStatus: 'SOMETHING_NEW' }, 'awaitingBank'],
    [{ status: 'ISSUED', paymentStatus: 'FAILED' }, 'notPaid'],
    [{ status: 'ISSUED', paymentStatus: 'CANCELLED' }, 'notPaid'],
    [{ status: 'ISSUED', paymentStatus: 'EXPIRED' }, 'notPaid'],
    [{ status: 'VOID', paymentStatus: 'FAILED' }, 'replaced'],
    [{ status: 'VOID', paymentStatus: 'CANCELLED' }, 'replaced'],
    [{ status: 'VOID', paymentStatus: 'EXPIRED' }, 'replaced'],
    [{ status: 'VOID' }, 'replacedOpen'],
    [{ status: 'VOID', paymentStatus: 'PENDING' }, 'replacedOpen'],
    [{ status: 'VOID', paymentStatus: 'AUTHORIZED' }, 'replacedOpen'],
    [{ status: 'VOID', paymentStatus: 'SOMETHING_NEW' }, 'replacedOpen'],
    [{ status: 'VOID', paymentStatus: 'REFUNDED' }, 'refunded'],
    [{ status: 'VOID', paymentStatus: 'PARTIALLY_REFUNDED' }, 'refunded'],
    [{ status: 'VOID', paymentStatus: 'CAPTURED' }, 'refunded'],
    [{ status: 'UNCOLLECTIBLE' }, 'closed'],
    [{ status: 'DRAFT' }, 'closed'],
    [{ status: 'SOMETHING_NEW' }, 'closed'],
  ])('%o is %s', (overrides, expected) => {
    expect(returnOutcome(invoice(overrides))).toBe(expected);
  });
});

describe('a refusal', () => {
  it('tells the pilot from a role, though both are a plain 403', () => {
    expect(billingRefusalOf(apiError(403, PILOT_SENTENCE, 'FORBIDDEN')).kind).toBe('pilot');
    expect(billingRefusalOf(apiError(403, 'Forbidden resource', 'FORBIDDEN')).kind).toBe(
      'forbidden',
    );
  });

  it('reads the pilot’s sentence from the backend’s own guard', () => {
    const source = readFileSync(join(BACKEND, 'payments/pilot-payments.ts'), 'utf8');
    expect(source).toContain(`'${PILOT_SENTENCE}'`);
  });

  it.each<[number, string, string | undefined, string]>([
    [403, 'organizationId: access is unavailable', 'ORGANIZATION_ACCESS_DENIED', 'noOrganization'],
    [409, 'organizationId: select', 'ORGANIZATION_SELECTION_REQUIRED', 'chooseOrganization'],
    [409, 'organizationId: mismatch', 'ORGANIZATION_CONTEXT_MISMATCH', 'chooseOrganization'],
    [404, 'No plan "x" is available', undefined, 'planGone'],
    [404, 'AMERIABANK is not configured. Set its credentials to enable it.', undefined, 'noBank'],
    [400, 'This plan is paid; choose a provider', undefined, 'noBank'],
    [404, 'This organization has no subscription', undefined, 'noSubscription'],
    [400, 'This period has already ended; subscribe again', undefined, 'periodEnded'],
    [404, 'No such invoice', undefined, 'noInvoice'],
    [400, 'This invoice has no payment to confirm', undefined, 'noPayment'],
    [409, 'Cannot move a payment from EXPIRED to CAPTURED', undefined, 'disagreement'],
    [409, 'Refund no longer fits this payment', undefined, 'refunding'],
    [409, 'Cannot refund 25000; only 0 of 25000 remains', undefined, 'refunding'],
    [429, 'Too many', undefined, 'rateLimited'],
  ])('%i %s is %s', (status, message, code, expected) => {
    expect(billingRefusalOf(apiError(status, message, code)).kind).toBe(expected);
  });

  it('asks to choose again when this tab’s choice is one the account no longer has', () => {
    organizationChoice.choose('gone');
    try {
      const denied = apiError(
        403,
        'organizationId: access is unavailable',
        'ORGANIZATION_ACCESS_DENIED',
      );
      expect(billingRefusalOf(denied).kind).toBe('chooseOrganization');
    } finally {
      organizationChoice.clear();
    }
  });

  it.each([
    ['No plan "x" is available', 404, true],
    ['This organization has no subscription', 404, true],
    ['This period has already ended; subscribe again', 400, true],
    ['This plan is paid; choose a provider', 400, false],
  ])('reloads behind "%s" only if the page is out of date', (message, status, isStale) => {
    expect(billingRefusalOf(apiError(status, message)).isStale).toBe(isStale);
  });

  it.each([
    ['subscriptions.service.ts', 'No plan "'],
    ['subscriptions.service.ts', 'This plan is paid; choose a provider'],
    ['subscriptions.service.ts', 'This organization has no subscription'],
    ['subscriptions.service.ts', 'This period has already ended; subscribe again'],
    ['subscriptions.service.ts', 'No such invoice'],
    ['subscriptions.service.ts', 'This invoice has no payment to confirm'],
  ])('finds "%s %s" in the backend', (file, sentence) => {
    expect(readFileSync(join(BACKEND, 'billing', file), 'utf8')).toContain(sentence);
  });

  it('keeps a reference for the bank’s disagreement, and shows any other 409 as it came', () => {
    expect(
      billingRefusalOf(apiError(409, 'Cannot move a payment from EXPIRED to CAPTURED')),
    ).toMatchObject({
      kind: 'disagreement',
      requestId: 'req-1',
    });
    expect(billingRefusalOf(apiError(409, 'Something new'))).toEqual({
      kind: 'other',
      sentence: 'Something new',
    });
  });

  it('holds to the bank’s sentences in the backend', () => {
    const service = readFileSync(join(BACKEND, 'payments/payments.service.ts'), 'utf8');
    const rules = readFileSync(join(BACKEND, 'payments/payment-status.ts'), 'utf8');
    expect(service).toContain('Cannot move a payment from');
    expect(service).toContain('Refund no longer fits');
    expect(rules).toContain('Cannot refund');
  });

  it('reads the unconfigured bank’s sentence from the backend', () => {
    const source = readFileSync(join(BACKEND, 'payments/payment-gateway.registry.ts'), 'utf8');
    expect(source).toContain(' is not configured.');
  });

  it('keeps a reference for no answer and a server failure', () => {
    expect(billingRefusalOf(apiError(500, 'x'))).toEqual({ kind: 'noAnswer', requestId: 'req-1' });
    expect(billingRefusalOf(apiError(0, 'x'))).toEqual({ kind: 'noAnswer', requestId: 'req-1' });
  });

  it('shows anything else as it came', () => {
    expect(billingRefusalOf(apiError(400, 'Something else'))).toEqual({
      kind: 'other',
      sentence: 'Something else',
    });
  });

  it('throws on what is not the API’s', () => {
    expect(() => billingRefusalOf(new Error('bug'))).toThrow('bug');
  });
});
