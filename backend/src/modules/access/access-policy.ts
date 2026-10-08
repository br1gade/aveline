import { EventRole, OrganizationRole, PlatformRole } from '@prisma/client';

/**
 * Authorization is a lookup, not a branch.
 *
 * Every rule below is a row in a table. Adding a role or a permission means
 * editing data, never writing control flow, which keeps this file readable at
 * a glance and keeps its cyclomatic complexity flat as the product grows.
 *
 * Scope note: this module answers "may this kind of actor do this kind of
 * thing". It does NOT answer "is this actor attached to this event" — that is
 * ownership, resolved by the guard that loads the membership. Keeping the two
 * apart is what makes this file a pure function and exhaustively testable.
 */

export const ALL_PERMISSIONS = [
  'event:read',
  'event:write',
  'event:delete',
  'guest:read',
  'guest:contact:read',
  'guest:write',
  'invitation:read',
  'invitation:design',
  'invitation:publish',
  'operations:read',
  'seating:read',
  'seating:write',
  'vendor:read',
  'vendor:fee:read',
  'vendor:write',
  'member:manage',
  'billing:read',
  'billing:write',
  'privacy:manage',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export type Actor =
  | { kind: 'staff'; role: PlatformRole }
  | { kind: 'member'; organizationRole: OrganizationRole | null; eventRole: EventRole | null }
  | { kind: 'vendor'; scopes: string[] }
  | { kind: 'guest' };

const READ_ONLY: readonly Permission[] = [
  'event:read',
  'guest:read',
  'invitation:read',
  'operations:read',
  'seating:read',
  'vendor:read',
];

/** Everything needed to run an event, short of owning the organization. */
const RUN_EVENT: readonly Permission[] = [
  ...READ_ONLY,
  'guest:contact:read',
  'guest:write',
  'invitation:design',
  'invitation:publish',
  'event:write',
  'seating:write',
  'vendor:write',
  'vendor:fee:read',
];

const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, readonly Permission[]> = {
  // Customer accounts hold no permission by platform role; theirs comes from
  // organization and event membership.
  [PlatformRole.NONE]: [],
  // Concierge operators act on a customer's behalf (spec §11) but may not
  // destroy an event or read what the customer is billed.
  [PlatformRole.SUPPORT]: [...RUN_EVENT],
  [PlatformRole.ADMIN]: [...ALL_PERMISSIONS],
};

/**
 * Held by Aveline's own staff and never by a customer.
 *
 * A data-subject request is matched by email across every customer's events,
 * so whoever fulfils one reads or erases data that belongs to other tenants.
 * An organization owner held this once; any self-registered account could
 * then export or erase a stranger's guest records platform-wide (decided
 * 8 October 2026: Aveline staff only).
 */
const PLATFORM_ONLY: readonly Permission[] = ['privacy:manage'];

const CUSTOMER_OWNED = ALL_PERMISSIONS.filter((permission) => !PLATFORM_ONLY.includes(permission));

const ORGANIZATION_ROLE_PERMISSIONS: Record<OrganizationRole, readonly Permission[]> = {
  [OrganizationRole.OWNER]: [...CUSTOMER_OWNED],
  [OrganizationRole.MANAGER]: [...RUN_EVENT],
  [OrganizationRole.MEMBER]: [...READ_ONLY],
  [OrganizationRole.VIEWER]: [...READ_ONLY],
};

const EVENT_ROLE_PERMISSIONS: Record<EventRole, readonly Permission[]> = {
  // Owners decide who else works on the event. Event-scoped like every event
  // role, so it reaches this event's team and nothing in the organization.
  [EventRole.OWNER]: [...RUN_EVENT, 'event:delete', 'member:manage'],
  [EventRole.COORDINATOR]: [...RUN_EVENT],
  // A designer shapes the invitation and nothing else. Guest contact details,
  // operational sheets and vendor fees are deliberately out of reach.
  [EventRole.DESIGNER]: ['event:read', 'invitation:read', 'invitation:design'],
  [EventRole.VIEWER]: [...READ_ONLY],
};

/** The full permission set an actor holds, sorted and de-duplicated. */
export function permissionsFor(actor: Actor): Permission[] {
  const granted = collectPermissions(actor);
  return [...new Set(granted)].sort();
}

export function can(actor: Actor, permission: Permission): boolean {
  return collectPermissions(actor).has(permission);
}

function collectPermissions(actor: Actor): Set<Permission> {
  switch (actor.kind) {
    case 'staff':
      return new Set(PLATFORM_ROLE_PERMISSIONS[actor.role]);
    case 'member':
      return new Set([
        ...(actor.organizationRole ? ORGANIZATION_ROLE_PERMISSIONS[actor.organizationRole] : []),
        ...(actor.eventRole ? EVENT_ROLE_PERMISSIONS[actor.eventRole] : []),
      ]);
    case 'vendor':
      // A vendor sees exactly the briefs their booking lists, nothing more.
      return new Set(actor.scopes.filter(isPermission));
    case 'guest':
      // Guests reach their own invitation through a capability URL, which is
      // checked by token, not by this policy.
      return new Set();
  }
}

function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}
