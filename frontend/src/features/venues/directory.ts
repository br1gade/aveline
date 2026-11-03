import { isApiError } from '@/api/errors';

import type { DirectoryHall } from './types';

export interface CityGroup {
  /** `null` for halls with no city, shown as their own group. */
  city: string | null;
  halls: DirectoryHall[];
}

/** For the picker's groups, in the API's order: it sorts by city, then by name. */
export function hallsByCity(halls: readonly DirectoryHall[]): CityGroup[] {
  const groups = new Map<string | null, DirectoryHall[]>();
  for (const hall of halls) {
    const inCity = groups.get(hall.city);
    if (inCity) inCity.push(hall);
    else groups.set(hall.city, [hall]);
  }
  return [...groups].map(([city, inCity]) => ({ city, halls: inCity }));
}

/**
 * Why a directory write was refused. Only Aveline staff hold `directory:manage`, so a 403 here is
 * what a customer always meets (design PD-102, FR-6). An operator no longer eligible is the one
 * sentence told apart, by its exact words (FR-28), under a test that reads the source.
 */
export type HallRefusal =
  | { kind: 'gone' | 'operatorRefused'; isStale: true }
  | { kind: 'staffOnly' | 'rateLimited'; isStale?: undefined }
  | { kind: 'noAnswer'; requestId?: string | undefined; isStale?: undefined }
  | { kind: 'other'; sentence: string; requestId?: string | undefined; isStale?: undefined };

const OPERATOR_REFUSED = 'vendorId: choose an active curated VENUE vendor';

export function hallRefusalOf(error: unknown): HallRefusal {
  if (!isApiError(error)) throw error;
  const { status, messages, requestId } = error;
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId };
  if (status === 403) return { kind: 'staffOnly' };
  if (status === 404) return { kind: 'gone', isStale: true };
  if (status === 429) return { kind: 'rateLimited' };
  if (messages.includes(OPERATOR_REFUSED)) return { kind: 'operatorRefused', isStale: true };
  return { kind: 'other', sentence: messages.join(' '), requestId };
}
