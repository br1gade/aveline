import { z } from 'zod';

import type { CheckoutQuestion, CheckoutRules } from '@/features/public-event';

import { hasVenueAnswer, isComing } from './attendance';
import type { CheckoutValues, PersonValues } from './types';

/**
 * Checkout's own checks, with the backend's limits (`CreateOrderDto`, `OrderAttendeeDto`,
 * `readPhone`, the answers' rules), so most refusals never reach the server, which stays the
 * authority. Messages are codes, worded by the form.
 */
export type CheckoutFieldCode =
  'required' | 'tooLong' | 'email' | 'phone' | 'chooseVenue' | 'buyerOnce';

export const LIMITS = {
  name: 80,
  buyerName: 120,
  email: 200,
  phone: 40,
  dietaryNotes: 500,
  drink: 80,
  text: 500,
  longText: 4000,
} as const;

/** The backend's own pattern for a phone number (`guest-rules.ts`, `readPhone`). */
const PHONE = /^\+?[\d\s()-]{6,}$/;

function text(limit: number) {
  return z.string().max(limit, { error: 'tooLong' satisfies CheckoutFieldCode });
}

function required(limit: number) {
  return z
    .string()
    .refine((value) => value.trim() !== '', { error: 'required' satisfies CheckoutFieldCode })
    .pipe(text(limit));
}

const email = text(LIMITS.email).refine(
  (value) => value.trim() === '' || z.email().safeParse(value.trim()).success,
  { error: 'email' satisfies CheckoutFieldCode },
);

const phone = text(LIMITS.phone).refine(
  (value) => value.trim() === '' || PHONE.test(value.trim()),
  { error: 'phone' satisfies CheckoutFieldCode },
);

const personFields = z.object({
  ticketTypeId: z.string(),
  firstName: required(LIMITS.name),
  lastName: text(LIMITS.name),
  email,
  phone,
  isBuyer: z.boolean(),
  dietary: z.array(z.string()),
  dietaryNotes: text(LIMITS.dietaryNotes),
  drink: text(LIMITS.drink),
  // An input nobody touched is empty, null or false, as React Hook Form leaves it: unanswered.
  answers: z.record(
    z.string(),
    z.union([z.string(), z.array(z.string()), z.boolean(), z.null()]).optional(),
  ),
  venues: z.record(
    z.string(),
    z.enum(['ATTENDING', 'DECLINED', 'UNDECIDED', '']).nullable().optional(),
  ),
});

function isAnswered(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'string' && value.trim() !== '';
}

function answerLimit(question: CheckoutQuestion): number | null {
  if (question.type === 'TEXT') return LIMITS.text;
  return question.type === 'LONG_TEXT' ? LIMITS.longText : null;
}

/** A required question binds only someone coming; a text answer keeps the API's length. */
function answerIssue(rules: CheckoutRules, person: PersonValues, question: CheckoutQuestion) {
  const value = person.answers[question.id];
  if (question.required && !isAnswered(value) && isComing(rules, person)) return 'required';
  const limit = answerLimit(question);
  return limit !== null && typeof value === 'string' && value.length > limit ? 'tooLong' : null;
}

function personSchema(rules: CheckoutRules) {
  return personFields.superRefine((person, context) => {
    if (!hasVenueAnswer(rules, person)) {
      context.addIssue({ code: 'custom', path: ['venues'], message: 'chooseVenue' });
    }
    for (const question of rules.questions) {
      const issue = answerIssue(rules, person, question);
      if (issue)
        context.addIssue({ code: 'custom', path: ['answers', question.id], message: issue });
    }
  });
}

/** One person on their own: the hosts' registration of a ticket sold before named checkout. */
export function holderSchema(rules: CheckoutRules) {
  return z.object({ people: z.array(personSchema(rules)).length(1) });
}

function wholeName(values: Pick<CheckoutValues, 'buyerFirstName' | 'buyerLastName'>): string {
  return `${values.buyerFirstName.trim()} ${values.buyerLastName.trim()}`.trim();
}

export function checkoutSchema(rules: CheckoutRules) {
  return z
    .object({
      buyerFirstName: required(LIMITS.name),
      buyerLastName: text(LIMITS.name),
      buyerEmail: required(LIMITS.email).pipe(email),
      buyerPhone: phone,
      people: z.array(personSchema(rules)),
    })
    .superRefine((values, context) => {
      if (wholeName(values).length > LIMITS.buyerName) {
        context.addIssue({ code: 'custom', path: ['buyerLastName'], message: 'tooLong' });
      }
      const buyers = values.people.flatMap((person, index) => (person.isBuyer ? [index] : []));
      for (const index of buyers.slice(1)) {
        context.addIssue({
          code: 'custom',
          path: ['people', index, 'isBuyer'],
          message: 'buyerOnce',
        });
      }
    });
}
