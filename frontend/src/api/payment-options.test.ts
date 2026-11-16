import { describe, expect, it } from 'vitest';

import { NO_PAYMENTS, paymentProviderOf } from './payment-options';

describe('the bank a paid order or plan goes to', () => {
  it('is the first the API offers', () => {
    expect(
      paymentProviderOf({ isPaymentAvailable: true, providers: ['AMERIABANK', 'IDBANK'] }),
    ).toBe('AMERIABANK');
  });

  it.each([
    ['payments are off', NO_PAYMENTS],
    [
      'payments are off, whatever banks are named',
      { isPaymentAvailable: false, providers: ['FAKE' as const] },
    ],
  ])('is none when %s', (_, options) => {
    expect(paymentProviderOf(options)).toBeUndefined();
  });
});
