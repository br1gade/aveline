import { translatedLanguages, translationValues } from '@/lib/i18n';
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
  translations: {},
};

/** What a venue's name and address are called in `translations`. */
export const VENUE_TRANSLATED = ['name', 'address'] as const;

/** The event's languages a venue's words are typed in: each but the default (design PD-109). */
export function venueLanguages(
  event: { locales: readonly string[]; defaultLocale: string },
  venue: Venue | null,
): string[] {
  return translatedLanguages(
    event.locales,
    event.defaultLocale,
    venue?.translations,
    VENUE_TRANSLATED,
  );
}

/** A new venue's form, with an empty name and address for each of the event's other languages. */
export function newVenueValues(languages: readonly string[]): VenueFormInput {
  return {
    ...NEW_VENUE_VALUES,
    translations: translationValues({}, languages, VENUE_TRANSLATED),
  };
}

/** A venue as the form shows it: its arrival read in the event's zone, never the device's. */
export function venueFormValues(
  venue: Venue,
  timeZone: string,
  languages: readonly string[] = [],
): VenueFormValues {
  const arrival = venue.arriveAt ? wallTimeOf(venue.arriveAt, timeZone) : { date: '', time: '' };
  return {
    role: venue.role,
    name: venue.name.trim(),
    address: venue.address.trim(),
    mapUrl: (venue.mapUrl ?? '').trim(),
    arrivalDate: arrival.date,
    arrivalTime: arrival.time,
    translations: translationValues(venue.translations, languages, VENUE_TRANSLATED),
  };
}
