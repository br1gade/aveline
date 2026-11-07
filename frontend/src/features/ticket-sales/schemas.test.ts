import { describe, expect, it } from 'vitest';

import { announcementFormValues, ticketTypeFormValues } from './form-model';
import { announcementSchema, ticketTypeSchema } from './schemas';
import { ticketType } from './test-data';

const CONTEXT = { languages: ['hy', 'en'], timeZone: 'Europe/London', currency: 'AMD' };

function typeIssues(
  overrides: Record<string, unknown>,
  options: Partial<Parameters<typeof ticketTypeSchema>[0]> = {},
) {
  const values = {
    ...ticketTypeFormValues(null, CONTEXT),
    names: { hy: '', en: 'General' },
    price: '0',
    quantityTotal: '10',
    ...overrides,
  };
  const result = ticketTypeSchema({
    ...CONTEXT,
    taken: 0,
    startWasSet: false,
    endWasSet: false,
    ...options,
  }).safeParse(values);
  return result.success
    ? []
    : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
}

describe("a ticket type's own checks", () => {
  it('accepts a complete type', () => {
    expect(typeIssues({})).toEqual([]);
  });

  it('needs a name in at least one language', () => {
    expect(typeIssues({ names: { hy: ' ', en: '' } })).toEqual([['names', 'nameRequired']]);
  });

  it.each([
    ['', 'required'],
    ['15000.5', 'price'],
    ['-1', 'price'],
    ['1e3', 'price'],
    ['1234567890123456', 'price'],
  ])('refuses the price %j in dram', (price, code) => {
    expect(typeIssues({ price })).toEqual([['price', code]]);
  });

  it.each([
    [{ quantityTotal: '0' }, [['quantityTotal', 'quantityRange']]],
    [{ quantityTotal: '100001' }, [['quantityTotal', 'quantityRange']]],
    [{ quantityTotal: '2.5' }, [['quantityTotal', 'quantityRange']]],
    [{ minPerOrder: '0' }, [['minPerOrder', 'perOrderRange']]],
    [{ maxPerOrder: '101' }, [['maxPerOrder', 'perOrderRange']]],
    [{ minPerOrder: '5', maxPerOrder: '4' }, [['maxPerOrder', 'minAboveMax']]],
  ])('refuses the limits %o', (overrides, expected) => {
    expect(typeIssues(overrides)).toEqual(expected);
  });

  it('keeps capacity at or above what is already sold or held', () => {
    expect(typeIssues({ quantityTotal: '13' }, { taken: 14 })).toEqual([
      ['quantityTotal', 'belowTaken'],
    ]);
    expect(typeIssues({ quantityTotal: '14' }, { taken: 14 })).toEqual([]);
  });

  it('needs both a date and a time, a time that exists, and an end after the start', () => {
    expect(typeIssues({ salesStartDate: '2027-09-01' })).toEqual([
      ['salesStartTime', 'dateAndTime'],
    ]);
    expect(typeIssues({ salesEndDate: '2027-03-28', salesEndTime: '01:30' })).toEqual([
      ['salesEndTime', 'skipped'],
    ]);
    expect(
      typeIssues({
        salesStartDate: '2027-09-02',
        salesStartTime: '10:00',
        salesEndDate: '2027-09-01',
        salesEndTime: '10:00',
      }),
    ).toEqual([['salesEndDate', 'endBeforeStart']]);
  });

  it('cannot clear a sales window once set (FR-67)', () => {
    expect(typeIssues({}, { endWasSet: true })).toEqual([['salesEndDate', 'cannotClear']]);
  });

  it('reads a stored type as valid', () => {
    const values = ticketTypeFormValues(ticketType(), CONTEXT);
    const result = ticketTypeSchema({
      ...CONTEXT,
      taken: 14,
      startWasSet: false,
      endWasSet: true,
    }).safeParse(values);
    expect(result.success).toBe(true);
  });
});

describe("the announcement's own checks", () => {
  function issues(overrides: Record<string, unknown>) {
    const values = { ...announcementFormValues(null, ['en']), ...overrides };
    const result = announcementSchema().safeParse(values);
    return result.success
      ? []
      : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
  }

  it.each(['autumn-jazz', 'jazz2027', ''])('takes the address %j', (slug) => {
    expect(issues({ slug })).toEqual([]);
  });

  it.each(['Autumn', 'autumn--jazz', '-jazz', 'jazz_night', 'a'.repeat(81)])(
    'refuses the address %j',
    (slug) => {
      expect(issues({ slug })).toEqual([['slug', 'slug']]);
    },
  );

  it('takes at most ten categories of at most 40 characters', () => {
    expect(issues({ categories: Array.from({ length: 11 }, (_, i) => `c${i}`).join(',') })).toEqual(
      [['categories', 'tooManyCategories']],
    );
    expect(issues({ categories: 'x'.repeat(41) })).toEqual([['categories', 'categoryTooLong']]);
  });
});
