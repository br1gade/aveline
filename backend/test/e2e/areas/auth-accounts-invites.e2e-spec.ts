import { INestApplication } from '@nestjs/common';
import { EventRole, PrismaClient } from '@prisma/client';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { accountsApp, http as httpOf, memberOf, seedInviteTemplates, tokenFrom } from '../../fixtures/areas/auth-accounts.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * Joining an organization or one event's team by emailed link
 * (docs/API.md "Joining an organization" and "The event's team").
 */
describe('Organization and event invitations (e2e coverage)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => httpOf(app);
  const password = 'a-long-enough-password';

  beforeAll(async () => {
    prisma = testPrisma();
    app = await accountsApp(prisma);
  });
  beforeEach(async () => {
    await resetTestDatabase();
    await seedInviteTemplates(prisma);
  });
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  describe('organization invitations', () => {
    const asOwner = async () => {
      const organization = await prisma.organization.create({ data: { name: 'Acme Events' } });
      const owner = await memberOf(app, prisma, organization.id, 'OWNER');
      return { ...owner, organization };
    };
    const inviteMember = (authorization: string, email: string) =>
      http().post('/api/v1/organization/invites').set('Authorization', authorization).send({ email, role: 'MEMBER' });

    it('answers 404 when withdrawing an address with nothing pending', async () => {
      const { authorization } = await asOwner();

      await http().delete('/api/v1/organization/invites/nobody@test.local').set('Authorization', authorization).expect(404);
    });

    it('answers 404 when withdrawing an invitation that was already accepted', async () => {
      const { authorization } = await asOwner();
      const invited = await inviteMember(authorization, 'new@test.local').expect(201);
      await http().post('/api/v1/invites/accept').send({ token: tokenFrom(invited.body), name: 'New', password }).expect(201);

      await http().delete('/api/v1/organization/invites/new@test.local').set('Authorization', authorization).expect(404);
      expect(await prisma.organizationMembership.count({ where: { user: { email: 'new@test.local' } } })).toBe(1);
    });

    it.each(['VIEWER', 'MEMBER', 'MANAGER'] as const)('refuses a %s listing or withdrawing invitations', async (role) => {
      const { authorization, organization } = await asOwner();
      await inviteMember(authorization, 'new@test.local').expect(201);
      const member = await memberOf(app, prisma, organization.id, role);

      await http().get('/api/v1/organization/invites').set('Authorization', member.authorization).expect(403);
      await http().delete('/api/v1/organization/invites/new@test.local').set('Authorization', member.authorization).expect(403);

      expect((await prisma.organizationInvite.findFirstOrThrow()).revokedAt).toBeNull();
    });

    it('lists a pending invitation without its token or token hash', async () => {
      const { authorization } = await asOwner();
      const invited = await inviteMember(authorization, 'new@test.local').expect(201);
      const stored = await prisma.organizationInvite.findFirstOrThrow();

      const { body } = await http().get('/api/v1/organization/invites').set('Authorization', authorization).expect(200);

      expect(Object.keys((body as object[])[0]).sort()).toEqual(['createdAt', 'email', 'expiresAt', 'role']);
      expect(JSON.stringify(body)).not.toContain(tokenFrom(invited.body));
      expect(JSON.stringify(body)).not.toContain(stored.tokenHash);
    });

    it('refuses an expired invitation and creates neither the account nor the membership', async () => {
      const { authorization, organization } = await asOwner();
      const invited = await inviteMember(authorization, 'new@test.local').expect(201);
      await prisma.organizationInvite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

      const response = await http()
        .post('/api/v1/invites/accept')
        .send({ token: tokenFrom(invited.body), name: 'New', password })
        .expect(400);

      expect(response.body.message).toBe('This invitation is no longer valid');
      expect(await prisma.user.count({ where: { email: 'new@test.local' } })).toBe(0);
      expect(await prisma.organizationMembership.count({ where: { organizationId: organization.id } })).toBe(1);
    });
  });

  describe('event invitations', () => {
    const asEventOwner = async () => {
      const seeded = await seedEvent(prisma);
      const owner = await authenticateAs(app, prisma, { eventId: seeded.eventId, role: EventRole.OWNER });
      return { ...seeded, ...owner };
    };
    const inviteToEvent = (eventId: string, authorization: string, role: EventRole, email = 'door@test.local') =>
      http().post(`/api/v1/events/${eventId}/team/invites`).set('Authorization', authorization).send({ email, role });
    const accept = (token: string, withPassword = password) =>
      http().post('/api/v1/event-invites/accept').send({ token, name: 'Door Staff', password: withPassword });
    const doorMemberships = (eventId: string) =>
      prisma.eventMembership.count({ where: { eventId, user: { email: 'door@test.local' } } });

    it('attaches the role to an existing account that gives its own password', async () => {
      const { eventId, authorization } = await asEventOwner();
      await http().post('/api/v1/auth/register').send({ email: 'door@test.local', password, name: 'Door' }).expect(202);
      const usersBefore = await prisma.user.count();
      const invited = await inviteToEvent(eventId, authorization, EventRole.COORDINATOR).expect(201);

      const { body } = await accept(tokenFrom(invited.body)).expect(201);

      expect(body).toEqual({ ok: true, eventId, role: 'COORDINATOR', accountCreated: false });
      expect(await doorMemberships(eventId)).toBe(1);
      expect(await prisma.user.count()).toBe(usersBefore);
    });

    it('lets the existing account sign in with its unchanged password after accepting', async () => {
      const { eventId, authorization } = await asEventOwner();
      await http().post('/api/v1/auth/register').send({ email: 'door@test.local', password, name: 'Door' }).expect(202);
      const invited = await inviteToEvent(eventId, authorization, EventRole.COORDINATOR).expect(201);
      await accept(tokenFrom(invited.body)).expect(201);

      const { body } = await http().post('/api/v1/auth/login').send({ email: 'door@test.local', password }).expect(201);

      await http().get(`/api/v1/events/${eventId}/guests`).set('Authorization', `Bearer ${body.accessToken as string}`).expect(200);
    });

    it('replaces the earlier link when the address is invited again', async () => {
      const { eventId, authorization } = await asEventOwner();
      const first = await inviteToEvent(eventId, authorization, EventRole.VIEWER).expect(201);
      const second = await inviteToEvent(eventId, authorization, EventRole.COORDINATOR).expect(201);

      expect(await prisma.eventInvite.count({ where: { eventId } })).toBe(1);
      expect((await accept(tokenFrom(first.body)).expect(400)).body.message).toBe('This invitation is no longer valid');
      const { body } = await accept(tokenFrom(second.body)).expect(201);

      expect(body).toEqual({ ok: true, eventId, role: 'COORDINATOR', accountCreated: true });
    });

    it('answers 404 when withdrawing an address with nothing pending', async () => {
      const { eventId, authorization } = await asEventOwner();

      await http().delete(`/api/v1/events/${eventId}/team/invites/nobody@test.local`).set('Authorization', authorization).expect(404);
    });

    it('withdraws case-insensitively', async () => {
      const { eventId, authorization } = await asEventOwner();
      await inviteToEvent(eventId, authorization, EventRole.COORDINATOR).expect(201);

      await http().delete(`/api/v1/events/${eventId}/team/invites/DOOR@Test.Local`).set('Authorization', authorization).expect(200);

      expect((await prisma.eventInvite.findFirstOrThrow()).revokedAt).not.toBeNull();
    });

    it('refuses an expired event invitation and creates neither account nor role', async () => {
      const { eventId, authorization } = await asEventOwner();
      const invited = await inviteToEvent(eventId, authorization, EventRole.COORDINATOR).expect(201);
      await prisma.eventInvite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

      const response = await accept(tokenFrom(invited.body)).expect(400);

      expect(response.body.message).toBe('This invitation is no longer valid');
      expect(await prisma.user.count({ where: { email: 'door@test.local' } })).toBe(0);
      expect(await doorMemberships(eventId)).toBe(0);
    });

    it('makes one account and one role when the same invitation is accepted twice at once', async () => {
      const { eventId, authorization } = await asEventOwner();
      const invited = await inviteToEvent(eventId, authorization, EventRole.COORDINATOR).expect(201);
      const token = tokenFrom(invited.body);

      const statuses = (await Promise.all([accept(token), accept(token)])).map((response) => response.status);

      expect(statuses).toContain(201);
      expect(statuses.every((status) => status === 201 || status === 400)).toBe(true);
      expect(await doorMemberships(eventId)).toBe(1);
      expect(await prisma.user.count({ where: { email: 'door@test.local' } })).toBe(1);
    });

    it('lets a withdrawal and an acceptance arriving together settle one way only', async () => {
      const { eventId, authorization } = await asEventOwner();
      const invited = await inviteToEvent(eventId, authorization, EventRole.COORDINATOR).expect(201);

      const [accepted, withdrawn] = await Promise.all([
        accept(tokenFrom(invited.body)),
        http().delete(`/api/v1/events/${eventId}/team/invites/door@test.local`).set('Authorization', authorization),
      ]);

      const invite = await prisma.eventInvite.findFirstOrThrow({ where: { eventId } });
      expect(invite.acceptedAt !== null && invite.revokedAt !== null).toBe(false);
      expect(await doorMemberships(eventId)).toBe(accepted.status === 201 ? 1 : 0);
      expect(accepted.status).toBe(invite.acceptedAt ? 201 : 400);
      expect(withdrawn.status).toBe(invite.revokedAt ? 200 : 404);
    });
  });
});
