import type { components } from '@/api/schema';
import { instantFromWallTime } from '@/lib/time';

import type { VenueUpdate } from './api';
import type { VenueFormValues } from './schemas';

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

/** A blank map link and a blank arrival are left out. No coordinates: the guest page uses the link (R-19). */
export function createVenuePayload(
  values: VenueFormValues,
  timeZone: string,
): Schemas['CreateVenueDto'] {
  const arriveAt = arrivalOf(values, timeZone);
  return {
    role: values.role,
    name: values.name,
    address: values.address,
    ...(values.mapUrl ? { mapUrl: values.mapUrl } : {}),
    ...(arriveAt ? { arriveAt } : {}),
  };
}

function isArrivalEdited(initial: VenueFormValues, values: VenueFormValues): boolean {
  return values.arrivalDate !== initial.arrivalDate || values.arrivalTime !== initial.arrivalTime;
}

/**
 * Only what the host changed (docs/API.md §6: omitted means unchanged), so a correction never
 * writes back a value someone else changed meanwhile. An emptied map link or arrival is `null`,
 * which clears it.
 */
export function updateVenuePayload(
  initial: VenueFormValues,
  values: VenueFormValues,
  timeZone: string,
): VenueUpdate {
  const body: VenueUpdate = {};
  if (values.role !== initial.role) body.role = values.role;
  if (values.name !== initial.name) body.name = values.name;
  if (values.address !== initial.address) body.address = values.address;
  if (values.mapUrl !== initial.mapUrl) body.mapUrl = values.mapUrl || null;
  if (isArrivalEdited(initial, values)) body.arriveAt = arrivalOf(values, timeZone);
  return body;
}
