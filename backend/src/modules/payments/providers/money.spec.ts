import { exponentFor, toMajorUnits, toMinorUnits } from './payment-provider';

/**
 * A one-place error here is a hundredfold error in what a customer is charged.
 * AMD is the case that catches people out: it is quoted in whole drams, so its
 * minor unit is the dram itself, not a hundredth of one.
 */
describe('money conversion', () => {
  it('knows AMD has no subunit and USD has two places', () => {
    expect(exponentFor('AMD')).toBe(0);
    expect(exponentFor('usd')).toBe(2);
    expect(exponentFor('EUR')).toBe(2);
  });

  it('assumes two places for an unknown currency rather than zero', () => {
    // Guessing zero would multiply the charge by a hundred; guessing two
    // under-charges, which is the safer direction to be wrong in.
    expect(exponentFor('XYZ')).toBe(2);
  });

  describe('toMajorUnits', () => {
    it.each([
      { minor: 1000n, currency: 'AMD', expected: '1000' },
      { minor: 25000n, currency: 'AMD', expected: '25000' },
      { minor: 1050n, currency: 'USD', expected: '10.50' },
      { minor: 5n, currency: 'USD', expected: '0.05' },
      { minor: 0n, currency: 'USD', expected: '0.00' },
      { minor: 100n, currency: 'EUR', expected: '1.00' },
    ])('renders $minor $currency as $expected', ({ minor, currency, expected }) => {
      expect(toMajorUnits(minor, currency)).toBe(expected);
    });
  });

  describe('toMinorUnits', () => {
    it.each([
      { amount: '1000', currency: 'AMD', expected: 1000n },
      { amount: 10.5, currency: 'USD', expected: 1050n },
      { amount: '10.5', currency: 'USD', expected: 1050n },
      { amount: '0.05', currency: 'USD', expected: 5n },
      { amount: '7', currency: 'EUR', expected: 700n },
    ])('reads $amount $currency as $expected', ({ amount, currency, expected }) => {
      expect(toMinorUnits(amount, currency)).toBe(expected);
    });
  });

  it('round-trips without drift across a wide range', () => {
    for (const currency of ['AMD', 'USD']) {
      for (const minor of [0n, 1n, 99n, 100n, 12345n, 999999999n]) {
        expect(toMinorUnits(toMajorUnits(minor, currency), currency)).toBe(minor);
      }
    }
  });

  it('handles an amount larger than a float could hold exactly', () => {
    const huge = 9007199254740993n; // Number.MAX_SAFE_INTEGER + 2
    expect(toMinorUnits(toMajorUnits(huge, 'AMD'), 'AMD')).toBe(huge);
  });
});
