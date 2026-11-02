/**
 * Money arrives as integer minor units in a string: "25000" is 25,000 dram, "1050" is $10.50
 * (docs/API.md §1). It never passes through a float: a JavaScript number cannot hold every value,
 * and the formatter accepts a decimal string.
 */
const EXPONENTS: Readonly<Record<string, number>> = { AMD: 0, USD: 2, EUR: 2, RUB: 2 };

/** An unknown currency is treated as 2, as the backend does. */
export function currencyExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

const MINOR_AMOUNT = /^-?\d+$/;

/** "1050" in USD becomes "10.50"; "25000" in AMD stays "25000". */
export function minorToDecimalString(amountMinor: string, currency: string): string {
  if (!MINOR_AMOUNT.test(amountMinor)) {
    throw new RangeError(`Not a minor-unit amount: "${amountMinor}"`);
  }
  const exponent = currencyExponent(currency);
  const isNegative = amountMinor.startsWith('-');
  const digits = (isNegative ? amountMinor.slice(1) : amountMinor).padStart(exponent + 1, '0');
  const whole = BigInt(digits.slice(0, digits.length - exponent)).toString();
  const fraction = exponent > 0 ? `.${digits.slice(-exponent)}` : '';
  return `${isNegative ? '-' : ''}${whole}${fraction}`;
}

const NO_BREAK_SPACE = '\u00a0';

/** What Node writes for Armenian; a currency without a sign here is written by its code. */
const ARMENIAN_SIGNS: Readonly<Record<string, string>> = { AMD: '֏', USD: '$', EUR: '€' };

/**
 * An amount in Armenian, composed by hand as the Armenian dates are (`lib/time`): Chrome ships no
 * Armenian data and writes "AMD 15,000", where Node writes "15 000 ֏", so `Intl` would make a
 * server-rendered price differ from the browser's and break hydration.
 */
function armenianAmount(amountMinor: string, currency: string): string {
  const [whole = '0', fraction] = minorToDecimalString(amountMinor, currency).split('.');
  const isNegative = whole.startsWith('-');
  const digits = isNegative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+$)/g, NO_BREAK_SPACE);
  const sign = ARMENIAN_SIGNS[currency.toUpperCase()] ?? currency.toUpperCase();
  return `${isNegative ? '-' : ''}${grouped}${fraction ? `,${fraction}` : ''}${NO_BREAK_SPACE}${sign}`;
}

export function formatMinor(amountMinor: string, currency: string, locale: string): string {
  if (locale.split('-')[0] === 'hy') return armenianAmount(amountMinor, currency);
  const exponent = currencyExponent(currency);
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  });
  return formatter.format(minorToDecimalString(amountMinor, currency) as Intl.StringNumericLiteral);
}

/** Strict: "10.50" in USD becomes "1050". Anything else, including too many decimals, throws. */
export function toMinor(input: string, currency: string): string {
  const exponent = currencyExponent(currency);
  const pattern = exponent > 0 ? new RegExp(`^(\\d+)(?:\\.(\\d{1,${exponent}}))?$`) : /^(\d+)$/;
  const match = pattern.exec(input.trim());
  if (!match) {
    throw new RangeError(`Not an amount in ${currency}: "${input}"`);
  }
  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? '').padEnd(exponent, '0');
  return BigInt(`${whole}${fraction}`).toString();
}

function minorBigInt(amountMinor: string): bigint {
  if (!MINOR_AMOUNT.test(amountMinor)) {
    throw new RangeError(`Not a minor-unit amount: "${amountMinor}"`);
  }
  return BigInt(amountMinor);
}

/** A unit price times a quantity: "15000" × 2 is "30000", exactly, however large. */
export function multiplyMinor(amountMinor: string, quantity: number): string {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError(`Not a quantity: ${quantity}`);
  }
  return (minorBigInt(amountMinor) * BigInt(quantity)).toString();
}

/** The sum of minor-unit amounts in one currency; "0" for none. */
export function sumMinor(amountsMinor: readonly string[]): string {
  return amountsMinor.reduce((total, amount) => total + minorBigInt(amount), 0n).toString();
}
