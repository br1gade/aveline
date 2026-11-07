import { describe, expect, it } from 'vitest';

import { createI18n } from '@/lib/i18n';

import { deliveryGroupOf } from './delivery';
import { deliveryText } from './delivery-text';
import { readDelivery } from './read';
import {
  guestIdsFor,
  mergeOutcomes,
  needsConfirmation,
  sendBatches,
  sendInBatches,
  SEND_LIMIT,
} from './send';
import type { DeliveryRowWire, DeliveryWire, SendOutcome } from './types';

function row(overrides: Partial<DeliveryRowWire> = {}): DeliveryRowWire {
  return {
    householdId: 'h1',
    household: 'Petrosyan family',
    guest: 'Armen Petrosyan',
    channel: 'EMAIL',
    toAddress: 'armen@example.am',
    status: 'SENT',
    attempts: 1,
    failureReason: null,
    sentAt: '2027-05-01T10:00:00.000Z',
    reminders: 0,
    lastRemindedAt: null,
    ...overrides,
  };
}

function report(households: DeliveryRowWire[], unreachable: DeliveryWire['unreachable'] = []) {
  return readDelivery({
    invited: households.filter((entry) => entry.status !== 'NOT_SENT').length,
    notSent: households.filter((entry) => entry.status === 'NOT_SENT').length,
    unreachable,
    households,
  });
}

describe('the delivery report, per household', () => {
  it('finds each household’s row, or why nothing can reach it', () => {
    const read = report(
      [row(), row({ householdId: 'h2', status: 'NOT_SENT', attempts: 0, sentAt: null })],
      [{ householdId: 'h3', householdName: 'No Contact', reason: 'No email address for anyone' }],
    );
    expect(read).toMatchObject({ invited: 1, notSent: 1, unreachable: 1 });
    expect(read.byHousehold.get('h1')).toMatchObject({
      kind: 'reachable',
      recipient: 'Armen Petrosyan',
      destination: { channel: 'EMAIL', address: 'armen@example.am' },
      status: 'SENT',
    });
    expect(read.byHousehold.get('h3')).toEqual({
      kind: 'unreachable',
      householdId: 'h3',
      reason: 'No email address for anyone',
    });
    expect(read.byHousehold.get('h9')).toBeUndefined();
  });

  it('tells a retry after a temporary failure from a message still waiting', () => {
    const read = report([
      row({ status: 'QUEUED', attempts: 2 }),
      row({ householdId: 'h2', status: 'QUEUED', attempts: 0 }),
    ]);
    expect(read.byHousehold.get('h1')).toMatchObject({ isRetrying: true });
    expect(read.byHousehold.get('h2')).toMatchObject({ isRetrying: false });
  });

  it('keeps the server’s failure text only when the address arrived too (FR-35)', () => {
    const reason = '550 5.1.1 <armen@example.am>: Recipient address rejected';
    const { toAddress: _hidden, ...withoutAddress } = row({
      status: 'BOUNCED',
      failureReason: reason,
    });
    const read = report([
      row({ householdId: 'h2', status: 'BOUNCED', failureReason: reason }),
      withoutAddress,
    ]);
    expect(read.byHousehold.get('h2')).toMatchObject({ failureReason: reason });
    expect(read.byHousehold.get('h1')).toMatchObject({
      failureReason: null,
      destination: { channel: 'EMAIL', address: null },
    });
    expect(JSON.stringify([...read.byHousehold.values()].at(-1))).not.toContain('armen@');
  });

  it('keeps when it was read, and a failure kind it knows', () => {
    const read = report([
      row({ status: 'DELIVERED', readAt: '2027-05-01T11:00:00.000Z' }),
      row({ householdId: 'h2', status: 'FAILED', deliveryFailureKind: 'CONFIGURATION' }),
      row({ householdId: 'h3', status: 'FAILED', deliveryFailureKind: 'SOMETHING_NEW' }),
    ]);
    expect(read.byHousehold.get('h1')).toMatchObject({ readAt: '2027-05-01T11:00:00.000Z' });
    expect(read.byHousehold.get('h2')).toMatchObject({ failureKind: 'CONFIGURATION' });
    expect(read.byHousehold.get('h3')).toMatchObject({ failureKind: null, readAt: null });
  });

  it('keeps the receipt’s times and code, whatever the role (pilot F21)', () => {
    const { toAddress: _hidden, ...withoutAddress } = row({
      status: 'FAILED',
      deliveryFailedAt: '2027-05-01T12:00:00.000Z',
      deliveryErrorCode: 131049,
      deliveryFailureKind: 'TRANSIENT',
    });
    const read = report([
      withoutAddress,
      row({ householdId: 'h2', status: 'DELIVERED', deliveredAt: '2027-05-01T11:00:00.000Z' }),
    ]);
    expect(read.byHousehold.get('h1')).toMatchObject({
      deliveredAt: null,
      deliveryFailedAt: '2027-05-01T12:00:00.000Z',
      deliveryErrorCode: 131049,
      failureKind: 'TRANSIENT',
    });
    expect(read.byHousehold.get('h2')).toMatchObject({
      deliveredAt: '2027-05-01T11:00:00.000Z',
      deliveryFailedAt: null,
      deliveryErrorCode: null,
    });
  });

  it.each([['x'], [1.5]])('leaves out a receipt’s code of %o: it is not a whole number', (code) => {
    const wire = row({ status: 'FAILED', deliveryErrorCode: code as unknown as number });
    expect(report([wire]).byHousehold.get('h1')).toMatchObject({ deliveryErrorCode: null });
  });

  it('reads a status it does not know as unknown, which needs attention', () => {
    const read = report([row({ status: 'READ' })]);
    const delivery = read.byHousehold.get('h1');
    expect(delivery).toMatchObject({ status: 'UNKNOWN' });
    expect(deliveryGroupOf(delivery)).toBe('attention');
  });

  it('drops anything else in the report, a token included', () => {
    const token = crypto.randomUUID();
    const wire = {
      invited: 1,
      notSent: 0,
      unreachable: [{ householdId: 'h3', householdName: 'X', reason: 'No address', token }],
      households: [{ ...row(), token }],
      token,
    } as unknown as DeliveryWire;
    const read = readDelivery(wire);
    expect(JSON.stringify([read, ...read.byHousehold.values()])).not.toContain(token);
  });

  it.each([
    ['NOT_SENT', 'notSent'],
    ['QUEUED', 'onItsWay'],
    ['SENDING', 'onItsWay'],
    ['SENT', 'sent'],
    ['DELIVERED', 'sent'],
    ['FAILED', 'attention'],
    ['BOUNCED', 'attention'],
    ['SUPPRESSED', 'attention'],
    ['CANCELLED', 'attention'],
  ])('puts %s under “%s”', (status, group) => {
    expect(deliveryGroupOf(report([row({ status })]).byHousehold.get('h1'))).toBe(group);
  });

  it('puts a household nothing can reach under “needs attention”, and an unknown one nowhere', () => {
    const read = report([], [{ householdId: 'h3', householdName: 'X', reason: 'No address' }]);
    expect(deliveryGroupOf(read.byHousehold.get('h3'))).toBe('attention');
    expect(deliveryGroupOf(undefined)).toBeNull();
  });
});

describe('sending', () => {
  it('asks first only before the event’s first send, or when nobody can tell', () => {
    expect(needsConfirmation(report([row({ status: 'NOT_SENT', attempts: 0 })]))).toBe(true);
    expect(needsConfirmation(report([row({ status: 'BOUNCED' })]))).toBe(false);
    expect(needsConfirmation(null)).toBe(true);
  });

  it('names one guest of each chosen household', () => {
    const chosen = [{ guests: [{ id: 'g1' }, { id: 'g2' }] }, { guests: [{ id: 'g3' }] }];
    expect(guestIdsFor(chosen)).toEqual(['g1', 'g3']);
  });
});

describe('sending to more households than one send takes (PD-151)', () => {
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `g${index}`);
  const outcome = (queued: number, name: string): SendOutcome => ({
    queued,
    alreadySent: 1,
    recipients: [{ household: name, destination: { channel: 'EMAIL', address: `${name}@x.am` } }],
    suppressed: [],
    unreachable: [{ householdId: `h-${name}`, household: name, reason: 'No address' }],
  });

  it('splits the guests into sends of at most the limit, in their order', () => {
    expect(sendBatches(ids(SEND_LIMIT)).map((batch) => batch.length)).toEqual([SEND_LIMIT]);
    expect(sendBatches(ids(SEND_LIMIT + 1)).map((batch) => batch.length)).toEqual([SEND_LIMIT, 1]);
    const two = sendBatches(ids(2 * SEND_LIMIT));
    expect(two.map((batch) => batch.length)).toEqual([SEND_LIMIT, SEND_LIMIT]);
    expect(two[1]?.[0]).toBe(`g${SEND_LIMIT}`);
  });

  it('adds what each send did into one outcome', () => {
    expect(mergeOutcomes(outcome(2, 'a'), outcome(3, 'b'))).toEqual({
      queued: 5,
      alreadySent: 2,
      recipients: [...outcome(2, 'a').recipients, ...outcome(3, 'b').recipients],
      suppressed: [],
      unreachable: [...outcome(2, 'a').unreachable, ...outcome(3, 'b').unreachable],
    });
  });

  it('sends each part in turn, and stops at a refusal with what was sent so far', async () => {
    const refusal = new Error('refused');
    const asked: number[] = [];
    const result = await sendInBatches(ids(2 * SEND_LIMIT + 1), (batch) => {
      asked.push(batch.length);
      return asked.length === 2 ? Promise.reject(refusal) : Promise.resolve(outcome(7, 'a'));
    });
    expect(asked).toEqual([SEND_LIMIT, SEND_LIMIT]);
    expect(result).toEqual({ outcome: outcome(7, 'a'), sent: SEND_LIMIT, error: refusal });
  });

  it('says everyone was sent when every part went', async () => {
    const result = await sendInBatches(ids(3), () => Promise.resolve(outcome(3, 'a')));
    expect(result).toEqual({ outcome: outcome(3, 'a'), sent: 3, error: null });
  });
});

describe('the delivery line, in words', () => {
  const t = createI18n('en').getFixedT('en', 'sending');
  const zone = { timeZone: 'Asia/Yerevan', locale: 'en' };

  it('says when it was read, in the event’s zone', () => {
    const delivery = report([row({ status: 'DELIVERED', readAt: '2027-05-01T11:00:00.000Z' })]);
    const text = deliveryText(delivery.byHousehold.get('h1')!, t, zone);
    expect(text.summary).toContain('read 1 May 2027, 15:00');
  });

  it('says when it was delivered, in the event’s zone', () => {
    const delivery = report([
      row({ status: 'DELIVERED', deliveredAt: '2027-05-01T11:00:00.000Z' }),
    ]);
    const text = deliveryText(delivery.byHousehold.get('h1')!, t, zone);
    expect(text.summary).toContain('delivered 1 May 2027, 15:00');
  });

  it('says nothing of a receipt when there is none, as for email today', () => {
    const delivery = report([row()]);
    const text = deliveryText(delivery.byHousehold.get('h1')!, t, zone);
    expect(text.summary).not.toMatch(/delivered|code|problem/);
  });

  it('says when delivery failed, why in our words, and the provider’s code ungrouped', () => {
    const delivery = report([
      row({
        status: 'FAILED',
        deliveryFailedAt: '2027-05-01T12:00:00.000Z',
        deliveryErrorCode: 131049,
        deliveryFailureKind: 'TRANSIENT',
      }),
    ]);
    const text = deliveryText(delivery.byHousehold.get('h1')!, t, zone);
    expect(text.summary).toContain('not delivered 1 May 2027, 16:00');
    expect(text.summary).toContain('a temporary problem');
    expect(text.summary).toContain('provider code 131049');
  });

  it('shows a code of 0: a code is not a quantity', () => {
    const delivery = report([row({ status: 'FAILED', deliveryErrorCode: 0 })]);
    const text = deliveryText(delivery.byHousehold.get('h1')!, t, zone);
    expect(text.summary).toContain('provider code 0');
  });

  it.each([
    ['CONFIGURATION', 'a problem with how sending is set up'],
    ['TRANSIENT', 'a temporary problem'],
    ['AMBIGUOUS', 'the cause isn’t clear'],
    ['UNKNOWN', 'the cause isn’t known'],
  ])('words the failure kind %s', (kind, words) => {
    const delivery = report([row({ status: 'FAILED', deliveryFailureKind: kind })]);
    const text = deliveryText(delivery.byHousehold.get('h1')!, t, zone);
    expect(text.summary).toContain(words);
  });

  it('does not ask the host to send again when our own set-up stopped it', () => {
    const delivery = report([row({ status: 'FAILED', deliveryFailureKind: 'CONFIGURATION' })]);
    const text = deliveryText(delivery.byHousehold.get('h1')!, t, zone);
    expect(text.action).toBe(
      'Sending on this channel isn’t set up correctly, which the guest can’t fix. Try again later.',
    );
  });
});
