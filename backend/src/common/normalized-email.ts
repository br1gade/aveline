import { Transform } from 'class-transformer';

/**
 * An email address as Aveline stores and compares it: trimmed, lower-cased.
 *
 * Applied where an address enters — registering, signing in, inviting — so
 * `Ani@X.am` and `ani@x.am` are one person. They were two accounts, and
 * signing in with different capitals failed. The database holds the same rule
 * with a unique index on lower(email).
 */
export function NormalizedEmail(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
}
