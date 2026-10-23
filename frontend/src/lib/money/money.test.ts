import { describe, expect, it } from 'vitest';

import { currencyExponent, formatMinor, minorToDecimalString, toMinor } from './money';

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
});
