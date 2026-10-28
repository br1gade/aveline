import { describe, expect, it } from 'vitest';

import { refusedVenueFields } from './server-errors';

describe('a refused venue, mapped to the form', () => {
  it.each([
    ['role must be one of CEREMONY, RECEPTION, AFTER_PARTY, PREPARATION, OTHER', 'role'],
    ['name must be shorter than or equal to 160 characters', 'name'],
    ['address must be a string', 'address'],
    ['mapUrl must be shorter than or equal to 500 characters', 'mapUrl'],
    ['arriveAt must be a date-time such as 2027-06-12T15:00:00Z', 'arrivalDate'],
  ])('puts “%s” under %s', (message, field) => {
    expect(refusedVenueFields([message])).toEqual([{ field, code: 'refused' }]);
  });

  it.each([
    'latitude: give latitude and longitude together',
    'longitude: give latitude and longitude together',
    'capacity must not be less than 1',
    'translations: "de" is not a language code',
    '1 timeline entr(ies) and 0 table(s) still point at this venue; move them first',
  ])('leaves “%s” to the general message, since the form has no such field', (message) => {
    expect(refusedVenueFields([message])).toEqual([]);
  });

  it('marks every field a 400 names at once', () => {
    expect(
      refusedVenueFields(['name must be a string', 'address must be a string']).map(
        (refusal) => refusal.field,
      ),
    ).toEqual(['name', 'address']);
  });
});
