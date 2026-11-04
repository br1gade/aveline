import type { ApiClient } from '@/api/client';
import { expectData } from '@/api/client';
import { readEveryPage } from '@/api/every-page';
import { browserSession, organizationChoice } from '@/api/session';

import type { OwnOrganization, OwnOrganizationWire } from './types';

/**
 * Which organization this tab works in (design PD-138, docs/API.md §6). One membership needs no
 * selection and sends none, as ever; several are a 409 on every organization's call until one is
 * chosen. The database's gate keeps anyone from having two today, so this has only run on mocks.
 */
export interface OrganizationSettled {
  current: OwnOrganization | null;
  needsChoice: boolean;
  canChange: boolean;
}

/** Several pages would be a very unusual account; the page cap only stops a runaway list. */
const MAX_PAGES = 10;

export async function listOwnOrganizations(api: ApiClient): Promise<OwnOrganization[]> {
  const { items } = await readEveryPage<OwnOrganizationWire>(
    (after) =>
      expectData(
        api.GET('/api/v1/me/organizations', {
          params: { query: after ? { cursor: after } : {} },
        }),
      ),
    MAX_PAGES,
  );
  return items.map(({ organizationId, name, role }) => ({ organizationId, name, role }));
}

/** What the account's memberships and this tab's choice come to; a stale choice is forgotten. */
export function settleChoice(organizations: readonly OwnOrganization[]): OrganizationSettled {
  const chosen = organizationChoice.read();
  const match = organizations.find((item) => item.organizationId === chosen) ?? null;
  if (chosen && (!match || organizations.length < 2)) organizationChoice.clear();
  const canChange = organizations.length > 1;
  return {
    current: canChange ? match : (organizations[0] ?? null),
    needsChoice: canChange && !match,
    canChange,
  };
}

/** The layout's answer for this tab: read once, again only when something says it changed. */
let settledOnce: Promise<OrganizationSettled> | null = null;
let hasWatchedSession = false;

export function settleOrganization(api: ApiClient): Promise<OrganizationSettled> {
  // Another account may sign in in this tab, without a reload.
  hasWatchedSession ||= Boolean(browserSession().onSignedOut(forgetSettledOrganization));
  settledOnce ??= listOwnOrganizations(api).then(settleChoice);
  // A failed read is the page's to report, with its own words; the next page asks again.
  settledOnce.catch(() => {
    settledOnce = null;
  });
  return settledOnce;
}

/** After choosing, or when a refusal says the choice no longer holds. */
export function forgetSettledOrganization(): void {
  settledOnce = null;
}
