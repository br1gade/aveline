import { describe, expect, it } from 'vitest';

import { readSendResult } from './read';
import type { SendResultWire } from './types';

describe('one press of “send”', () => {
  it('keeps the three lists apart, with how many were already invited', () => {
    const outcome = readSendResult({
      queued: 2,
      alreadySent: 5,
      recipients: [
        { householdName: 'Petrosyan family', toAddress: 'armen@example.am', channel: 'EMAIL' },
        { householdName: 'Hakobyan', toAddress: '123456789', channel: 'TELEGRAM' },
      ],
      suppressed: [{ householdName: 'Sargsyan', toAddress: 'ani@example.am' }],
      unreachable: [
        {
          householdId: 'h4',
          householdName: 'No Contact',
          reason: 'No email address for anyone in this household',
        },
      ],
    });
    expect(outcome).toEqual({
      queued: 2,
      alreadySent: 5,
      recipients: [
        {
          household: 'Petrosyan family',
          destination: { channel: 'EMAIL', address: 'armen@example.am' },
        },
        // A Telegram address is a chat number, which means nothing to a host.
        { household: 'Hakobyan', destination: { channel: 'TELEGRAM', address: null } },
      ],
      suppressed: [
        { household: 'Sargsyan', destination: { channel: null, address: 'ani@example.am' } },
      ],
      unreachable: [
        {
          householdId: 'h4',
          household: 'No Contact',
          reason: 'No email address for anyone in this household',
        },
      ],
    });
  });

  it('reads a missing address as not this role’s to see', () => {
    const outcome = readSendResult({
      queued: 1,
      alreadySent: 0,
      recipients: [{ householdName: 'Petrosyan family', channel: 'EMAIL' }],
      suppressed: [],
      unreachable: [],
    });
    expect(outcome.recipients[0]?.destination).toEqual({ channel: 'EMAIL', address: null });
  });

  it('drops anything else in the answer, a token included', () => {
    const token = crypto.randomUUID();
    const wire = {
      queued: 1,
      alreadySent: 0,
      recipients: [{ householdName: 'Petrosyan family', toAddress: 'a@example.am', token }],
      suppressed: [],
      unreachable: [{ householdId: 'h1', householdName: 'X', reason: 'y', token }],
      token,
    } as unknown as SendResultWire;
    expect(JSON.stringify(readSendResult(wire))).not.toContain(token);
  });
});
