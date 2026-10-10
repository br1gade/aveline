import { applyDecorators } from '@nestjs/common';
import { IsISO8601, Matches } from 'class-validator';

/**
 * An ISO 8601 date-time in the one shape `new Date()` reads reliably:
 * `2027-06-12T15:00:00Z` (seconds, fraction and offset optional).
 *
 * The plain `@IsISO8601()` accepted forms that `new Date()` turns into
 * Invalid Date — `20270612`, `2027-W01`, `2027-06-12T10` — which then failed
 * as a 500, and non-strict mode let `2027-02-30` through to become 2 March.
 */
const EXTENDED_TIMESTAMP = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

export function IsIsoTimestamp(): PropertyDecorator {
  return applyDecorators(
    IsISO8601({ strict: true, strictSeparator: true }),
    Matches(EXTENDED_TIMESTAMP, { message: '$property must be a date-time such as 2027-06-12T15:00:00Z' }),
  );
}
