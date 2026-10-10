import { Transform } from 'class-transformer';

/**
 * Trims a string before it is validated, so `@MinLength(1)` means "has
 * something in it": checked before trimming, `"   "` passed and was stored
 * as an empty name.
 */
export function Trimmed(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
}
