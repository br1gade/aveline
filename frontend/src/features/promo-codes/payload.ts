import type { components } from '@/api/schema';
import { toMinor } from '@/lib/money';
import { instantFromWallTime, wallTimeOf } from '@/lib/time';

import { PROMO_CURRENCY } from './rules';
import type { LimitsFormValues, PromoFormValues } from './schemas';
import type { PromoCode } from './types';

type Schemas = components['schemas'];

function isoOf(date: string, time: string, zone: string): string | undefined {
  if (!date || !time) return undefined;
  const instant = instantFromWallTime({ date, time }, zone);
  if (instant.kind !== 'instant') throw new Error(`The form let through a ${instant.kind} time`);
  return instant.iso;
}

export const NEW_PROMO_VALUES: PromoFormValues = {
  code: '',
  kind: 'PERCENT',
  value: '',
  eventId: '',
  maxRedemptions: '',
  minOrder: '',
  fromDate: '',
  fromTime: '',
  untilDate: '',
  untilTime: '',
};

/**
 * A new code (docs/API.md §6). The value is a whole percentage, or an amount in minor units of the
 * pilot's currency (design PD-117); what was left blank is left out, so the code has no limit, no
 * minimum, no start or no end.
 */
export function newPromoPayload(
  values: PromoFormValues,
  zone: string,
): Schemas['CreatePromoCodeDto'] {
  const validFrom = isoOf(values.fromDate, values.fromTime, zone);
  const validUntil = isoOf(values.untilDate, values.untilTime, zone);
  return {
    code: values.code,
    kind: values.kind,
    value:
      values.kind === 'PERCENT'
        ? String(Number(values.value))
        : toMinor(values.value, PROMO_CURRENCY),
    ...(values.eventId ? { eventId: values.eventId } : {}),
    ...(values.maxRedemptions.trim() ? { maxRedemptions: Number(values.maxRedemptions) } : {}),
    ...(values.minOrder.trim() ? { minOrderMinor: toMinor(values.minOrder, PROMO_CURRENCY) } : {}),
    ...(validFrom ? { validFrom } : {}),
    ...(validUntil ? { validUntil } : {}),
  };
}

/** A code's limit and end as the correcting form shows them, the end in the code's zone. */
export function limitsFormValues(promo: PromoCode, zone: string): LimitsFormValues {
  const until = promo.validUntil ? wallTimeOf(promo.validUntil, zone) : { date: '', time: '' };
  return {
    maxRedemptions: promo.maxRedemptions === null ? '' : String(promo.maxRedemptions),
    untilDate: until.date,
    untilTime: until.time,
  };
}

/**
 * Only what changed; neither is ever `null`: the backend ignores it for the end, and refuses it for
 * the limit of a code already used (FR-100).
 */
export function limitsPayload(
  initial: LimitsFormValues,
  values: LimitsFormValues,
  zone: string,
): Schemas['UpdatePromoCodeDto'] {
  const body: Schemas['UpdatePromoCodeDto'] = {};
  const limit = values.maxRedemptions.trim();
  if (limit && limit !== initial.maxRedemptions) body.maxRedemptions = Number(limit);
  const isUntilEdited =
    values.untilDate !== initial.untilDate || values.untilTime !== initial.untilTime;
  const validUntil = isoOf(values.untilDate, values.untilTime, zone);
  if (isUntilEdited && validUntil) body.validUntil = validUntil;
  return body;
}
