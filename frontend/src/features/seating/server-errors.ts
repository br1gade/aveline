import { isApiError } from '@/api/errors';

import type { TableFieldCode } from './schemas';

export type TableField = 'name' | 'capacity' | 'zone' | 'namePrefix' | 'count';

export interface TableFieldRefusal {
  field: TableField;
  code: TableFieldCode;
}

const FIELDS: readonly string[] = [
  'name',
  'capacity',
  'zone',
  'namePrefix',
  'count',
] satisfies TableField[];

function isTableField(property: string): property is TableField {
  return FIELDS.includes(property);
}

/**
 * The service's own sentences that need more than "refused": a name another table here has, and
 * seats below those seated or their numbered chairs (`seating.service.ts`). Matched by text under
 * FR-28; a reworded one is still placed under its field, as "refused".
 */
const EXPLAINED: ReadonlyArray<readonly [RegExp, TableFieldCode]> = [
  [/^name: there is already a table called/, 'nameTaken'],
  [/^capacity: \d+ guest\(s\) are seated here/, 'belowSeated'],
  [/^capacity: move chairs outside/, 'chairsOutside'],
];

const LEADING_PROPERTY = /^([A-Za-z]+)(?::| )/;

function fromMessage(message: string): TableFieldRefusal | undefined {
  const property = LEADING_PROPERTY.exec(message)?.[1] ?? '';
  if (!isTableField(property)) return undefined;
  const explained = EXPLAINED.find(([pattern]) => pattern.test(message));
  return { field: property, code: explained?.[1] ?? 'refused' };
}

/**
 * Where a 400 goes on the table forms. The service prefixes its messages with the property
 * ("name: …"); class-validator starts with it and no colon ("count must not be…", FR-20); and
 * `details[].field` names it too. Each field is named once; one the form lacks (`venueId`) is the
 * form's general message.
 */
export function refusedTableFields(error: unknown): TableFieldRefusal[] {
  if (!isApiError(error) || error.status !== 400) return [];
  const found = new Map<TableField, TableFieldRefusal>();
  for (const refusal of error.messages.map(fromMessage)) {
    if (refusal && !found.has(refusal.field)) found.set(refusal.field, refusal);
  }
  for (const { field } of error.details) {
    if (field && isTableField(field) && !found.has(field))
      found.set(field, { field, code: 'refused' });
  }
  return [...found.values()];
}
