import { EventRole, OrganizationRole, PlatformRole } from '@prisma/client';
import { Actor, Permission, permissionsFor } from './access-policy';

/**
 * Each role's whole permission set, pinned against docs/ACCESS_CONTROL.md §2.
 * Sampling a few permissions per role lets a new grant slip in unnoticed;
 * comparing the full set does not, so a role widened by one permission (a
 * viewer gaining vendor:write, a concierge gaining billing:read) fails here.
 * The expected sets are written out rather than read from the policy, so the
 * test cannot agree with a mistake in it.
 */
const staff = (role: PlatformRole): Actor => ({ kind: 'staff', role });
const member = (organizationRole: OrganizationRole | null, eventRole: EventRole | null = null): Actor => ({
  kind: 'member',
  organizationRole,
  eventRole,
});

const READ_ONLY: Permission[] = ['event:read', 'guest:read', 'invitation:read', 'operations:read', 'seating:read', 'vendor:read'];
const RUN_EVENT: Permission[] = [
  ...READ_ONLY,
  'event:write',
  'guest:contact:read',
  'guest:write',
  'invitation:design',
  'invitation:publish',
  'seating:write',
  'vendor:fee:read',
  'vendor:write',
];
const CUSTOMER_OWNED: Permission[] = [...RUN_EVENT, 'event:delete', 'member:manage', 'billing:read', 'billing:write'];
const sorted = (permissions: readonly Permission[]) => [...new Set(permissions)].sort();

describe('what each organization role holds', () => {
  it('gives an owner every customer-owned permission and nothing reserved for Aveline staff', () => {
    expect(permissionsFor(member(OrganizationRole.OWNER))).toEqual(sorted(CUSTOMER_OWNED));
  });

  it('lets a manager run events, without deleting them, billing or the team', () => {
    expect(permissionsFor(member(OrganizationRole.MANAGER))).toEqual(sorted(RUN_EVENT));
  });

  it.each([OrganizationRole.MEMBER, OrganizationRole.VIEWER])('keeps an organization %s read-only, with no vendor:write', (role) => {
    expect(permissionsFor(member(role))).toEqual(sorted(READ_ONLY));
  });
});

describe('what each event role holds', () => {
  it('gives an event owner the running of it, its deletion and its team', () => {
    expect(permissionsFor(member(null, EventRole.OWNER))).toEqual(sorted([...RUN_EVENT, 'event:delete', 'member:manage']));
  });

  it('lets a coordinator run the event and nothing more', () => {
    expect(permissionsFor(member(null, EventRole.COORDINATOR))).toEqual(sorted(RUN_EVENT));
  });

  it('lets a designer read the event and design its invitation, and nothing else', () => {
    expect(permissionsFor(member(null, EventRole.DESIGNER))).toEqual(['event:read', 'invitation:design', 'invitation:read']);
  });

  it('keeps an event viewer read-only, with no vendor:write', () => {
    expect(permissionsFor(member(null, EventRole.VIEWER))).toEqual(sorted(READ_ONLY));
  });
});

describe('what a concierge operator holds', () => {
  it('runs events and keeps the directory, concierge, enquiries and template authoring, with no deletion, billing or privacy', () => {
    expect(permissionsFor(staff(PlatformRole.SUPPORT))).toEqual(
      sorted([...RUN_EVENT, 'directory:manage', 'concierge:manage', 'enquiry:manage', 'template:author']),
    );
  });
});
