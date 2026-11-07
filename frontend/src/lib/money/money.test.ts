import { describe, expect, it, vi } from 'vitest';

import {
  currencyExponent,
  formatMinor,
  minorToDecimalString,
  multiplyMinor,
  sumMinor,
  toMinor,
} from './money';

describe('money', () => {
  it.each([
    ['AMD', 0],
    ['USD', 2],
    ['EUR', 2],
    ['RUB', 2],
    ['XYZ', 2],
  ])('uses exponent %s → %i', (currency, exponent) => {
    expect(currencyExponent(currency)).toBe(exponent);
  });

  it.each([
    ['25000', 'AMD', '25000'],
    ['1050', 'USD', '10.50'],
    ['5', 'USD', '0.05'],
    ['0', 'EUR', '0.00'],
    ['-1050', 'USD', '-10.50'],
    ['900719925474099312345', 'USD', '9007199254740993123.45'],
  ])('reads %s %s as %s without a float', (minor, currency, decimal) => {
    expect(minorToDecimalString(minor, currency)).toBe(decimal);
  });

  it.each(['10.5', '', 'abc', '1e3'])('refuses %j as a minor amount', (value) => {
    expect(() => minorToDecimalString(value, 'USD')).toThrow(RangeError);
  });

  it('formats in the given locale', () => {
    expect(formatMinor('1050', 'USD', 'en')).toContain('10.50');
    expect(formatMinor('25000', 'AMD', 'en')).toContain('25,000');
    // French groups with a narrow no-break space, which the fonts carry (styles/fonts.test.ts).
    expect(formatMinor('25000', 'AMD', 'fr')).toContain('25\u202f000');
  });

  it.each([
    ['10.50', 'USD', '1050'],
    ['10.5', 'USD', '1050'],
    ['10', 'USD', '1000'],
    ['25000', 'AMD', '25000'],
  ])('parses %s %s strictly into %s', (input, currency, minor) => {
    expect(toMinor(input, currency)).toBe(minor);
  });

  it.each([
    ['10.505', 'USD'],
    ['10.5', 'AMD'],
    ['-1', 'USD'],
    ['1,000', 'USD'],
  ])('refuses %s %s', (input, currency) => {
    expect(() => toMinor(input, currency)).toThrow(RangeError);
  });

  it.each([
    ['15000', 2, '30000'],
    ['0', 7, '0'],
    ['9007199254740993', 3, '27021597764222979'],
  ])('multiplies %s by %i exactly', (amount, quantity, total) => {
    expect(multiplyMinor(amount, quantity)).toBe(total);
  });

  it.each([
    [['15000', '0', '2500'], '17500'],
    [[], '0'],
    [['9007199254740993', '9007199254740993'], '18014398509481986'],
  ])('adds %j exactly to %s', (amounts, total) => {
    expect(sumMinor(amounts)).toBe(total);
  });

  it('refuses a quantity that is not a whole number, and an amount that is not minor units', () => {
    expect(() => multiplyMinor('100', 1.5)).toThrow(RangeError);
    expect(() => multiplyMinor('100', -1)).toThrow(RangeError);
    expect(() => multiplyMinor('10.5', 1)).toThrow(RangeError);
    expect(() => sumMinor(['1', 'x'])).toThrow(RangeError);
  });

  it.each([
    ['1234567', 'AMD', '1\u00a0234\u00a0567\u00a0֏'],
    ['15000', 'AMD', '15\u00a0000\u00a0֏'],
    ['0', 'AMD', '0\u00a0֏'],
    ['123456750', 'USD', '1\u00a0234\u00a0567,50\u00a0$'],
    ['1050', 'EUR', '10,50\u00a0€'],
    ['999', 'RUB', '9,99\u00a0RUB'],
  ])(
    'writes %s %s in Armenian as Node does, by hand, since Chrome has no Armenian data',
    (minor, currency, text) => {
      expect(formatMinor(minor, currency, 'hy')).toBe(text);
      expect(formatMinor(minor, currency, 'hy-AM')).toBe(text);
    },
  );

  it('never asks Intl for Armenian, which would differ between the server and the browser', () => {
    const intl = vi.spyOn(Intl, 'NumberFormat');
    formatMinor('15000', 'AMD', 'hy');
    expect(intl).not.toHaveBeenCalled();
    intl.mockRestore();
  });

  it('agrees with Node’s own Armenian formatting', () => {
    const intl = new Intl.NumberFormat('hy', {
      style: 'currency',
      currency: 'AMD',
      maximumFractionDigits: 0,
    });
    expect(formatMinor('1234567', 'AMD', 'hy')).toBe(intl.format(1234567));
  });
});
