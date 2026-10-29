import type { ApiError } from '@/api/errors';

import type { NameField } from './schemas';

const FIELDS: readonly NameField[] = ['firstName', 'lastName'];

function isNameField(value: string | null | undefined): value is NameField {
  return FIELDS.some((field) => field === value);
}

/**
 * The fields a 400 refused. The backend's `details` name the property; class-validator's own
 * messages start with it, without a colon (FR-20). Anything else is the form's general message.
 */
export function refusedNameFields(error: ApiError): NameField[] {
  const named = error.details.map((detail) => detail.field).filter(isNameField);
  const fromMessages = error.messages
    .map((message) => /^(\w+)[: ]/.exec(message)?.[1])
    .filter(isNameField);
  return [...new Set([...named, ...fromMessages])];
}
