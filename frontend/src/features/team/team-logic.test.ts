import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '@/api/errors';

import { readInviteSent, readTeam } from './read';
import { refusalOf, SENTENCES } from './refusals';
import { inviteSchema } from './schemas';
import type { InviteSentWire, TeamWire } from './types';
import { ADDRESSES_NOBODY_TAKES, ADDRESSES_THE_BACKEND_TAKES } from '../../../test/emails';

const refused = (status: number, message: string) =>
  new ApiError({ status, messages: [message], requestId: `r-${status}` });

describe('the team, as read', () => {
  const wire: TeamWire = {
    members: [
      {
        userId: 'u1',
        name: 'Anna',
        email: 'anna@example.am',
        role: 'OWNER',
        since: '2027-01-01T10:00:00.000Z',
      },
    ],
    invites: [
      {
        email: 'door@example.am',
        role: 'COORDINATOR',
        expiresAt: '2027-02-01T10:00:00.000Z',
        createdAt: '2027-01-02T10:00:00.000Z',
      },
    ],
  };

  it('keeps each member and open invitation', () => {
    expect(readTeam(wire)).toEqual({
      members: [
        {
          userId: 'u1',
          name: 'Anna',
          email: 'anna@example.am',
          role: 'OWNER',
          since: '2027-01-01T10:00:00.000Z',
        },
      ],
      invites: [
        { email: 'door@example.am', role: 'COORDINATOR', expiresAt: '2027-02-01T10:00:00.000Z' },
      ],
    });
  });

  it('reads a role it does not know as not known, never as another', () => {
    const member = { ...wire.members[0], role: 'BOUNCER' } as TeamWire['members'][number];
    const invite = { ...wire.invites[0], role: 'BOUNCER' } as TeamWire['invites'][number];
    const team = readTeam({ members: [member], invites: [invite] });
    expect(team.members[0]?.role).toBeNull();
    expect(team.invites[0]?.role).toBeNull();
  });

  it('drops anything else, a token included', () => {
    const token = crypto.randomUUID();
    const leaky = {
      members: [{ ...wire.members[0], token }],
      invites: [{ ...wire.invites[0], token, tokenHash: token }],
      token,
    } as unknown as TeamWire;
    expect(JSON.stringify(readTeam(leaky))).not.toContain(token);
  });
});

describe('an invitation sent', () => {
  it('never keeps the development link (frontend/CLAUDE.md §4)', () => {
    const token = crypto.randomUUID();
    const wire = {
      sent: true,
      email: 'door@example.am',
      role: 'COORDINATOR',
      devLink: `http://localhost:5173/accept-event-invite?token=${token}`,
    } as InviteSentWire;
    const read = readInviteSent(wire);
    expect(read).toEqual({ email: 'door@example.am', role: 'COORDINATOR' });
    expect(JSON.stringify(read)).not.toContain(token);
  });
});

describe('the invite form’s checks', () => {
  it.each(['OWNER', 'COORDINATOR', 'DESIGNER', 'VIEWER'])('takes the role %s', (role) => {
    const parsed = inviteSchema.safeParse({ email: ' door@example.am ', role });
    expect(parsed.success && parsed.data).toEqual({ email: 'door@example.am', role });
  });

  it.each([
    ['', 'required'],
    ['not an address', 'email'],
    [`${'a'.repeat(200)}@example.am`, 'tooLong'],
  ])('refuses the address “%s” with %s', (email, code) => {
    const parsed = inviteSchema.safeParse({ email, role: 'VIEWER' });
    expect(parsed.error?.issues[0]?.message).toBe(code);
  });

  it('takes an address of exactly 200 characters, and refuses 201', () => {
    const address = (length: number) => `${'a'.repeat(length - '@example.am'.length)}@example.am`;
    expect(inviteSchema.safeParse({ email: address(200), role: 'VIEWER' }).success).toBe(true);
    expect(
      inviteSchema.safeParse({ email: address(201), role: 'VIEWER' }).error?.issues[0],
    ).toMatchObject({ message: 'tooLong' });
  });

  it('refuses a role that is not one', () => {
    expect(inviteSchema.safeParse({ email: 'a@example.am', role: 'BOUNCER' }).success).toBe(false);
  });
});

describe('a team action refused', () => {
  it.each([
    ["That person is already on this event's team", 'alreadyOnTeam', true],
    ['An event needs an owner; make someone else an owner first', 'needsOwner', true],
    ['An event needs an active owner; make someone else an owner first', 'needsOwner', true],
    ['Only an active event member may become owner', 'activeOwnerOnly', true],
    ['email must be an email', 'emailRefused', undefined],
  ])('reads a 400 “%s” as %s', (message, kind, isStale) => {
    expect(refusalOf(refused(400, message))).toMatchObject({ kind });
    expect(refusalOf(refused(400, message)).isStale).toBe(isStale);
  });

  it.each([
    ["That person is not on this event's team", 'notOnTeam'],
    ['No pending invitation for that address', 'noPendingInvite'],
  ])('reads a 404 “%s” as %s, and reloads', (message, kind) => {
    expect(refusalOf(refused(404, message))).toMatchObject({ kind, isStale: true });
  });

  it.each([
    [refused(403, 'Forbidden'), 'forbidden'],
    [refused(429, 'Too many'), 'rateLimited'],
    [refused(500, 'Oops'), 'noAnswer'],
    [networkError(), 'noAnswer'],
  ])('reads %s', (error, kind) => {
    expect(refusalOf(error).kind).toBe(kind);
  });

  it('keeps a server failure’s reference', () => {
    expect(refusalOf(refused(500, 'Oops'))).toEqual({ kind: 'noAnswer', requestId: 'r-500' });
  });

  it('shows a sentence it does not know as it came, never as a wrong reason', () => {
    expect(refusalOf(refused(400, 'Something new'))).toEqual({
      kind: 'other',
      sentence: 'Something new',
      requestId: 'r-400',
    });
  });

  it('reads a 404 it does not know as out of date', () => {
    expect(refusalOf(refused(404, 'No event abc'))).toMatchObject({ kind: 'gone', isStale: true });
  });
});

describe('a failure that isn’t the API’s', () => {
  it('is thrown on: a bug must not read as “no answer”', () => {
    expect(() => refusalOf(new TypeError('a bug'))).toThrow('a bug');
  });
});

describe('the backend’s sentences', () => {
  const source = join(process.cwd(), '..', 'backend', 'src');
  const backend = (path: string) => readFileSync(join(source, path), 'utf8');

  it('are still in its sources', () => {
    const sources =
      backend('modules/events/team.service.ts') + backend('infra/auth/account.service.ts');
    for (const [words] of SENTENCES) expect(sources).toContain(words);
  });
});

describe('an address invited to the team', () => {
  it.each(ADDRESSES_THE_BACKEND_TAKES)('leaves %s to the backend', (email) => {
    expect(inviteSchema.safeParse({ email, role: 'COORDINATOR' }).success).toBe(true);
  });

  it.each(ADDRESSES_NOBODY_TAKES)('refuses %s, saying so', (email) => {
    const parsed = inviteSchema.safeParse({ email, role: 'COORDINATOR' });
    expect(parsed.error?.issues[0]?.message).toBe('email');
  });
});
