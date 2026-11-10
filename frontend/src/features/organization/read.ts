import {
  ORGANIZATION_ROLES,
  type ClosureReview,
  type CurrentOrganization,
  type CurrentWire,
  type InviteWire,
  type MemberWire,
  type OrganizationInvite,
  type OrganizationMember,
  type OrganizationRole,
} from './types';

/**
 * Where the answers arrive. Every object is built by naming its fields, so a development link, which
 * holds the invitation's token outside production, and anything else go no further.
 */
export function roleOf(value: string): OrganizationRole | null {
  return ORGANIZATION_ROLES.find((role) => role === value) ?? null;
}

export function readMember(wire: MemberWire): OrganizationMember {
  const { userId, name, role, joinedAt, isActive, isCurrentUser } = wire;
  return { userId, name, role: roleOf(role), joinedAt, isActive, isCurrentUser };
}

export function readInvite({ email, role, expiresAt }: InviteWire): OrganizationInvite {
  return { email, role: roleOf(role), expiresAt };
}

const OUTCOMES: Readonly<Record<string, ClosureReview['state']>> = {
  OPEN: 'waiting',
  DECLINE: 'declined',
  HANDOVER: 'handedOver',
};

/** Typed as never null, but documented as null until one is asked (FR-145). */
function readClosureReview(wire: CurrentWire['closureReview'] | null): ClosureReview | null {
  if (!wire) return null;
  const state = Object.hasOwn(OUTCOMES, wire.status) ? OUTCOMES[wire.status] : undefined;
  return { state: state ?? 'answered', resolvedAt: wire.resolvedAt };
}

export function readCurrent({
  name,
  accessRevision,
  closureReview,
}: CurrentWire): CurrentOrganization {
  return { name, accessRevision, closureReview: readClosureReview(closureReview) };
}
