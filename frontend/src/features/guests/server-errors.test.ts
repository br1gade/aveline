import { describe, expect, it } from 'vitest';

import { refusedGuestFields, refusedHouseholdFields } from './server-errors';

describe('refusedGuestFields', () => {
  it.each([
    [
      'householdId: This household has 3 seat(s) and would have 4 guests; raise seatsAllotted first',
      { field: 'household', code: 'householdFull' },
    ],
    [
      'email: "ani@@example" does not look like an email address',
      { field: 'email', code: 'email' },
    ],
    ['phone: "call me" does not look like a phone number', { field: 'phone', code: 'phone' }],
    [
      'firstName must be longer than or equal to 1 characters',
      { field: 'firstName', code: 'refused' },
    ],
    [
      'lastName must be shorter than or equal to 80 characters',
      { field: 'lastName', code: 'refused' },
    ],
    ['seatsAllotted must not be greater than 20', { field: 'seats', code: 'seats' }],
    [
      'attribution must be one of the following values: SIDE_A, SIDE_B',
      { field: 'side', code: 'refused' },
    ],
    ['locale must be shorter than or equal to 10 characters', { field: 'locale', code: 'refused' }],
  ])('puts “%s” under its field', (message, expected) => {
    expect(refusedGuestFields([message])).toEqual([expected]);
  });

  it('maps nothing the message does not start with a field for', () => {
    expect(refusedGuestFields(["This guest's details were erased at their request"])).toEqual([]);
    expect(refusedGuestFields(['A CSV file is required', 'constructor: odd'])).toEqual([]);
  });

  it('maps every message of a list that names several fields', () => {
    expect(
      refusedGuestFields([
        'email: "x" does not look like an email address',
        'phone: "y" does not look like a phone number',
      ]),
    ).toEqual([
      { field: 'email', code: 'email' },
      { field: 'phone', code: 'phone' },
    ]);
  });
});

describe('refusedHouseholdFields', () => {
  it('says the seats cannot go below the guests already named', () => {
    expect(
      refusedHouseholdFields([
        'seatsAllotted: 3 guest(s) are already named in this household; remove or move some first',
      ]),
    ).toEqual([{ field: 'seats', code: 'seatsBelowNamed' }]);
  });

  it('puts a refused name under the name', () => {
    expect(refusedHouseholdFields(['name must be longer than or equal to 1 characters'])).toEqual([
      { field: 'name', code: 'refused' },
    ]);
  });

  it('maps a guest’s field to nothing here', () => {
    expect(refusedHouseholdFields(['email: "x" does not look like an email address'])).toEqual([]);
  });
});
