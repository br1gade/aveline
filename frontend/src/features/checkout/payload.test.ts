import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '@/api/errors';
import { createRetryKey } from '@/api/retry-key';

import { intentOf, orderBody, type OrderContext } from './payload';
import { blankPerson } from './roster';
import { EVENT_WIDE_RULES, PER_VENUE_RULES } from './test-data';
import type { CheckoutValues, PersonValues } from './types';

function person(overrides: Partial<PersonValues> = {}): PersonValues {
  return { ...blankPerson('general'), firstName: 'Anna', ...overrides };
}

function values(people: PersonValues[]): CheckoutValues {
  return {
    buyerFirstName: ' Ani ',
    buyerLastName: 'Grigoryan',
    buyerEmail: ' ani@example.com ',
    buyerPhone: '',
    people,
  };
}

const CONTEXT: OrderContext = {
  rules: EVENT_WIDE_RULES,
  basket: [{ ticketTypeId: 'general', quantity: 2 }],
  locale: 'hy',
  provider: 'FAKE',
  promoCode: null,
};

describe('the order body', () => {
  it('names the buyer apart from the people, and every ticket once with its quantity', () => {
    const body = orderBody(values([person(), person({ firstName: 'Davit' })]), CONTEXT);
    expect(body).toEqual({
      items: [{ ticketTypeId: 'general', quantity: 2 }],
      buyerName: 'Ani Grigoryan',
      buyerEmail: 'ani@example.com',
      locale: 'hy',
      attendanceRevision: 1,
      provider: 'FAKE',
      attendees: [
        { ticketTypeId: 'general', firstName: 'Anna' },
        { ticketTypeId: 'general', firstName: 'Davit' },
      ],
    });
  });

  it("never fills a person's contacts from the buyer's", () => {
    const body = orderBody(values([person({ isBuyer: true })]), CONTEXT);
    expect(body.attendees[0]).toEqual({ ticketTypeId: 'general', firstName: 'Anna' });
  });

  it("sends a person's own contacts, trimmed, and leaves out what is empty", () => {
    const body = orderBody(
      values([
        person({ lastName: ' Sargsyan ', email: ' anna@example.com', phone: '+374 10 000000' }),
      ]),
      CONTEXT,
    );
    expect(body.attendees[0]).toEqual({
      ticketTypeId: 'general',
      firstName: 'Anna',
      lastName: 'Sargsyan',
      email: 'anna@example.com',
      phone: '+374 10 000000',
    });
  });

  it('sends each answer as the API takes it: positions, booleans and trimmed text', () => {
    const body = orderBody(
      values([
        person({
          answers: {
            'q-meal': '1',
            'q-song': '  Autumn Leaves ',
            'q-allergy': 'no',
            'q-extras': ['0', '2'],
          },
          dietary: ['vegetarian'],
          dietaryNotes: ' No nuts ',
        }),
      ]),
      CONTEXT,
    );
    expect(body.attendees[0]).toMatchObject({
      dietary: ['vegetarian'],
      dietaryNotes: 'No nuts',
      answers: [
        { questionId: 'q-meal', value: 1 },
        { questionId: 'q-song', value: 'Autumn Leaves' },
        { questionId: 'q-allergy', value: false },
        { questionId: 'q-extras', value: [0, 2] },
      ],
    });
  });

  it('leaves out what the event does not ask, and questions not answered', () => {
    const body = orderBody(
      values([person({ drink: 'Wine', answers: { 'q-song': '', 'q-extras': [], 'q-gone': 'x' } })]),
      CONTEXT,
    );
    expect(body.attendees[0]).toEqual({ ticketTypeId: 'general', firstName: 'Anna' });
  });

  it('per venue, sends each person’s own venues and no details for someone not coming', () => {
    const context = { ...CONTEXT, rules: PER_VENUE_RULES };
    const body = orderBody(
      values([
        person({ venues: { 'v-church': 'ATTENDING' }, drink: ' Tea ', answers: { 'q-meal': '0' } }),
        person({ firstName: 'Davit', venues: { 'v-hall': 'DECLINED' }, drink: 'Wine' }),
      ]),
      context,
    );
    expect(body.attendanceRevision).toBe(3);
    expect(body.attendees).toEqual([
      {
        ticketTypeId: 'general',
        firstName: 'Anna',
        venueAttendance: [{ venueId: 'v-church', status: 'ATTENDING' }],
        drinkPreference: 'Tea',
        answers: [{ questionId: 'q-meal', value: 0 }],
      },
      {
        ticketTypeId: 'general',
        firstName: 'Davit',
        venueAttendance: [{ venueId: 'v-hall', status: 'DECLINED' }],
      },
    ]);
  });

  it('sends a promo code only once the buyer applied it', () => {
    const body = orderBody(values([person()]), { ...CONTEXT, promoCode: 'AUTUMN' });
    expect(body.promoCode).toBe('AUTUMN');
  });
});

describe('one idempotency key per attempt', () => {
  const people = [person(), person({ firstName: 'Davit' })];

  it('is the same intent whatever order its fields are in', () => {
    const body = orderBody(values(people), CONTEXT);
    const reordered = Object.fromEntries(Object.entries(body).reverse());
    expect(intentOf(reordered as typeof body)).toBe(intentOf(body));
  });

  it.each([
    ['the basket', { ...CONTEXT, basket: [{ ticketTypeId: 'general', quantity: 3 }] }],
    ['the promo code', { ...CONTEXT, promoCode: 'AUTUMN' }],
    ['the revision', { ...CONTEXT, rules: { ...EVENT_WIDE_RULES, attendanceRevision: 2 } }],
    ['the provider', { ...CONTEXT, provider: 'AMERIABANK' as const }],
  ])('is another intent when %s changes', (_, context) => {
    expect(intentOf(orderBody(values(people), context))).not.toBe(
      intentOf(orderBody(values(people), CONTEXT)),
    );
  });

  it('is another intent when a name or the buyer changes', () => {
    const before = intentOf(orderBody(values(people), CONTEXT));
    const renamed = [person(), person({ firstName: 'David' })];
    expect(intentOf(orderBody(values(renamed), CONTEXT))).not.toBe(before);
    const buyer = { ...values(people), buyerEmail: 'ani@example.org' };
    expect(intentOf(orderBody(buyer, CONTEXT))).not.toBe(before);
  });

  it('is sent again after no answer or a server failure, and made anew after a refusal or a change', () => {
    let made = 0;
    const retry = createRetryKey(() => `key-${(made += 1)}`);
    const intent = intentOf(orderBody(values(people), CONTEXT));
    const first = retry.next(intent);
    retry.settle(networkError('r1'));
    expect(retry.next(intent)).toBe(first);
    retry.settle(new ApiError({ status: 502, messages: [] }));
    expect(retry.next(intent)).toBe(first);
    retry.settle(
      new ApiError({ status: 409, messages: ['Only 1 ticket(s) remain; 2 were requested'] }),
    );
    expect(retry.next(intent)).not.toBe(first);
    const second = retry.next(intent);
    const changed = intentOf(orderBody(values([person(), person({ firstName: 'D' })]), CONTEXT));
    expect(retry.next(changed)).not.toBe(second);
  });
});
