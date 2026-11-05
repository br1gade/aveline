import {
  ORGANIZATION_ROLES,
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

export function readMember({ userId, name, role, joinedAt }: MemberWire): OrganizationMember {
  return { userId, name, role: roleOf(role), joinedAt };
}

export function readInvite({ email, role, expiresAt }: InviteWire): OrganizationInvite {
  return { email, role: roleOf(role), expiresAt };
}
