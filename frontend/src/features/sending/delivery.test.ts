import { describe, expect, it } from 'vitest';

import { createI18n } from '@/lib/i18n';

import { deliveryGroupOf } from './delivery';
import { deliveryText } from './delivery-text';
import { readDelivery } from './read';
import { guestIdsFor, needsConfirmation, SEND_LIMIT } from './send';
import type { DeliveryRowWire, DeliveryWire } from './types';

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
    expect(guestIdsFor(chosen)).toEqual({ kind: 'ready', guestIds: ['g1', 'g3'] });
  });

  it('refuses more households than one send takes', () => {
    const one = { guests: [{ id: 'g' }] };
    expect(guestIdsFor(Array.from({ length: SEND_LIMIT }, () => one)).kind).toBe('ready');
    expect(guestIdsFor(Array.from({ length: SEND_LIMIT + 1 }, () => one))).toEqual({
      kind: 'tooMany',
    });
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

  it('does not ask the host to send again when our own set-up stopped it', () => {
    const delivery = report([row({ status: 'FAILED', deliveryFailureKind: 'CONFIGURATION' })]);
    const text = deliveryText(delivery.byHousehold.get('h1')!, t, zone);
    expect(text.action).toBe(
      'Sending on this channel isn’t set up correctly, which the guest can’t fix. Try again later.',
    );
  });
});
