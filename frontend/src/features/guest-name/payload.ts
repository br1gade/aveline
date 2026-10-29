import type { NameValues } from './schemas';
import type { NameBody, SavedName } from './types';

/**
 * Only the names that changed, from checked values. An emptied surname is sent as `null`, which
 * clears it (docs/API.md §4); `null` when nothing changed, so nothing is sent.
 */
export function nameChange(saved: SavedName, values: NameValues): NameBody | null {
  const body: NameBody = {};
  if (values.firstName !== saved.firstName) body.firstName = values.firstName;
  const lastName = values.lastName === '' ? null : values.lastName;
  if (lastName !== saved.lastName) body.lastName = lastName;
  return Object.keys(body).length > 0 ? body : null;
}
