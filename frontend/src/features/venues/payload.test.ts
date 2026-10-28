import { describe, expect, it } from 'vitest';

import { NEW_VENUE_VALUES, venueFormValues } from './form-model';
import { createVenuePayload, updateVenuePayload } from './payload';
import type { VenueFormValues } from './schemas';
import type { Venue } from './types';

const filled: VenueFormValues = {
  role: 'CEREMONY',
  name: 'Saint Hripsime Church',
  address: 'Mesrop Mashtots St, Vagharshapat',
  mapUrl: '',
  arrivalDate: '',
  arrivalTime: '',
};

const venue: Venue = {
  id: 'v1',
  role: 'RECEPTION',
  name: 'Garden Hall ',
  address: '12 Garden Lane, Yerevan',
  mapUrl: 'https://maps.example.com/?q=garden',
  arriveAt: '2027-06-12T13:30:00.000Z',
};

describe('a new venue', () => {
  it('starts with nothing chosen or typed', () => {
    expect(NEW_VENUE_VALUES).toEqual({ ...filled, role: '', name: '', address: '' });
  });

  it('leaves out a blank map link and a blank arrival', () => {
    expect(createVenuePayload(filled, 'Asia/Yerevan')).toEqual({
      role: 'CEREMONY',
      name: 'Saint Hripsime Church',
      address: 'Mesrop Mashtots St, Vagharshapat',
    });
  });

  it.each([
    ['Asia/Yerevan', '2027-06-12', '15:30', '2027-06-12T11:30:00.000Z'],
    // British Summer Time, an hour ahead of UTC.
    ['Europe/London', '2027-06-12', '15:30', '2027-06-12T14:30:00.000Z'],
    // The day the clocks go back: 01:30 happens twice, and the earlier is meant (PD-43).
    ['Europe/London', '2027-10-31', '01:30', '2027-10-31T00:30:00.000Z'],
    // Half an hour off the hour.
    ['Asia/Kolkata', '2027-06-12', '15:30', '2027-06-12T10:00:00.000Z'],
  ])('sends the arrival typed in %s on %s at %s as %s', (zone, date, time, iso) => {
    const body = createVenuePayload(
      { ...filled, mapUrl: 'https://maps.example.com/x', arrivalDate: date, arrivalTime: time },
      zone,
    );
    expect(body).toMatchObject({ mapUrl: 'https://maps.example.com/x', arriveAt: iso });
  });
});

describe('correcting a venue', () => {
  it('shows the arrival in the event’s zone, never the device’s', () => {
    expect(venueFormValues(venue, 'Asia/Yerevan')).toEqual({
      role: 'RECEPTION',
      name: 'Garden Hall',
      address: '12 Garden Lane, Yerevan',
      mapUrl: 'https://maps.example.com/?q=garden',
      arrivalDate: '2027-06-12',
      arrivalTime: '17:30',
    });
  });

  it('sends nothing when nothing changed', () => {
    const initial = venueFormValues(venue, 'Asia/Yerevan');
    expect(updateVenuePayload(initial, { ...initial }, 'Asia/Yerevan')).toEqual({});
  });

  it('sends only what changed', () => {
    const initial = venueFormValues(venue, 'Asia/Yerevan');
    expect(
      updateVenuePayload(
        initial,
        { ...initial, address: '14 Garden Lane, Yerevan' },
        'Asia/Yerevan',
      ),
    ).toEqual({ address: '14 Garden Lane, Yerevan' });
    expect(updateVenuePayload(initial, { ...initial, role: 'OTHER' }, 'Asia/Yerevan')).toEqual({
      role: 'OTHER',
    });
  });

  it('sends a moved arrival as UTC, from the time alone', () => {
    const initial = venueFormValues(venue, 'Asia/Yerevan');
    expect(
      updateVenuePayload(initial, { ...initial, arrivalTime: '18:00' }, 'Asia/Yerevan'),
    ).toEqual({ arriveAt: '2027-06-12T14:00:00.000Z' });
  });

  it('clears the map link and the arrival with null', () => {
    const initial = venueFormValues(venue, 'Asia/Yerevan');
    const cleared = { ...initial, mapUrl: '', arrivalDate: '', arrivalTime: '' };
    expect(updateVenuePayload(initial, cleared, 'Asia/Yerevan')).toEqual({
      mapUrl: null,
      arriveAt: null,
    });
  });

  it('starts a venue without an arrival or a map link empty', () => {
    expect(
      venueFormValues({ ...venue, mapUrl: null, arriveAt: null }, 'Asia/Yerevan'),
    ).toMatchObject({ mapUrl: '', arrivalDate: '', arrivalTime: '' });
  });
});
