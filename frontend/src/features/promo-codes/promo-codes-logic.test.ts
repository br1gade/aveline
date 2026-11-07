import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '@/api/errors';

import { limitsFormValues, limitsPayload, NEW_PROMO_VALUES, newPromoPayload } from './payload';
import { readPromoCodes } from './read';
import { promoRefusalOf, promoState, SENTENCES, zoneFor } from './rules';
import { limitsFormSchema, promoFormSchema, type PromoFormValues } from './schemas';
import type { PromoCode, PromoCodeWire } from './types';

const NOW = Date.parse('2027-05-01T12:00:00.000Z');

function wire(overrides: Partial<PromoCodeWire> = {}): PromoCodeWire {
  return {
    id: 'p1',
    code: 'FRIENDS',
    kind: 'PERCENT',
    value: '100',
    eventId: 'e1',
    event: { id: 'e1', title: 'Gala' },
    maxRedemptions: 10,
    redemptions: 4,
    remaining: 6,
    minOrderMinor: null,
    validFrom: null,
    validUntil: '2027-06-01T20:00:00.000Z',
    isActive: true,
    ...overrides,
  };
}

function code(overrides: Partial<PromoCodeWire> = {}): PromoCode {
  const [read] = readPromoCodes([wire(overrides)]);
  if (!read) throw new Error('No code');
  return read;
}

describe('reading the codes', () => {
  it('names the event, or none for every event', () => {
    expect(code()).toMatchObject({ eventTitle: 'Gala', kind: 'PERCENT', remaining: 6 });
    expect(code({ eventId: null, event: null })).toMatchObject({ eventId: null, eventTitle: null });
  });
});

describe('promoState', () => {
  it.each([
    [{}, 'active'],
    [{ isActive: false }, 'stopped'],
    [{ validUntil: '2027-05-01T12:00:00.000Z' }, 'active'],
    [{ validUntil: '2027-05-01T11:59:59.000Z' }, 'expired'],
    [{ validFrom: '2027-05-01T12:00:00.000Z' }, 'active'],
    [{ validFrom: '2027-05-02T00:00:00.000Z', validUntil: '2027-05-01T00:00:00.000Z' }, 'notYet'],
    [{ remaining: 0 }, 'usedUp'],
    [{ maxRedemptions: null, remaining: null }, 'active'],
    [{ validFrom: '2027-05-01T12:00:01.000Z' }, 'notYet'],
    [{ isActive: false, remaining: 0 }, 'stopped'],
  ])('%o is %s', (overrides, expected) => {
    expect(promoState(code(overrides), NOW)).toBe(expected);
  });
});

describe('zoneFor', () => {
  it('uses the code’s event’s zone, else Yerevan’s', () => {
    const events = new Map([['e1', 'Europe/Paris']]);
    expect(zoneFor('e1', events)).toBe('Europe/Paris');
    expect(zoneFor(null, events)).toBe('Asia/Yerevan');
    expect(zoneFor('gone', events)).toBe('Asia/Yerevan');
  });
});

describe('a new code', () => {
  const schema = promoFormSchema((eventId) => (eventId === 'e1' ? 'Europe/Paris' : 'Asia/Yerevan'));
  const valid: PromoFormValues = { ...NEW_PROMO_VALUES, code: 'friends-25', value: '25' };
  const problems = (values: Partial<PromoFormValues>) => {
    const result = schema.safeParse({ ...valid, ...values });
    return result.success
      ? {}
      : Object.fromEntries(
          result.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
        );
  };

  it.each([
    [{ code: '' }, { code: 'required' }],
    [{ code: 'AB' }, { code: 'codeShort' }],
    [{ code: 'ABC' }, {}],
    [{ code: 'A'.repeat(32) }, {}],
    [{ code: 'A'.repeat(33) }, { code: 'tooLong' }],
    [{ code: 'NO SPACES' }, { code: 'codeChars' }],
    [{ value: '0' }, { value: 'percent' }],
    [{ value: '101' }, { value: 'percent' }],
    [{ value: '100' }, {}],
    [{ value: '1' }, {}],
    [{ kind: 'FIXED' as const, value: '0' }, { value: 'amount' }],
    [{ kind: 'FIXED' as const, value: '5000.5' }, { value: 'amount' }],
    [{ kind: 'FIXED' as const, value: '5000' }, {}],
    [{ maxRedemptions: '0' }, { maxRedemptions: 'limit' }],
    [{ maxRedemptions: '1000000' }, {}],
    [{ maxRedemptions: '1000001' }, { maxRedemptions: 'limit' }],
    [{ minOrder: '20000' }, {}],
    [{ minOrder: 'ten' }, { minOrder: 'amount' }],
    [{ fromDate: '2027-06-01' }, { fromTime: 'pair' }],
    [
      { fromDate: '2027-06-01', fromTime: '10:00', untilDate: '2027-06-01', untilTime: '10:00' },
      { untilDate: 'untilBefore' },
    ],
  ])('checks %o', (values, expected) => {
    expect(problems(values)).toEqual(expected);
  });

  it('sends a percentage, the event, and only what was given, times in the event’s zone', () => {
    expect(
      newPromoPayload(
        {
          ...valid,
          eventId: 'e1',
          maxRedemptions: '50',
          untilDate: '2027-06-01',
          untilTime: '22:00',
        },
        'Europe/Paris',
      ),
    ).toEqual({
      code: 'friends-25',
      kind: 'PERCENT',
      value: '25',
      eventId: 'e1',
      maxRedemptions: 50,
      validUntil: '2027-06-01T20:00:00.000Z',
    });
  });

  it('sends an amount and a minimum in minor units of AMD, which has none', () => {
    expect(
      newPromoPayload(
        { ...valid, kind: 'FIXED', value: '5000', minOrder: '20000' },
        'Asia/Yerevan',
      ),
    ).toEqual({ code: 'friends-25', kind: 'FIXED', value: '5000', minOrderMinor: '20000' });
  });
});

describe('correcting a code', () => {
  const promo = code({ validFrom: '2027-05-10T08:00:00.000Z' });
  const zone = 'Asia/Yerevan';
  const initial = limitsFormValues(promo, zone);
  const problems = (values: Partial<typeof initial>, which = promo) => {
    const result = limitsFormSchema(which, zone).safeParse({ ...initial, ...values });
    return result.success
      ? []
      : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
  };

  it('shows the limit and the end in the code’s zone', () => {
    expect(initial).toEqual({ maxRedemptions: '10', untilDate: '2027-06-02', untilTime: '00:00' });
  });

  it('refuses a limit below what was used, and removing a limit or an end once set', () => {
    expect(problems({ maxRedemptions: '3' })).toEqual([['maxRedemptions', 'belowUsed']]);
    expect(problems({ maxRedemptions: '4' })).toEqual([]);
    expect(problems({ maxRedemptions: '' })).toEqual([['maxRedemptions', 'cantClear']]);
    expect(problems({ untilDate: '', untilTime: '' })).toEqual([['untilDate', 'cantClear']]);
  });

  it('refuses an end before the start, which the backend doesn’t check here', () => {
    expect(problems({ untilDate: '2027-05-10', untilTime: '12:00' })).toEqual([
      ['untilDate', 'untilBefore'],
    ]);
  });

  it('lets a code with no limit or end stay without one', () => {
    const open = code({ maxRedemptions: null, remaining: null, validUntil: null });
    const empty = limitsFormValues(open, zone);
    expect(limitsFormSchema(open, zone).safeParse(empty).success).toBe(true);
    expect(limitsPayload(empty, empty, zone)).toEqual({});
  });

  it('sends only what changed, never null', () => {
    expect(limitsPayload(initial, initial, zone)).toEqual({});
    expect(limitsPayload(initial, { ...initial, maxRedemptions: '20' }, zone)).toEqual({
      maxRedemptions: 20,
    });
    expect(limitsPayload(initial, { ...initial, untilTime: '12:00' }, zone)).toEqual({
      validUntil: '2027-06-02T08:00:00.000Z',
    });
  });
});

describe('promoRefusalOf', () => {
  const refused = (status: number, message = 'refused', errorCode?: string) =>
    new ApiError({
      status,
      messages: [message],
      requestId: `r-${status}`,
      ...(errorCode
        ? { feedback: { code: errorCode, action: undefined, userMessage: undefined, details: [] } }
        : {}),
    });

  it.each([
    [refused(403, 'This account may not billing:write', 'FORBIDDEN'), { kind: 'forbidden' }],
    [
      refused(403, 'organizationId: access is unavailable', 'ORGANIZATION_ACCESS_DENIED'),
      { kind: 'noOrganization' },
    ],
    [refused(429), { kind: 'rateLimited' }],
    [
      refused(
        409,
        'organizationId: select an organization for this action',
        'ORGANIZATION_SELECTION_REQUIRED',
      ),
      { kind: 'chooseOrganization' },
    ],
    [refused(499), { kind: 'other' }],
    [refused(500), { kind: 'noAnswer' }],
    [networkError(), { kind: 'noAnswer' }],
    [refused(409, 'You already have a code called SPRING25'), { kind: 'codeTaken' }],
    [
      refused(400, 'This code has already been used 12 time(s); the limit cannot be lower'),
      { kind: 'belowUsed' },
    ],
    [refused(400, 'A percentage discount cannot exceed 100'), { kind: 'valueRefused' }],
    [refused(400, 'validUntil must be after validFrom'), { kind: 'untilRefused' }],
    [refused(404, 'No such event in this organization'), { kind: 'eventGone', isStale: true }],
    [refused(404, 'No such promo code'), { kind: 'gone', isStale: true }],
    [refused(400, 'New words'), { kind: 'other', sentence: 'New words' }],
  ])('words %#', (error, expected) => {
    expect(promoRefusalOf(error)).toMatchObject(expected);
  });

  it('throws on what isn’t the API’s', () => {
    expect(() => promoRefusalOf(new Error('bug'))).toThrow('bug');
  });
});

describe('the backend’s sentences', () => {
  /** A message of each kind as the backend writes it, and the literal start its source holds. */
  const SAMPLES: ReadonlyArray<readonly [string, string]> = [
    ['You already have a code called SPRING25', 'You already have a code called '],
    [
      'A code may contain letters, numbers and hyphens only',
      'A code may contain letters, numbers and hyphens only',
    ],
    ['code must be longer than or equal to 3 characters', 'MinLength(3)'],
    [
      'This code has already been used 12 time(s); the limit cannot be lower',
      'This code has already been used ',
    ],
    ['A discount must be worth something', 'A discount must be worth something'],
    ['A percentage discount cannot exceed 100', 'A percentage discount cannot exceed 100'],
    ['validUntil must be after validFrom', 'validUntil must be after validFrom'],
    ['No such event in this organization', 'No such event in this organization'],
    ['No such promo code', 'No such promo code'],
  ];
  const source = ['promo-codes.service.ts', 'dto/promo-code.dto.ts']
    .map((path) =>
      readFileSync(join(process.cwd(), '..', 'backend', 'src', 'modules', 'billing', path), 'utf8'),
    )
    .join('\n');

  it.each(SAMPLES)('recognises “%s”, whose start is in the source', (sample, literal) => {
    expect(source).toContain(literal);
    expect(SENTENCES.some(([pattern]) => pattern.test(sample))).toBe(true);
  });

  it('has a sample for every sentence it recognises', () => {
    for (const [pattern] of SENTENCES) {
      expect(SAMPLES.some(([sample]) => pattern.test(sample))).toBe(true);
    }
  });
});
