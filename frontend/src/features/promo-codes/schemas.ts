import { z } from 'zod';

import { toMinor } from '@/lib/money';
import { instantFromWallTime } from '@/lib/time';

import { PROMO_CURRENCY } from './rules';
import type { PromoCode } from './types';

/** Messages are codes, worded by the forms; the backend's own limits (`CreatePromoCodeDto`). */
export type PromoFieldCode =
  | 'required'
  | 'codeShort'
  | 'codeChars'
  | 'tooLong'
  | 'percent'
  | 'amount'
  | 'limit'
  | 'pair'
  | 'dateInvalid'
  | 'timeSkipped'
  | 'untilBefore'
  | 'belowUsed'
  | 'cantClear';

interface Issue {
  path: string[];
  message: PromoFieldCode;
}

/** An instant typed in a zone; `null` for neither date nor time, or the issue with the pair. */
function instantOf(
  date: string,
  time: string,
  zone: string,
  [dateField, timeField]: readonly [string, string],
): { iso: string | null } | Issue {
  if (!date && !time) return { iso: null };
  if (!date || !time) return { path: [date ? timeField : dateField], message: 'pair' };
  const instant = instantFromWallTime({ date, time }, zone);
  if (instant.kind === 'invalid') return { path: [dateField], message: 'dateInvalid' };
  if (instant.kind === 'skipped') return { path: [timeField], message: 'timeSkipped' };
  return { iso: instant.iso };
}

function isIssue(value: { iso: string | null } | Issue): value is Issue {
  return 'message' in value;
}

/** An amount in the pilot's currency, above nothing. */
function isAmount(input: string): boolean {
  try {
    return BigInt(toMinor(input, PROMO_CURRENCY)) > 0n;
  } catch {
    return false;
  }
}

function isPercent(input: string): boolean {
  return /^\d{1,3}$/.test(input.trim()) && Number(input) >= 1 && Number(input) <= 100;
}

function isLimit(input: string): boolean {
  return /^\d{1,7}$/.test(input.trim()) && Number(input) >= 1 && Number(input) <= 1_000_000;
}

const code = z
  .string()
  .trim()
  .min(1, { error: 'required' satisfies PromoFieldCode, abort: true })
  .min(3, { error: 'codeShort' satisfies PromoFieldCode, abort: true })
  .max(32, { error: 'tooLong' satisfies PromoFieldCode, abort: true })
  .regex(/^[A-Za-z0-9-]+$/, { error: 'codeChars' satisfies PromoFieldCode });

const promoObject = z.object({
  code,
  kind: z.enum(['PERCENT', 'FIXED']),
  value: z.string(),
  /** Empty: every event. */
  eventId: z.string(),
  maxRedemptions: z.string(),
  minOrder: z.string(),
  fromDate: z.string(),
  fromTime: z.string(),
  untilDate: z.string(),
  untilTime: z.string(),
});

export type PromoFormValues = z.output<typeof promoObject>;

function amountIssues(values: PromoFormValues): Issue[] {
  const issues: Issue[] = [];
  const isValue = values.kind === 'PERCENT' ? isPercent(values.value) : isAmount(values.value);
  if (!isValue)
    issues.push({ path: ['value'], message: values.kind === 'PERCENT' ? 'percent' : 'amount' });
  if (values.maxRedemptions.trim() && !isLimit(values.maxRedemptions)) {
    issues.push({ path: ['maxRedemptions'], message: 'limit' });
  }
  if (values.minOrder.trim() && !isAmount(values.minOrder))
    issues.push({ path: ['minOrder'], message: 'amount' });
  return issues;
}

/** The window: each end both or neither, and the end after the start (`promo-codes.service.ts`). */
function windowIssues(values: PromoFormValues, zone: string): Issue[] {
  const from = instantOf(values.fromDate, values.fromTime, zone, ['fromDate', 'fromTime']);
  const until = instantOf(values.untilDate, values.untilTime, zone, ['untilDate', 'untilTime']);
  const issues = [from, until].filter(isIssue);
  if (issues.length > 0) return issues;
  const [start, end] = [from, until].map((one) => (isIssue(one) ? null : one.iso));
  return start && end && end <= start ? [{ path: ['untilDate'], message: 'untilBefore' }] : [];
}

/** A new code; its times are typed in the chosen event's zone (`zoneOf`). */
export function promoFormSchema(zoneOf: (eventId: string) => string) {
  return promoObject.superRefine((values, ctx) => {
    const issues = [...amountIssues(values), ...windowIssues(values, zoneOf(values.eventId))];
    for (const issue of issues) ctx.addIssue({ code: 'custom', ...issue });
  });
}

export interface LimitsFormValues {
  maxRedemptions: string;
  untilDate: string;
  untilTime: string;
}

function limitIssues(promo: PromoCode, values: LimitsFormValues): Issue[] {
  const limit = values.maxRedemptions.trim();
  if (!limit)
    return promo.maxRedemptions === null
      ? []
      : [{ path: ['maxRedemptions'], message: 'cantClear' }];
  if (!isLimit(limit)) return [{ path: ['maxRedemptions'], message: 'limit' }];
  return Number(limit) < promo.redemptions
    ? [{ path: ['maxRedemptions'], message: 'belowUsed' }]
    : [];
}

function untilIssues(promo: PromoCode, values: LimitsFormValues, zone: string): Issue[] {
  const until = instantOf(values.untilDate, values.untilTime, zone, ['untilDate', 'untilTime']);
  if (isIssue(until)) return [until];
  if (!until.iso) return promo.validUntil ? [{ path: ['untilDate'], message: 'cantClear' }] : [];
  const isBefore = promo.validFrom !== null && until.iso <= new Date(promo.validFrom).toISOString();
  return isBefore ? [{ path: ['untilDate'], message: 'untilBefore' }] : [];
}

/**
 * Correcting a code: its limit and its end only, as the API takes (FR-100). Neither can be
 * removed once set, since `null` removes neither (ignored for the end, refused for a used code's
 * limit); the limit can't go below what was used,
 * and the end must stay after the start, which the backend doesn't check on a correction.
 */
export function limitsFormSchema(promo: PromoCode, zone: string) {
  return z
    .object({ maxRedemptions: z.string(), untilDate: z.string(), untilTime: z.string() })
    .superRefine((values, ctx) => {
      for (const issue of [...limitIssues(promo, values), ...untilIssues(promo, values, zone)]) {
        ctx.addIssue({ code: 'custom', ...issue });
      }
    });
}
