import { OrganizationRole, Prisma } from '@prisma/client';

export enum ConciergeRelationship {
  OWNER = 'OWNER',
  PENDING_OWNER_INVITE = 'PENDING_OWNER_INVITE',
}

export const CONCIERGE_ORGANIZATION = { id: true, name: true, kind: true, createdAt: true } satisfies Prisma.OrganizationSelect;

export function liveOwnerInvites(now = new Date()) {
  return { role: OrganizationRole.OWNER, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } };
}

export function conciergeRelationshipQuery(email: string, now = new Date()) {
  const owner = {
    role: OrganizationRole.OWNER,
    user: { email: { equals: email, mode: Prisma.QueryMode.insensitive }, isActive: true },
  };
  const invite = { email, ...liveOwnerInvites(now) };
  return {
    where: { deletedAt: null, OR: [{ memberships: { some: owner } }, { invites: { some: invite } }] },
    select: { ...CONCIERGE_ORGANIZATION, memberships: { where: owner, select: { userId: true }, take: 1 } },
  };
}

type ConciergeMatch = Prisma.OrganizationGetPayload<{ select: ReturnType<typeof conciergeRelationshipQuery>['select'] }>;

export function describeConciergeMatch({ memberships, ...organization }: ConciergeMatch) {
  return { ...organization, relationship: memberships.length ? ConciergeRelationship.OWNER : ConciergeRelationship.PENDING_OWNER_INVITE };
}
