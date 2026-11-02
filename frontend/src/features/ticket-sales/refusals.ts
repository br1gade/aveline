import { isApiError, type ApiError } from '@/api/errors';

/**
 * Why the announcement could not be published, and why a ticket type's change was refused
 * (docs/API.md §5). The backend gives English sentences under generic codes, so **a temporary
 * stand-in** recognises the ones it has by their exact words (`ticket-setup.service.ts`); anything
 * else is shown as it came, marked English. Deleted when FR-69 and FR-28 give codes.
 */
export type PublishBlocker =
  | { kind: 'archived' | 'private' | 'headline' | 'started' | 'noListing' }
  | { kind: 'other'; sentence: string };

const BLOCKERS: Readonly<Record<string, Exclude<PublishBlocker['kind'], 'other'>>> = {
  'This event is archived. Unarchive it first': 'archived',
  'This event is private. Set its visibility to PUBLIC or UNLISTED first, deliberately': 'private',
  'headline: give the listing a headline in at least one language': 'headline',
  'This event has already started': 'started',
  'Create the listing before publishing it': 'noListing',
};

function blockerOf(sentence: string): PublishBlocker {
  const kind = Object.hasOwn(BLOCKERS, sentence) ? BLOCKERS[sentence] : undefined;
  return kind ? { kind } : { kind: 'other', sentence };
}

/** Every reason publishing was refused, at once; `[]` when the refusal was something else. */
export function publishBlockers(error: unknown): PublishBlocker[] {
  if (!isApiError(error) || (error.status !== 400 && error.status !== 404)) return [];
  return error.messages.map(blockerOf);
}

export type TypeRefusal =
  | { kind: 'inUse' | 'capacityTaken' | 'gone' | 'forbidden' }
  | { kind: 'fields'; paths: string[] }
  | { kind: 'other'; error: unknown };

/** A refused field, on the form's own field: the backend prefixes its own sentences. */
const FIELD_PATHS: Readonly<Record<string, string>> = {
  name: 'names',
  priceMinor: 'price',
  quantityTotal: 'quantityTotal',
  minPerOrder: 'minPerOrder',
  maxPerOrder: 'maxPerOrder',
  salesStartAt: 'salesStartDate',
  salesEndAt: 'salesEndDate',
};

function fieldsOf(error: ApiError): string[] {
  return Object.keys(error.fieldErrors).flatMap((field) =>
    Object.hasOwn(FIELD_PATHS, field) ? [FIELD_PATHS[field] ?? field] : [],
  );
}

const IN_USE = [
  /held against this type\. Set isActive to false/,
  /has checkout history or someone started buying it/,
];

export function typeRefusal(error: unknown): TypeRefusal {
  if (!isApiError(error)) return { kind: 'other', error };
  const sentence = error.messages[0] ?? '';
  if (error.status === 403) return { kind: 'forbidden' };
  if (error.status === 404) return { kind: 'gone' };
  if (error.status === 409 && IN_USE.some((pattern) => pattern.test(sentence)))
    return { kind: 'inUse' };
  if (error.status === 409) return { kind: 'capacityTaken' };
  const paths = error.status === 400 ? fieldsOf(error) : [];
  return paths.length > 0 ? { kind: 'fields', paths } : { kind: 'other', error };
}
