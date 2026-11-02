import { describe, expect, it } from 'vitest';

import { readServerEnv } from './env.server';

describe("the rendering server's settings", () => {
  it('sends paid tickets to the local gateway outside production, and to a bank in it', () => {
    expect(readServerEnv({}).TICKET_PAYMENT_PROVIDER).toBe('FAKE');
    expect(readServerEnv({ NODE_ENV: 'production' }).TICKET_PAYMENT_PROVIDER).toBe('AMERIABANK');
  });

  it('takes the bank it is given, and refuses one it does not know', () => {
    expect(readServerEnv({ TICKET_PAYMENT_PROVIDER: 'IDBANK' }).TICKET_PAYMENT_PROVIDER).toBe(
      'IDBANK',
    );
    expect(() => readServerEnv({ TICKET_PAYMENT_PROVIDER: 'PAYPAL' })).toThrow();
  });
});
