import { describe, expect, it } from 'vitest';

import { blankPerson } from './roster';
import { checkoutSchema } from './schemas';
import { EVENT_WIDE_RULES, PER_VENUE_RULES } from './test-data';
import type { CheckoutValues, PersonValues } from './types';
import { ADDRESSES_NOBODY_TAKES, ADDRESSES_THE_BACKEND_TAKES } from '../../../test/emails';

function person(overrides: Partial<PersonValues> = {}): PersonValues {
  return { ...blankPerson('general'), firstName: 'Anna', answers: { 'q-meal': '0' }, ...overrides };
}

function values(overrides: Partial<CheckoutValues> = {}): CheckoutValues {
  return {
    buyerFirstName: 'Ani',
    buyerLastName: '',
    buyerEmail: 'ani@example.com',
    buyerPhone: '',
    people: [person()],
    ...overrides,
  };
}

function issues(input: CheckoutValues, rules = EVENT_WIDE_RULES) {
  const result = checkoutSchema(rules).safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
}

describe("checkout's own checks", () => {
  it('accepts a complete order', () => {
    expect(issues(values())).toEqual([]);
  });

  it('asks for the buyer’s name and a working email address', () => {
    expect(issues(values({ buyerFirstName: '  ', buyerEmail: 'ani@' }))).toEqual([
      ['buyerFirstName', 'required'],
      ['buyerEmail', 'email'],
    ]);
  });

  it.each(ADDRESSES_THE_BACKEND_TAKES)('leaves the address %s to the backend', (address) => {
    expect(issues(values({ buyerEmail: address }))).toEqual([]);
  });

  it.each(ADDRESSES_NOBODY_TAKES)('refuses the address %s', (address) => {
    expect(issues(values({ buyerEmail: address }))).toEqual([['buyerEmail', 'email']]);
  });

  it('keeps the buyer’s whole name within 120 characters', () => {
    expect(
      issues(values({ buyerFirstName: 'A'.repeat(80), buyerLastName: 'B'.repeat(40) })),
    ).toEqual([['buyerLastName', 'tooLong']]);
    expect(
      issues(values({ buyerFirstName: 'A'.repeat(80), buyerLastName: 'B'.repeat(39) })),
    ).toEqual([]);
  });

  it.each([
    [{ firstName: '' }, 'people.0.firstName', 'required'],
    [{ firstName: 'A'.repeat(81) }, 'people.0.firstName', 'tooLong'],
    [{ email: 'anna' }, 'people.0.email', 'email'],
    [{ phone: '12ab' }, 'people.0.phone', 'phone'],
    [{ phone: '+374 (10) 00-00-00' + '0'.repeat(30) }, 'people.0.phone', 'tooLong'],
    [{ dietaryNotes: 'x'.repeat(501) }, 'people.0.dietaryNotes', 'tooLong'],
    [
      { answers: { 'q-meal': '0', 'q-song': 'x'.repeat(501) } },
      'people.0.answers.q-song',
      'tooLong',
    ],
    [{ answers: {} }, 'people.0.answers.q-meal', 'required'],
  ])('refuses a person with %o on %s', (overrides, path, code) => {
    expect(issues(values({ people: [person(overrides)] }))).toEqual([[path, code]]);
  });

  it.each(['+374 10 000000', '(010) 00-00-00', '094000000'])('takes the phone %j', (phone) => {
    expect(issues(values({ buyerPhone: phone, people: [person({ phone })] }))).toEqual([]);
  });

  it('asks per venue for at least one answer from each person', () => {
    const silent = person({ venues: { 'v-church': '' } });
    expect(issues(values({ people: [silent] }), PER_VENUE_RULES)).toEqual([
      ['people.0.venues', 'chooseVenue'],
    ]);
  });

  it('binds the required questions only to someone coming', () => {
    const declining = person({ venues: { 'v-church': 'DECLINED' }, answers: {} });
    expect(issues(values({ people: [declining] }), PER_VENUE_RULES)).toEqual([]);
    const coming = person({ venues: { 'v-hall': 'ATTENDING' }, answers: {} });
    expect(issues(values({ people: [coming] }), PER_VENUE_RULES)).toEqual([
      ['people.0.answers.q-meal', 'required'],
    ]);
  });

  it('lets only one ticket be the buyer’s own', () => {
    const people = [person({ isBuyer: true }), person({ isBuyer: true })];
    expect(issues(values({ people }))).toEqual([['people.1.isBuyer', 'buyerOnce']]);
  });
});
