import type { Basket, CheckoutQuestion, CheckoutRules } from '@/features/public-event';

import { attendanceBody, isComing } from './attendance';
import type {
  AnswerValue,
  AttendeeBody,
  CheckoutValues,
  CustomAnswerBody,
  OrderBody,
  PaymentProvider,
  PersonValues,
} from './types';

/** What the order depends on beyond the form: the event's rules, the basket and the page. */
export interface OrderContext {
  rules: CheckoutRules;
  basket: Basket;
  /** The page's language, the one the response named: the buyer's emails follow it. */
  locale: string;
  provider: PaymentProvider;
  /** A code the promo check accepted; `null` when none was applied. */
  promoCode: string | null;
}

function filled(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

const FORM_BOOLEAN: Readonly<Record<string, boolean>> = { yes: true, no: false };

/** A form value as the API takes it: a choice by its position, never its words (C-17). */
function answerValue(
  question: CheckoutQuestion,
  value: AnswerValue,
): CustomAnswerBody['value'] | undefined {
  switch (question.type) {
    case 'BOOLEAN':
      return typeof value === 'string' ? FORM_BOOLEAN[value] : undefined;
    case 'SINGLE_CHOICE':
      return typeof value === 'string' && value !== '' ? Number(value) : undefined;
    case 'MULTI_CHOICE':
      return Array.isArray(value) && value.length > 0 ? value.map(Number) : undefined;
    default:
      return typeof value === 'string' ? filled(value) : undefined;
  }
}

function answersOf(rules: CheckoutRules, person: PersonValues): CustomAnswerBody[] {
  return rules.questions.flatMap((question) => {
    const value = answerValue(question, person.answers[question.id] ?? '');
    return value === undefined ? [] : [{ questionId: question.id, value }];
  });
}

/** Dietary needs, a drink and the host's questions: asked only of someone coming. */
function detailsOf(rules: CheckoutRules, person: PersonValues): Partial<AttendeeBody> {
  if (!isComing(rules, person)) return {};
  const answers = answersOf(rules, person);
  const dietary = rules.dietary.isEnabled && rules.dietary.options ? person.dietary : [];
  return {
    ...(dietary.length > 0 ? { dietary } : {}),
    ...(rules.dietary.isEnabled ? optional('dietaryNotes', person.dietaryNotes) : {}),
    ...(rules.drink.isEnabled ? optional('drinkPreference', person.drink) : {}),
    ...(answers.length > 0 ? { answers } : {}),
  };
}

function optional<K extends string>(key: K, value: string): Partial<Record<K, string>> {
  const text = filled(value);
  return text === undefined ? {} : ({ [key]: text } as Record<K, string>);
}

/**
 * One person. Their email and phone are their own: an omitted contact never falls back to the
 * buyer's, even on the buyer's own ticket (docs/API.md §5).
 */
export function attendeeBody(rules: CheckoutRules, person: PersonValues): AttendeeBody {
  return {
    ticketTypeId: person.ticketTypeId,
    firstName: person.firstName.trim(),
    ...optional('lastName', person.lastName),
    ...optional('email', person.email),
    ...optional('phone', person.phone),
    ...attendanceBody(rules, person),
    ...detailsOf(rules, person),
  };
}

/**
 * The order checkout sends, without its idempotency key. `returnUrl` is left out: the backend's
 * default is this client's `/tickets/return`, which the route contract pins.
 */
export function orderBody(values: CheckoutValues, context: OrderContext): OrderBody {
  const buyerName = `${values.buyerFirstName.trim()} ${values.buyerLastName.trim()}`.trim();
  return {
    items: context.basket.map(({ ticketTypeId, quantity }) => ({ ticketTypeId, quantity })),
    buyerName,
    buyerEmail: values.buyerEmail.trim(),
    ...optional('buyerPhone', values.buyerPhone),
    locale: context.locale,
    attendanceRevision: context.rules.attendanceRevision,
    attendees: values.people.map((person) => attendeeBody(context.rules, person)),
    provider: context.provider,
    ...(context.promoCode ? { promoCode: context.promoCode } : {}),
  };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  }
  return value;
}

/**
 * The order's intent, for its idempotency key: the same body, in any field order, is the same
 * attempt, and anything changed is another (docs/API.md §5: a changed intent needs a new key).
 */
export function intentOf(body: OrderBody): string {
  return JSON.stringify(stable(body));
}
