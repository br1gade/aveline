import { isApiError, type ApiError } from '@/api/errors';

/**
 * Why checkout refused an order, and so what the page offers (design PD-80). The backend gives
 * most of these as English sentences under a generic code, so **a temporary stand-in** recognises
 * the ones it has by their exact words (`ticketing.service.ts`, `ticket-inventory.service.ts`,
 * `promo-code.ts`, `checkout-roster.ts`); anything else is shown as it came, marked English. It
 * is deleted when FR-63 gives codes, and nothing else may be added to it.
 */
export type PromoReason =
  'unknown' | 'unavailable' | 'otherEvent' | 'notYet' | 'expired' | 'ranOut' | 'minimum';

export type PromoRefusal =
  { reason: Exclude<PromoReason, 'minimum'> } | { reason: 'minimum'; minimumMinor: string };

export type CheckoutRefusal =
  | { kind: 'staleRevision' }
  | { kind: 'changedIntent' }
  | { kind: 'soldOut' }
  | { kind: 'notOnSale' }
  | { kind: 'salesClosed' }
  | { kind: 'salesNotOpen' }
  | { kind: 'orderLimits' }
  | ({ kind: 'promo' } & PromoRefusal)
  | { kind: 'requiredAnswer'; questionId: string }
  | { kind: 'notFound' }
  | { kind: 'paymentsOff' }
  | { kind: 'fields'; paths: string[] }
  | { kind: 'rateLimited' }
  | { kind: 'noAnswer'; requestId?: string | undefined }
  | { kind: 'other'; sentence: string; requestId?: string | undefined };

type Simple = Extract<
  CheckoutRefusal,
  { kind: 'soldOut' | 'notOnSale' | 'salesClosed' | 'salesNotOpen' | 'orderLimits' }
>;

const SENTENCES: ReadonlyArray<readonly [RegExp, Simple]> = [
  [/^Only \d+ ticket\(s\) remain; \d+ were requested$/, { kind: 'soldOut' }],
  [/^This ticket type is not on sale$/, { kind: 'notOnSale' }],
  [/^Ticket sales closed when this event started$/, { kind: 'salesClosed' }],
  [/^Sales have closed for this ticket type$/, { kind: 'salesClosed' }],
  [/^Sales have not opened for this ticket type$/, { kind: 'salesNotOpen' }],
  [/^At (?:least|most) \d+ ticket\(s\) per order$/, { kind: 'orderLimits' }],
];

const PROMO_SENTENCES: Readonly<Record<string, Exclude<PromoReason, 'minimum'>>> = {
  'We do not recognise that code': 'unknown',
  'This code is no longer available': 'unavailable',
  'This code does not apply to this event': 'otherEvent',
  'This code is not valid yet': 'notYet',
  'This code has expired': 'expired',
  'This code has run out': 'ranOut',
  'This code has just run out': 'ranOut',
};

const PROMO_MINIMUM = /^This code needs an order of at least (\d+)$/;

/** A promo code's refusal, from the promo check's `reason` or checkout's sentence. */
export function promoRefusal(sentence: string): PromoRefusal | null {
  if (Object.hasOwn(PROMO_SENTENCES, sentence)) {
    return { reason: PROMO_SENTENCES[sentence] ?? 'unknown' };
  }
  const minimum = PROMO_MINIMUM.exec(sentence)?.[1];
  return minimum ? { reason: 'minimum', minimumMinor: minimum } : null;
}

const REQUIRED_ANSWER = /^attendees: answer (\S+) is required$/;

const FIELD_PATHS: Readonly<Record<string, string>> = {
  buyerName: 'buyerFirstName',
  buyerEmail: 'buyerEmail',
  buyerPhone: 'buyerPhone',
};

const PERSON_FIELDS: Readonly<Record<string, string>> = {
  firstName: 'firstName',
  lastName: 'lastName',
  email: 'email',
  phone: 'phone',
  dietaryNotes: 'dietaryNotes',
  dietary: 'dietaryNotes',
  drinkPreference: 'drink',
  venueAttendance: 'venues',
  answers: 'answers',
};

/** The form's own path for a field the backend named, or `null` when it names no one field. */
export function formPath(field: string): string | null {
  if (Object.hasOwn(FIELD_PATHS, field)) return FIELD_PATHS[field] ?? null;
  const match = /^attendees\.(\d+)\.(\w+)/.exec(field);
  const own = match?.[2] && Object.hasOwn(PERSON_FIELDS, match[2]) ? PERSON_FIELDS[match[2]] : null;
  return match && own ? `people.${match[1]}.${own}` : null;
}

function fieldsOf(error: ApiError): string[] {
  const named = [
    ...error.details.flatMap((detail) => (detail.field ? [detail.field] : [])),
    ...Object.keys(error.fieldErrors),
  ];
  return [...new Set(named.flatMap((field) => formPath(field) ?? []))];
}

function isKeyConflict(error: ApiError): boolean {
  return (
    error.details.some((detail) => detail.field === 'idempotencyKey') ||
    error.messages.some((message) => message.startsWith('idempotencyKey:'))
  );
}

function byStatus(error: ApiError): CheckoutRefusal | null {
  if (error.status === 0 || error.status >= 500) {
    return { kind: 'noAnswer', requestId: error.requestId };
  }
  if (error.status === 429) return { kind: 'rateLimited' };
  if (error.status === 403) return { kind: 'paymentsOff' };
  if (error.status === 404) return { kind: 'notFound' };
  if (error.code === 'ATTENDANCE_CHANGED') return { kind: 'staleRevision' };
  return isKeyConflict(error) ? { kind: 'changedIntent' } : null;
}

function bySentence(sentence: string): CheckoutRefusal | null {
  const known = SENTENCES.find(([pattern]) => pattern.test(sentence));
  if (known) return known[1];
  const promo = promoRefusal(sentence);
  if (promo) return { kind: 'promo', ...promo };
  const questionId = REQUIRED_ANSWER.exec(sentence)?.[1];
  return questionId ? { kind: 'requiredAnswer', questionId } : null;
}

export function checkoutRefusal(error: unknown): CheckoutRefusal {
  if (!isApiError(error)) return { kind: 'noAnswer' };
  const sentence = error.messages[0] ?? '';
  const refusal = byStatus(error) ?? bySentence(sentence);
  if (refusal) return refusal;
  const paths = error.status === 400 ? fieldsOf(error) : [];
  return paths.length > 0
    ? { kind: 'fields', paths }
    : { kind: 'other', sentence, requestId: error.requestId };
}
