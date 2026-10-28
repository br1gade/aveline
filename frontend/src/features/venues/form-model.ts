import { wallTimeOf } from '@/lib/time';

import type { VenueFormInput, VenueFormValues } from './schemas';
import type { Venue } from './types';

export const NEW_VENUE_VALUES: VenueFormInput = {
  role: '',
  name: '',
  address: '',
  mapUrl: '',
  arrivalDate: '',
  arrivalTime: '',
};

/** A venue as the form shows it: its arrival read in the event's zone, never the device's. */
export function venueFormValues(venue: Venue, timeZone: string): VenueFormValues {
  const arrival = venue.arriveAt ? wallTimeOf(venue.arriveAt, timeZone) : { date: '', time: '' };
  return {
    role: venue.role,
    name: venue.name.trim(),
    address: venue.address.trim(),
    mapUrl: (venue.mapUrl ?? '').trim(),
    arrivalDate: arrival.date,
    arrivalTime: arrival.time,
  };
}
