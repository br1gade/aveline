import type { components } from '@/api/schema';
import { translationEdits } from '@/lib/i18n';
import { instantFromWallTime } from '@/lib/time';

import { VENUE_TRANSLATED } from './form-model';
import type { VenueUpdate } from './api';
import type { HallFormValues, VenueFormValues } from './schemas';

type Schemas = components['schemas'];

/** The arrival as UTC, or `null` for none. The form's schema refused anything that is not one instant. */
function arrivalOf(values: VenueFormValues, timeZone: string): string | null {
  if (!values.arrivalDate && !values.arrivalTime) return null;
  const arrival = instantFromWallTime(
    { date: values.arrivalDate, time: values.arrivalTime },
    timeZone,
  );
  if (arrival.kind !== 'instant') throw new Error(`The form let through a ${arrival.kind} arrival`);
  return arrival.iso;
}

/**
 * A blank map link and a blank arrival are left out. No coordinates: the guest page uses the link
 * (R-19). A directory hall's are copied by the server when `profileId` names it (design PD-101).
 */
export function createVenuePayload(
  values: VenueFormValues,
  timeZone: string,
  profileId?: string,
): Schemas['CreateVenueDto'] {
  const arriveAt = arrivalOf(values, timeZone);
  const translations = translationEdits({}, values.translations, VENUE_TRANSLATED);
  return {
    role: values.role,
    name: values.name,
    address: values.address,
    ...(values.mapUrl ? { mapUrl: values.mapUrl } : {}),
    ...(arriveAt ? { arriveAt } : {}),
    ...(profileId ? { profileId } : {}),
    ...(Object.keys(translations).length > 0 ? { translations } : {}),
  };
}

function isArrivalEdited(initial: VenueFormValues, values: VenueFormValues): boolean {
  return values.arrivalDate !== initial.arrivalDate || values.arrivalTime !== initial.arrivalTime;
}

/**
 * Only what the host changed (docs/API.md §6: omitted means unchanged), so a correction never
 * writes back a value someone else changed meanwhile. An emptied map link or arrival is `null`,
 * which clears it; a language's words go whole, or `null` when emptied. `stored` is the venue's
 * `translations` as loaded.
 */
export function updateVenuePayload(
  initial: VenueFormValues,
  values: VenueFormValues,
  timeZone: string,
  stored: unknown,
): VenueUpdate {
  const body: VenueUpdate = {};
  if (values.role !== initial.role) body.role = values.role;
  if (values.name !== initial.name) body.name = values.name;
  if (values.address !== initial.address) body.address = values.address;
  if (values.mapUrl !== initial.mapUrl) body.mapUrl = values.mapUrl || null;
  if (isArrivalEdited(initial, values)) body.arriveAt = arrivalOf(values, timeZone);
  const translations = translationEdits(stored, values.translations, VENUE_TRANSLATED);
  if (Object.keys(translations).length > 0) body.translations = translations;
  return body;
}

/** A new directory hall: what was left blank is left out. */
export function newHallPayload(values: HallFormValues): Schemas['CreateVenueProfileDto'] {
  return {
    name: values.name,
    address: values.address,
    ...(values.city ? { city: values.city } : {}),
    ...(values.capacity ? { capacity: Number(values.capacity) } : {}),
    ...(values.operatorId ? { vendorId: values.operatorId } : {}),
  };
}

/** Only what changed. An operator taken off is `null`, which unlinks just this hall. */
export function hallUpdatePayload(
  initial: HallFormValues,
  values: HallFormValues,
): Schemas['UpdateVenueProfileDto'] {
  const body: Schemas['UpdateVenueProfileDto'] = {};
  if (values.name !== initial.name) body.name = values.name;
  if (values.address !== initial.address) body.address = values.address;
  if (values.city !== initial.city) body.city = values.city;
  if (values.capacity !== initial.capacity) body.capacity = Number(values.capacity);
  if (values.operatorId !== initial.operatorId) body.vendorId = values.operatorId || null;
  return body;
}
