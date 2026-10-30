import type { components } from '@/api/schema';

import type { BulkTablesValues, TableFormValues } from './schemas';

type Schemas = components['schemas'];

/** A table's change as the API takes it: `null` clears the zone (FR-56 types it otherwise). */
export interface TableUpdate {
  name?: string;
  capacity?: number;
  zone?: string | null;
}

/** Only what changed, and nothing when nothing did; an emptied zone is cleared with `null`. */
export function tableUpdatePayload(initial: TableFormValues, values: TableFormValues): TableUpdate {
  const body: TableUpdate = {};
  if (values.name !== initial.name) body.name = values.name;
  if (values.capacity !== initial.capacity) body.capacity = values.capacity;
  if (values.zone !== initial.zone) body.zone = values.zone === '' ? null : values.zone;
  return body;
}

/** A new table in the plan's venue; the plan without a venue sends none, and an empty zone none. */
export function newTablePayload(
  values: TableFormValues,
  venueId: string | null,
): Schemas['CreateTableDto'] {
  return {
    name: values.name,
    capacity: values.capacity,
    ...(values.zone ? { zone: values.zone } : {}),
    ...(venueId ? { venueId } : {}),
  };
}

export function bulkTablesPayload(
  values: BulkTablesValues,
  venueId: string | null,
): Schemas['CreateTablesDto'] {
  return {
    namePrefix: values.namePrefix,
    count: values.count,
    capacity: values.capacity,
    ...(values.zone ? { zone: values.zone } : {}),
    ...(venueId ? { venueId } : {}),
  };
}
