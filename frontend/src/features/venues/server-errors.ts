import type { VenueFieldCode } from './schemas';

export type VenueField = 'role' | 'name' | 'address' | 'mapUrl' | 'arrivalDate';

export interface FieldRefusal {
  field: VenueField;
  code: VenueFieldCode;
}

/**
 * Where each property's refusal goes on the venue form. The service prefixes its messages with the
 * property ("latitude: …"), class-validator starts with it and no colon ("name must be…", FR-20),
 * and the role check reads "role must be one of…". All put the property first, which is all this
 * reads; the words are the page's own. Coordinates, capacity and translations are not on the form,
 * so a refusal of one is the form's general message.
 */
const BY_PROPERTY: Readonly<Record<string, FieldRefusal>> = {
  role: { field: 'role', code: 'refused' },
  name: { field: 'name', code: 'refused' },
  address: { field: 'address', code: 'refused' },
  mapUrl: { field: 'mapUrl', code: 'refused' },
  arriveAt: { field: 'arrivalDate', code: 'refused' },
};

const LEADING_PROPERTY = /^([A-Za-z]+)(?::| )/;

/** The fields a 400's messages name. Anything else is covered by the form's general message. */
export function refusedVenueFields(messages: readonly string[]): FieldRefusal[] {
  return messages.flatMap((message) => {
    const property = LEADING_PROPERTY.exec(message)?.[1] ?? '';
    const refusal = Object.hasOwn(BY_PROPERTY, property) ? BY_PROPERTY[property] : undefined;
    return refusal ? [refusal] : [];
  });
}
