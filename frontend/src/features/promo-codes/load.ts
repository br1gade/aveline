import type { ApiClient } from '@/api/client';
import { isApiError } from '@/api/errors';
import { ownOrganization } from '@/features/account';
import { listEvents, type EventSummary } from '@/features/events';

import { listPromoCodes } from './api';
import { promoRefusalOf, type PromoRefusal } from './rules';
import type { PromoCode } from './types';

export interface PromoCodesData {
  /** Refused to anyone but the organization's owner, which is worded. */
  codes: { kind: 'ready'; value: PromoCode[] } | { kind: 'refused'; refusal: PromoRefusal };
  /** The organization's own current events, to limit a new code to; `null` if unread. */
  events: EventSummary[] | null;
  /** Each event's zone, archived ones included, for the codes limited to them. */
  zones: ReadonlyMap<string, string>;
  /** The clock the codes' states are read at, so a render never reads it again. */
  now: number;
}

async function codesOrRefusal(api: ApiClient): Promise<PromoCodesData['codes']> {
  try {
    return { kind: 'ready', value: await listPromoCodes(api) };
  } catch (error) {
    return { kind: 'refused', refusal: promoRefusalOf(error) };
  }
}

/** A read the page can do without: a failure leaves it out, and the page says so. */
async function unlessFailed<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (!isApiError(error)) throw error;
    return null;
  }
}

/**
 * `GET /events` also lists events the caller was invited onto in another organization, which a
 * code of this one refuses ("No such event in this organization"), so the choices are this
 * organization's alone. Archived events aren't offered, but their codes still show in their zone.
 */
export async function loadPromoCodes(api: ApiClient): Promise<PromoCodesData> {
  const [codes, current, archived, organization] = await Promise.all([
    codesOrRefusal(api),
    unlessFailed(listEvents(api)),
    unlessFailed(listEvents(api, { isArchiveWanted: true })),
    unlessFailed(ownOrganization(api)),
  ]);
  const zones = new Map(
    [...(current ?? []), ...(archived ?? [])].map((event) => [event.id, event.timezone]),
  );
  const ownId = organization?.organizationId;
  const events = current?.filter((event) => event.organizationId === ownId) ?? null;
  return { codes, events, zones, now: Date.now() };
}
