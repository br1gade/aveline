import type { ApiClient } from '@/api/client';
import type { OffsetPage } from '@/ui/app-form';

import { listSuppressions } from './api';
import { suppressionRefusalOf, type SuppressionRefusal } from './rules';
import type { Suppression } from './types';

export interface SuppressionsData {
  /** Refused to anyone outside the organization, or whose role there may not read contacts. */
  list:
    | { kind: 'ready'; value: OffsetPage<Suppression> }
    | { kind: 'refused'; refusal: SuppressionRefusal };
}

/** The organization's list, its newest page; a refusal leaves the page to say who can see it. */
export async function loadSuppressions(api: ApiClient): Promise<SuppressionsData> {
  try {
    return { list: { kind: 'ready', value: await listSuppressions(api) } };
  } catch (error) {
    return { list: { kind: 'refused', refusal: suppressionRefusalOf(error) } };
  }
}
