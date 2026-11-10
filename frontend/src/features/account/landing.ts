import { APP_PATHS } from '@/route-paths';

import type { Account, OwnOrganization } from './types';

/**
 * Where a signed-in person must go first, if anywhere. With no organization and no event they have
 * just registered, so they create their organization (docs/API.md §6, "Becoming a tenant"), unless
 * they are Aveline's staff, who belong to none by design. Someone brought onto one event, door staff
 * for example, has no organization and needs none.
 */
export function firstStopFor(
  organization: OwnOrganization | null,
  eventCount: number,
  isStaff: boolean,
): string | null {
  if (organization !== null || eventCount > 0) return null;
  return isStaff ? APP_PATHS.staff : APP_PATHS.welcome;
}

/**
 * Whether this account is Aveline's staff's (FR-5): both platform roles reach the staff tools
 * (`concierge:manage`). A hint for what a page offers; the server still decides every action.
 */
export function isAvelineStaff(account: Pick<Account, 'platformRole'>): boolean {
  return account.platformRole !== 'NONE';
}
