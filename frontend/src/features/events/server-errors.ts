import type { EventFieldCode } from './schemas';

export type EventField =
  'type' | 'title' | 'hostsLabel' | 'date' | 'time' | 'timezone' | 'locales' | 'defaultLocale';

export interface FieldRefusal {
  field: EventField;
  code: EventFieldCode;
}

/**
 * Where each property's refusal goes on the form. The service prefixes its messages with the
 * property ("timezone: …"); class-validator starts with it and no colon ("title must be…", FR-20).
 * Both put the property name first, which is all this reads. The words are the page's own.
 */
const BY_PROPERTY: Readonly<Record<string, FieldRefusal>> = {
  type: { field: 'type', code: 'refused' },
  title: { field: 'title', code: 'refused' },
  hostsLabel: { field: 'hostsLabel', code: 'refused' },
  startsAt: { field: 'date', code: 'refused' },
  // The end is not on the form yet: a start after it is refused, and said so at the date.
  endsAt: { field: 'date', code: 'endsBefore' },
  timezone: { field: 'timezone', code: 'timezone' },
  locales: { field: 'locales', code: 'refused' },
  defaultLocale: { field: 'defaultLocale', code: 'defaultLanguage' },
};

const LEADING_PROPERTY = /^([A-Za-z]+)(?::| )/;

/** The fields a 400's messages name. Anything else is covered by the form's general message. */
export function refusedFields(messages: readonly string[]): FieldRefusal[] {
  return messages.flatMap((message) => {
    const property = LEADING_PROPERTY.exec(message)?.[1] ?? '';
    const refusal = Object.hasOwn(BY_PROPERTY, property) ? BY_PROPERTY[property] : undefined;
    return refusal ? [refusal] : [];
  });
}
