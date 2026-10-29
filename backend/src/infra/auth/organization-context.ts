import { BadRequestException } from '@nestjs/common';
import { OrganizationRole, PlatformRole, Prisma } from '@prisma/client';
import { DomainHttpException } from '../../common/domain-http.exception';
import { Permission, can } from '../../modules/access/access-policy';

export interface OrganizationContext {
  organizationId: string;
  organizationRole: OrganizationRole | null;
  source: 'header' | 'sole-membership' | 'event' | 'route';
  access: 'membership' | 'event' | 'platform';
}
export interface OrganizationResolution {
  userId: string;
  platformRole: PlatformRole;
  selector?: string;
  eventId?: string;
  routeOrganizationId?: string;
  mode: 'required' | 'event-list' | 'event' | 'platform' | 'optional';
  platformPermission?: Permission;
}
type OrganizationDatabase = Pick<Prisma.TransactionClient, 'organization' | 'organizationMembership' | 'event' | 'eventMembership' | 'organizationInvite'>;

export function validateOrganizationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new BadRequestException('organizationId: must match 1–64 letters, digits, underscores or hyphens');
  }
  return value;
}

export function parseOrganizationSelector(headers: Record<string, unknown>, rawHeaders: string[] = []): string | undefined {
  const occurrences = rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'x-aveline-organization-id').length;
  if (occurrences > 1) throw new BadRequestException('organizationId: repeated selection header');
  const value = headers['x-aveline-organization-id'];
  return value === undefined ? undefined : validateOrganizationId(value);
}

export async function resolveOrganizationContext(tx: OrganizationDatabase, input: OrganizationResolution): Promise<OrganizationContext | null> {
  if (input.eventId) return resolveEventContext(tx, input);
  const selected = input.routeOrganizationId ?? input.selector;
  if (selected) return resolveSelectedContext(tx, input, validateOrganizationId(selected));
  if (input.mode === 'event-list' && input.platformRole !== PlatformRole.NONE) return null;
  const memberships = await tx.organizationMembership.findMany({
    where: { userId: input.userId, organization: { deletedAt: null } },
    select: { organizationId: true, role: true }, take: 2,
  });
  if (memberships.length > 1) throw selectionRequired();
  const membership = memberships[0];
  if (membership) return { organizationId: membership.organizationId, organizationRole: membership.role, source: 'sole-membership', access: 'membership' };
  if (['event-list', 'optional'].includes(input.mode)) return null;
  if (input.platformRole !== PlatformRole.NONE) throw selectionRequired();
  throw accessDenied();
}

async function resolveSelectedContext(tx: OrganizationDatabase, input: OrganizationResolution, organizationId: string): Promise<OrganizationContext> {
  assertPlatformSelectionAllowed(input);
  const membership = await tx.organizationMembership.findUnique({
    where: { userId_organizationId: { userId: input.userId, organizationId } }, select: { role: true, organization: { select: { deletedAt: true } } },
  });
  const source = input.routeOrganizationId ? 'route' : 'header';
  if (membership && membership.organization?.deletedAt == null) {
    assertSelectionMatchesRoute(input);
    return { organizationId, organizationRole: membership.role, source, access: 'membership' };
  }
  const hasPlatformPermission = canTargetOrganization(input);
  if (!hasPlatformPermission) throw accessDenied();
  const organization = await tx.organization.findFirst({ where: { id: organizationId, deletedAt: null }, select: { id: true } });
  if (!organization) throw accessDenied();
  assertSelectionMatchesRoute(input);
  return { organizationId, organizationRole: null, source, access: 'platform' };
}

async function resolveEventContext(tx: OrganizationDatabase, input: OrganizationResolution): Promise<OrganizationContext | null> {
  const event = await tx.event.findUnique({ where: { id: input.eventId }, select: { organizationId: true, organization: { select: { deletedAt: true } } } });
  if (!event) return null;
  assertEventOrganizationOpen(event.organization);
  const [membership, direct] = await Promise.all([
    tx.organizationMembership.findUnique({ where: { userId_organizationId: { userId: input.userId, organizationId: event.organizationId } }, select: { role: true } }),
    tx.eventMembership.findUnique({ where: { userId_eventId: { userId: input.userId, eventId: input.eventId! } }, select: { role: true } }),
  ]);
  assertEventSelection(input, event.organizationId, Boolean(membership || direct));
  return { organizationId: event.organizationId, organizationRole: membership?.role ?? null, source: 'event', access: contextAccess(Boolean(membership), Boolean(direct)) };
}

export async function resolveCustomerOrganizations(tx: OrganizationDatabase, input: { ownerEmail: string; selectedOrganizationId?: string }) {
  const email = input.ownerEmail.trim().toLowerCase();
  const organizations = await tx.organization.findMany({
    where: { deletedAt: null, OR: [
      { memberships: { some: { user: { email: { equals: email, mode: 'insensitive' }, isActive: true } } } },
      { invites: { some: { email, role: 'OWNER', acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } } },
    ] }, select: { id: true }, take: 2,
  });
  if (input.selectedOrganizationId) {
    const selected = validateOrganizationId(input.selectedOrganizationId);
    const match = await tx.organization.findFirst({ where: { id: selected, deletedAt: null, OR: [
      { memberships: { some: { user: { email: { equals: email, mode: 'insensitive' }, isActive: true } } } },
      { invites: { some: { email, role: 'OWNER', acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } } },
    ] }, select: { id: true } });
    if (!match) throw accessDenied();
    return { kind: 'one' as const, organizationId: match.id };
  }
  if (organizations.length > 1) return { kind: 'selection-required' as const };
  return organizations[0] ? { kind: 'one' as const, organizationId: organizations[0].id } : { kind: 'none' as const };
}

export function selectionRequired() { return new DomainHttpException('ORGANIZATION_SELECTION_REQUIRED', 'organizationId: select an organization for this action'); }
export function contextMismatch() { return new DomainHttpException('ORGANIZATION_CONTEXT_MISMATCH', 'organizationId: selection does not match this resource'); }
export function accessDenied() { return new DomainHttpException('ORGANIZATION_ACCESS_DENIED', 'organizationId: access is unavailable'); }

function assertSelectionMatchesRoute(input: OrganizationResolution): void {
  if (input.selector && input.routeOrganizationId && input.selector !== input.routeOrganizationId) throw contextMismatch();
}
function canTargetOrganization(input: OrganizationResolution): boolean {
  return input.platformRole !== PlatformRole.NONE && can({ kind: 'staff', role: input.platformRole }, input.platformPermission ?? 'member:manage');
}
function assertEventOrganizationOpen(organization: { deletedAt: Date | null } | undefined): void {
  if (organization?.deletedAt) throw accessDenied();
}
function assertEventSelection(input: OrganizationResolution, organizationId: string, hasMembership: boolean): void {
  if ((hasMembership || input.platformRole !== PlatformRole.NONE) && input.selector && input.selector !== organizationId) throw contextMismatch();
}
function contextAccess(hasMembership: boolean, hasEvent: boolean): OrganizationContext['access'] {
  if (hasMembership) return 'membership';
  return hasEvent ? 'event' : 'platform';
}

function assertPlatformSelectionAllowed(input: OrganizationResolution): void {
  if (input.mode === 'platform' && !canTargetOrganization(input)) throw accessDenied();
}
