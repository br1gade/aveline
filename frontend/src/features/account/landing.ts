import type { Organization } from './types';

/**
 * Where a signed-in person starts. With no organization and no event they have just registered,
 * so they create their organization (docs/API.md §6, "Becoming a tenant"). Someone brought onto
 * one event, door staff for example, has no organization and needs none.
 */
export function needsOrganization(organization: Organization | null, eventCount: number): boolean {
  return organization === null && eventCount === 0;
}
