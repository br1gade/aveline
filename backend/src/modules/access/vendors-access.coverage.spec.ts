import { EventRole, OrganizationRole, PlatformRole } from '@prisma/client';
import { ALL_PERMISSIONS, Actor, Permission, can, permissionsFor } from './access-policy';

/**
 * Each role's whole permission set, pinned against docs/ACCESS_CONTROL.md §2.
 * Sampling a few permissions per role lets a new grant slip in unnoticed;
 * comparing the full set does not.
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
const PLATFORM_ONLY: Permission[] = [
  'concierge:manage',
  'directory:manage',
  'enquiry:assign',
  'enquiry:manage',
  'privacy:manage',
  'template:assign',
  'template:author',
  'template:publish',
];
const sorted = (permissions: readonly Permission[]) => [...new Set(permissions)].sort();

describe('what each organization role holds', () => {
  it('gives an owner every customer-owned permission and nothing reserved for Aveline staff', () => {
    expect(permissionsFor(member(OrganizationRole.OWNER))).toEqual(
      sorted(ALL_PERMISSIONS.filter((permission) => !PLATFORM_ONLY.includes(permission))),
    );
  });

  it('lets a manager run events and nothing more', () => {
    expect(permissionsFor(member(OrganizationRole.MANAGER))).toEqual(sorted(RUN_EVENT));
  });

  it.each(['billing:read', 'billing:write', 'member:manage', 'event:delete'] as Permission[])(
    'withholds %s from a manager',
    (permission) => {
      expect(can(member(OrganizationRole.MANAGER), permission)).toBe(false);
    },
  );

  it.each([OrganizationRole.MEMBER, OrganizationRole.VIEWER])('keeps an organization %s read-only', (role) => {
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

  it('keeps an event viewer read-only', () => {
    expect(permissionsFor(member(null, EventRole.VIEWER))).toEqual(sorted(READ_ONLY));
  });
});

describe('who may manage an event’s vendors', () => {
  it.each([
    { label: 'an organization member', actor: member(OrganizationRole.MEMBER) },
    { label: 'an organization viewer', actor: member(OrganizationRole.VIEWER) },
    { label: 'an event viewer', actor: member(null, EventRole.VIEWER) },
    { label: 'an event designer', actor: member(null, EventRole.DESIGNER) },
  ])('refuses $label vendor:write', ({ actor }) => {
    expect(can(actor, 'vendor:write')).toBe(false);
  });

  it('refuses an event designer the vendor list itself', () => {
    expect(can(member(null, EventRole.DESIGNER), 'vendor:read')).toBe(false);
  });
});

describe('what a concierge operator holds', () => {
  it('runs events and keeps the directory, concierge, enquiries and template authoring', () => {
    expect(permissionsFor(staff(PlatformRole.SUPPORT))).toEqual(
      sorted([...RUN_EVENT, 'directory:manage', 'concierge:manage', 'enquiry:manage', 'template:author']),
    );
  });

  it.each([
    'event:delete',
    'billing:read',
    'billing:write',
    'member:manage',
    'privacy:manage',
    'enquiry:assign',
    'template:publish',
    'template:assign',
  ] as Permission[])('withholds %s', (permission) => {
    expect(can(staff(PlatformRole.SUPPORT), permission)).toBe(false);
  });
});
