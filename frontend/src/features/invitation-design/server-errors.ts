import { isApiError } from '@/api/errors';

/**
 * The properties a 400 names. The design service starts its messages with the property and a
 * colon ("bodyFont: …", "variant: …", "assetIds: …", "options: …", "dietary: …"), and a theme's
 * refusal lists every problem at once; class-validator starts with the property and "must" or
 * "should" (FR-20); `details[].field` names it as well. Each form maps the ones it shows to its
 * fields, in its own words; anything else is the form's general message.
 */
const LEADING_PROPERTY = /^([A-Za-z][\w]*)(?::\s| must | should )/;

export function refusedProperties(error: unknown): string[] {
  if (!isApiError(error) || error.status !== 400) return [];
  const fromMessages = error.messages.flatMap((message) => {
    const property = LEADING_PROPERTY.exec(message)?.[1];
    return property ? [property] : [];
  });
  const fromDetails = error.details.flatMap((detail) => (detail.field ? [detail.field] : []));
  return [...new Set([...fromMessages, ...fromDetails])];
}
