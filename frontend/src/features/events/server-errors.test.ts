import { describe, expect, it } from 'vitest';

import { refusedFields } from './server-errors';

describe('refusedFields', () => {
  it('reads the service’s own messages, which name their field first', () => {
    expect(
      refusedFields([
        'timezone: "Mars/Base" is not an IANA time zone, such as Asia/Yerevan',
        'locales: list each language once',
        'defaultLocale: "fr" must be one of the event\'s languages (hy, en)',
      ]),
    ).toEqual([
      { field: 'timezone', code: 'timezone' },
      { field: 'locales', code: 'refused' },
      { field: 'defaultLocale', code: 'defaultLanguage' },
    ]);
  });

  it('reads class-validator’s messages, which start with the property name (FR-20)', () => {
    expect(
      refusedFields([
        'title must be longer than or equal to 2 characters',
        'hostsLabel must be shorter than or equal to 200 characters',
        'type must be one of the following values: WEDDING, OTHER',
      ]),
    ).toEqual([
      { field: 'title', code: 'refused' },
      { field: 'hostsLabel', code: 'refused' },
      { field: 'type', code: 'refused' },
    ]);
  });

  it('puts a refused start on the date', () => {
    expect(refusedFields(['startsAt must be a date-time such as 2027-06-12T15:00:00Z'])).toEqual([
      { field: 'date', code: 'refused' },
    ]);
  });

  it('explains an end time the form cannot change', () => {
    expect(refusedFields(['endsAt: must be after startsAt'])).toEqual([
      { field: 'date', code: 'endsBefore' },
    ]);
  });

  it('marks no field for anything else, which the form’s general message covers', () => {
    expect(
      refusedFields([
        'translations: en.title is too long',
        'each value in locales must be a string',
        'constructor: not a field',
      ]),
    ).toEqual([]);
  });
});
