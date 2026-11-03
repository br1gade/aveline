import {
  EVENT_ROLES,
  type EventRole,
  type InviteSent,
  type InviteSentWire,
  type Team,
  type TeamWire,
} from './types';

/**
 * Where the team's answers arrive. Every object is built by naming its fields, so `devLink`, which
 * holds the invite's token outside production, and anything else go no further.
 */

export function roleOf(value: string): EventRole | null {
  return EVENT_ROLES.find((role) => role === value) ?? null;
}

export function readTeam(team: TeamWire): Team {
  return {
    members: team.members.map((member) => ({
      userId: member.userId,
      name: member.name,
      email: member.email,
      role: roleOf(member.role),
      since: member.since,
    })),
    invites: team.invites.map((invite) => ({
      email: invite.email,
      role: roleOf(invite.role),
      expiresAt: invite.expiresAt,
    })),
  };
}

export function readInviteSent(sent: InviteSentWire): InviteSent {
  return { email: sent.email, role: roleOf(sent.role) };
}
