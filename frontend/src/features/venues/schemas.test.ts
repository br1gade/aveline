import { describe, expect, it } from 'vitest';

import { NEW_VENUE_VALUES } from './form-model';
import { venueFormSchema, type VenueFormInput } from './schemas';

const filled: VenueFormInput = {
  ...NEW_VENUE_VALUES,
  role: 'RECEPTION',
  name: 'Garden Hall',
  address: '12 Garden Lane, Yerevan',
};

/** Each refused field with the code its message is worded from. */
function refusals(input: VenueFormInput, zone = 'Asia/Yerevan'): Record<string, string> {
  const result = venueFormSchema(zone).safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
  );
}

describe('the venue form’s checks', () => {
  it('accepts a role, a name and an address, and trims them', () => {
    const result = venueFormSchema('Asia/Yerevan').parse({
      ...filled,
      name: '  Garden Hall ',
      mapUrl: ' https://maps.example.com/x ',
    });
    expect(result).toMatchObject({ name: 'Garden Hall', mapUrl: 'https://maps.example.com/x' });
  });

  it('asks for a role, a name and an address, refusing blank ones', () => {
    expect(refusals({ ...NEW_VENUE_VALUES, name: '   ', address: ' ' })).toEqual({
      role: 'choose',
      name: 'required',
      address: 'required',
    });
  });

  it.each([
    ['name', 161],
    ['address', 301],
  ] as const)('refuses a %s longer than the backend takes', (field, length) => {
    expect(refusals({ ...filled, [field]: 'x'.repeat(length) })).toEqual({ [field]: 'tooLong' });
    expect(refusals({ ...filled, [field]: 'x'.repeat(length - 1) })).toEqual({});
  });

  it.each(['javascript:alert(1)', 'ftp://example.com/map', 'maps.example.com/garden'])(
    'refuses %s as a map link, which the guest page would not show',
    (mapUrl) => {
      expect(refusals({ ...filled, mapUrl })).toEqual({ mapUrl: 'mapUrl' });
    },
  );

  it('refuses a map link longer than 500 characters', () => {
    const mapUrl = `https://maps.example.com/${'x'.repeat(476)}`;
    expect(refusals({ ...filled, mapUrl })).toEqual({ mapUrl: 'tooLong' });
  });

  it('takes the arrival’s date and time together, or neither', () => {
    expect(refusals({ ...filled, arrivalDate: '2027-06-12' })).toEqual({
      arrivalTime: 'arrivalPair',
    });
    expect(refusals({ ...filled, arrivalTime: '15:30' })).toEqual({ arrivalDate: 'arrivalPair' });
    expect(refusals({ ...filled, arrivalDate: '2027-06-12', arrivalTime: '15:30' })).toEqual({});
  });

  it('refuses a time the clocks skip in the event’s zone, on the time field (PD-43)', () => {
    const skipped = { ...filled, arrivalDate: '2027-03-28', arrivalTime: '01:30' };
    expect(refusals(skipped, 'Europe/London')).toEqual({ arrivalTime: 'timeSkipped' });
    expect(refusals(skipped, 'Asia/Yerevan')).toEqual({});
  });

  it('refuses a date that does not exist', () => {
    expect(refusals({ ...filled, arrivalDate: '2027-02-30', arrivalTime: '15:30' })).toEqual({
      arrivalDate: 'dateInvalid',
    });
  });
});
