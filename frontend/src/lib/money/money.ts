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

export function formatMinor(amountMinor: string, currency: string, locale: string): string {
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
