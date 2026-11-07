import { describe, expect, it } from 'vitest';

import { NOT_REACHED_REASON, readChaseResult, readThankResult } from './read';
import type { ChaseResultWire, ThankResultWire } from './types';

describe('one press of “remind”', () => {
  it('keeps its counts and who it went to', () => {
    const outcome = readChaseResult({
      queued: 1,
      alreadyRemindedToday: 2,
      recentlyInvited: 3,
      recipients: [{ householdName: 'Petrosyan', toAddress: 'armen@example.am', channel: 'EMAIL' }],
      notInvited: [],
    });
    expect(outcome).toEqual({
      queued: 1,
      alreadyRemindedToday: 2,
      recentlyInvited: 3,
      recipients: [
        { household: 'Petrosyan', destination: { channel: 'EMAIL', address: 'armen@example.am' } },
      ],
      toSendFirst: [],
      cannotReach: [],
    });
  });

  it('tells “send it first” from an address to fix, by the backend’s exact sentence', () => {
    const outcome = readChaseResult({
      queued: 0,
      alreadyRemindedToday: 0,
      recentlyInvited: 0,
      recipients: [],
      notInvited: [
        { householdId: 'h1', householdName: 'Hakobyan', reason: NOT_REACHED_REASON },
        { householdId: 'h2', householdName: 'No Contact', reason: 'No email address' },
      ],
    });
    expect(outcome.toSendFirst).toEqual([
      { householdId: 'h1', household: 'Hakobyan', reason: NOT_REACHED_REASON },
    ]);
    expect(outcome.cannotReach).toEqual([
      { householdId: 'h2', household: 'No Contact', reason: 'No email address' },
    ]);
  });

  it('drops anything else in the answer, a token included', () => {
    const token = crypto.randomUUID();
    const wire = {
      queued: 1,
      alreadyRemindedToday: 0,
      recentlyInvited: 0,
      recipients: [{ householdName: 'P', toAddress: 'a@example.am', token }],
      notInvited: [{ householdId: 'h1', householdName: 'X', reason: 'y', token }],
      token,
    } as unknown as ChaseResultWire;
    expect(JSON.stringify(readChaseResult(wire))).not.toContain(token);
  });
});

describe('one press of “thank”', () => {
  it.each(['ARRIVED', 'ACCEPTED'] as const)('keeps the basis %s the answer gives', (basis) => {
    const outcome = readThankResult({
      queued: 1,
      alreadyThanked: 4,
      basis,
      recipients: [{ householdName: 'Hakobyan', toAddress: '123456', channel: 'TELEGRAM' }],
      notInvited: [{ householdId: 'h2', householdName: 'No Contact', reason: 'No email address' }],
    });
    expect(outcome).toEqual({
      queued: 1,
      alreadyThanked: 4,
      basis,
      // A Telegram address is a chat number, which means nothing to a host.
      recipients: [{ household: 'Hakobyan', destination: { channel: 'TELEGRAM', address: null } }],
      cannotReach: [{ householdId: 'h2', household: 'No Contact', reason: 'No email address' }],
    });
  });

  it('says nothing of a basis it does not know', () => {
    const wire = { queued: 0, alreadyThanked: 0, basis: 'NEW', recipients: [], notInvited: [] };
    expect(readThankResult(wire as unknown as ThankResultWire).basis).toBeNull();
  });
});
