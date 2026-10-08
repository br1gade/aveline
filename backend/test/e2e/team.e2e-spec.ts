import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, MessageChannel, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Bringing people onto one event: a coordinator for the day, a designer for
 * the invitation, someone on the door. Nothing could grant an event role
 * before — door staff needed organization MANAGER, which also showed them
 * every vendor fee. Walked over HTTP from the invitation to working access.
 */
describe('An event’s team (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  const owner = async () => {
    const seeded = await seedEvent(prisma);
    const event = await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } });
    const { authorization, userId } = await authenticateAs(app, prisma, { eventId: seeded.eventId, role: EventRole.OWNER });
    await prisma.messageTemplate.create({
      data: {
        organizationId: null,
        key: 'event.invite',
        channel: MessageChannel.EMAIL,
        subject: { hy: '{{eventTitle}}' },
        body: { hy: '{{role}} {{eventTitle}} {{link}}' },
      },
    });
    return { ...seeded, authorization, userId, organizationId: event.organizationId };
  };

  const invite = (eventId: string, authorization: string, email: string, role: EventRole) =>
    http().post(`/api/v1/events/${eventId}/team/invites`).set('Authorization', authorization).send({ email, role });

  const tokenFrom = (body: unknown) =>
    new URL((body as { devLink?: string }).devLink ?? '').searchParams.get('token') ?? '';

  const signIn = async (email: string, password: string) => {
    const { body } = await http().post('/api/v1/auth/login').send({ email, password }).expect(201);
    return `Bearer ${body.accessToken as string}`;
  };

  /** Invites someone new, has them accept, and signs them in. */
  const joined = async (role: EventRole = EventRole.COORDINATOR) => {
    const host = await owner();
    const invited = await invite(host.eventId, host.authorization, 'door@test.local', role).expect(201);
    await http()
      .post('/api/v1/event-invites/accept')
      .send({ token: tokenFrom(invited.body), name: 'Door Staff', password: 'a-long-enough-password' })
      .expect(201);
    const member = await prisma.user.findUniqueOrThrow({ where: { email: 'door@test.local' } });
    return { ...host, memberId: member.id, memberAuth: await signIn('door@test.local', 'a-long-enough-password') };
  };

  it('invites someone new, who joins this event and sees nothing else', async () => {
    const { eventId, memberAuth, organizationId } = await joined();
    const elsewhere = await seedEvent(prisma);

    const events = await http().get('/api/v1/events').set('Authorization', memberAuth).expect(200);
    expect((events.body as { id: string }[]).map((event) => event.id)).toEqual([eventId]);
    await http().get(`/api/v1/events/${eventId}/guests`).set('Authorization', memberAuth).expect(200);
    await http().get(`/api/v1/events/${elsewhere.eventId}/guests`).set('Authorization', memberAuth).expect(403);
    // An event role grants nothing in the organization.
    expect(await prisma.organizationMembership.count({ where: { organizationId } })).toBe(0);
  });

  it('lists the team and the invitations still open', async () => {
    const { eventId, authorization } = await joined();
    await invite(eventId, authorization, 'designer@test.local', EventRole.DESIGNER).expect(201);

    const { body } = await http().get(`/api/v1/events/${eventId}/team`).set('Authorization', authorization).expect(200);

    expect(body.members).toEqual(
      expect.arrayContaining([expect.objectContaining({ email: 'door@test.local', name: 'Door Staff', role: 'COORDINATOR' })]),
    );
    expect(body.invites).toEqual([expect.objectContaining({ email: 'designer@test.local', role: 'DESIGNER' })]);
  });

  it('changes a role, and it applies on the next request', async () => {
    const { eventId, authorization, memberId, memberAuth } = await joined();
    await http()
      .patch(`/api/v1/events/${eventId}/team/${memberId}`)
      .set('Authorization', authorization)
      .send({ role: 'VIEWER' })
      .expect(200);

    await http()
      .post(`/api/v1/events/${eventId}/guests`)
      .set('Authorization', memberAuth)
      .send({ firstName: 'Ani' })
      .expect(403);
  });

  it('removes someone, and they lose access at once', async () => {
    const { eventId, authorization, memberId, memberAuth } = await joined();

    await http().delete(`/api/v1/events/${eventId}/team/${memberId}`).set('Authorization', authorization).expect(200);

    await http().get(`/api/v1/events/${eventId}`).set('Authorization', memberAuth).expect(403);
  });

  it('never leaves an event without an owner', async () => {
    const { eventId, authorization, userId } = await owner();

    const demoted = await http()
      .patch(`/api/v1/events/${eventId}/team/${userId}`)
      .set('Authorization', authorization)
      .send({ role: 'VIEWER' })
      .expect(400);
    await http().delete(`/api/v1/events/${eventId}/team/${userId}`).set('Authorization', authorization).expect(400);

    expect(demoted.body.message).toMatch(/owner/i);
  });

  it('needs the existing account’s own password to accept for it', async () => {
    const { eventId, authorization } = await owner();
    await http()
      .post('/api/v1/auth/register')
      .send({ email: 'door@test.local', password: 'the-squatters-password', name: 'Not Them' })
      .expect(201);
    const invited = await invite(eventId, authorization, 'door@test.local', EventRole.COORDINATOR).expect(201);

    await http()
      .post('/api/v1/event-invites/accept')
      .send({ token: tokenFrom(invited.body), name: 'Door Staff', password: 'a-long-enough-password' })
      .expect(409);
    expect(await prisma.eventMembership.count({ where: { eventId, user: { email: 'door@test.local' } } })).toBe(0);
  });

  it('refuses a withdrawn invitation', async () => {
    const { eventId, authorization } = await owner();
    const invited = await invite(eventId, authorization, 'door@test.local', EventRole.COORDINATOR).expect(201);

    await http()
      .delete(`/api/v1/events/${eventId}/team/invites/door@test.local`)
      .set('Authorization', authorization)
      .expect(200);

    await http()
      .post('/api/v1/event-invites/accept')
      .send({ token: tokenFrom(invited.body), name: 'Door Staff', password: 'a-long-enough-password' })
      .expect(400);
  });

  it('refuses to invite someone already on the team', async () => {
    const { eventId, authorization } = await joined();

    await invite(eventId, authorization, 'door@test.local', EventRole.VIEWER).expect(400);
  });

  // Running an event is not the same as deciding who else may.
  it('refuses a coordinator who tries to invite', async () => {
    const { eventId, memberAuth } = await joined();

    await invite(eventId, memberAuth, 'friend@test.local', EventRole.OWNER).expect(403);
  });
});
