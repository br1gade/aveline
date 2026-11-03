import { isApiError } from '@/api/errors';
import { DEFAULT_TIME_ZONE } from '@/lib/time';

import type { PromoCode, PromoState } from './types';

/** The pilot's currency, in which codes are typed and shown: the API stores none (FR-100). */
export const PROMO_CURRENCY = 'AMD';

/** A code's times are typed and shown in its event's zone, or Yerevan's for every event. */
export function zoneFor(eventId: string | null, zones: ReadonlyMap<string, string>): string {
  return (eventId && zones.get(eventId)) || DEFAULT_TIME_ZONE;
}

/** Where the code stands at `now`: the first rule broken, in `promo-code.ts`'s order. */
export function promoState(code: PromoCode, now: number): PromoState {
  if (!code.isActive) return 'stopped';
  if (code.validFrom && now < Date.parse(code.validFrom)) return 'notYet';
  if (code.validUntil && now > Date.parse(code.validUntil)) return 'expired';
  if (code.remaining === 0) return 'usedUp';
  return 'active';
}

type FieldKind = 'codeTaken' | 'codeRefused' | 'belowUsed' | 'valueRefused' | 'untilRefused';
type StaleKind = 'eventGone' | 'gone';

export type PromoRefusal =
  | { kind: FieldKind; isStale?: undefined }
  | { kind: StaleKind; isStale: true }
  | {
      kind: 'forbidden' | 'noOrganization' | 'chooseOrganization' | 'rateLimited';
      isStale?: undefined;
    }
  | { kind: 'noAnswer'; requestId?: string | undefined; isStale?: undefined }
  | { kind: 'other'; sentence: string; requestId?: string | undefined; isStale?: undefined };

/**
 * The backend's sentences, by their start where they quote a value. **A temporary stand-in
 * (design PD-116):** recognised by their words under a test that reads the source, until FR-28.
 */
export const SENTENCES: ReadonlyArray<readonly [RegExp, FieldKind | StaleKind]> = [
  [/^You already have a code called /, 'codeTaken'],
  [/^A code may contain letters, numbers and hyphens only/, 'codeRefused'],
  [/^code must be (?:longer|shorter)/, 'codeRefused'],
  [/^This code has already been used \d+ time\(s\); the limit cannot be lower/, 'belowUsed'],
  [/^A discount must be worth something/, 'valueRefused'],
  [/^A percentage discount cannot exceed 100/, 'valueRefused'],
  [/^validUntil must be after validFrom/, 'untilRefused'],
  [/^No such event in this organization/, 'eventGone'],
  [/^No such promo code/, 'gone'],
];

function recognised(messages: readonly string[]): PromoRefusal | null {
  for (const message of messages) {
    const known = SENTENCES.find(([pattern]) => pattern.test(message));
    if (!known) continue;
    const kind = known[1];
    return kind === 'eventGone' || kind === 'gone' ? { kind, isStale: true } : { kind };
  }
  return null;
}

/** Only the organization's owner holds `billing:*`; anyone on an event alone has no organization. */
export function promoRefusalOf(error: unknown): PromoRefusal {
  if (!isApiError(error)) throw error;
  const { status, messages, requestId, code } = error;
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId };
  if (status === 403) {
    return { kind: code === 'ORGANIZATION_ACCESS_DENIED' ? 'noOrganization' : 'forbidden' };
  }
  if (status === 429) return { kind: 'rateLimited' };
  // An account in several organizations: no screen chooses one yet (ARCHITECTURE §12).
  if (code === 'ORGANIZATION_SELECTION_REQUIRED') return { kind: 'chooseOrganization' };
  return recognised(messages) ?? { kind: 'other', sentence: messages.join(' '), requestId };
}

const FIELD_KINDS: readonly string[] = [
  'codeTaken',
  'codeRefused',
  'belowUsed',
  'valueRefused',
  'untilRefused',
] satisfies FieldKind[];

/** A refusal shown under the field it is about, in the page's words for it. */
export function isFieldRefusal(kind: string): kind is FieldKind {
  return FIELD_KINDS.includes(kind);
}

/** Where each field's refusal is shown on the form; the rest go above it. */
export const REFUSAL_FIELD: Partial<Record<PromoRefusal['kind'], string>> = {
  codeTaken: 'code',
  codeRefused: 'code',
  belowUsed: 'maxRedemptions',
  valueRefused: 'value',
  untilRefused: 'untilDate',
};
