import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MessageChannel, PlatformRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * The concierge: Aveline staff set an event up for a customer on the phone,
 * then hand it over. Decided 9 October 2026: staff build it and invite the
 * customer as owner — the customer sets their own password, and staff never
 * hold a credential.
 */
describe('Setting an event up for a customer (e2e)', () => {
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

  beforeEach(async () => {
    await resetTestDatabase();
    await prisma.designTemplate.create({
      data: { key: 'classic', name: 'Classic', allowedFonts: ['Inter'], supportedBlocks: ['HERO', 'RSVP'] },
    });
    await prisma.messageTemplate.create({
      data: {
        organizationId: null,
        key: 'organization.invite',
        channel: MessageChannel.EMAIL,
        subject: { hy: '{{organizationName}}' },
        body: { hy: '{{organizationName}} {{role}} {{link}}' },
      },
    });
  });
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  const staff = async () => {
    const { authorization, userId } = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: userId }, data: { platformRole: PlatformRole.SUPPORT } });
    return { authorization, userId };
  };

  const tokenFrom = (body: unknown) =>
    new URL((body as { invite: { devLink?: string } }).invite.devLink ?? '').searchParams.get('token') ?? '';

  /** Staff open the customer's organization and their event. */
  const setUp = async () => {
    const concierge = await staff();
    const opened = await http()
      .post('/api/v1/concierge/organizations')
      .set('Authorization', concierge.authorization)
      .send({ name: 'Petrosyan Wedding', ownerEmail: 'anna@example.am' })
      .expect(201);
    const event = await http()
      .post(`/api/v1/concierge/organizations/${opened.body.organization.id}/events`)
      .set('Authorization', concierge.authorization)
      .send({ type: 'WEDDING', title: 'Anna & Davit', startsAt: '2027-06-12T15:00:00Z', locales: ['hy', 'en'] })
      .expect(201);
    return { concierge, organizationId: opened.body.organization.id as string, eventId: event.body.id as string, opened };
  };

  it('opens the organization and event without making staff a member of either', async () => {
    const { concierge, organizationId, eventId, opened } = await setUp();

    expect(opened.body.invite).toMatchObject({ email: 'anna@example.am', role: 'OWNER' });
    expect(await prisma.organizationMembership.count({ where: { userId: concierge.userId } })).toBe(0);
    expect(await prisma.eventMembership.count({ where: { userId: concierge.userId } })).toBe(0);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).organizationId).toBe(organizationId);
  });

  it('lets staff design the event they set up', async () => {
    const { concierge, eventId } = await setUp();
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: { invitation: true } });

    await http()
      .patch(`/api/v1/invitations/${event.invitation?.slug}/blocks/HERO`)
      .set('Authorization', concierge.authorization)
      .send({ content: { hy: { title: 'Աննա և Դավիթ' } } })
      .expect(200);
  });

  it('hands the event over: the customer accepts, signs in, and owns it', async () => {
    const { eventId, opened } = await setUp();

    await http()
      .post('/api/v1/invites/accept')
      .send({ token: tokenFrom(opened.body), name: 'Anna', password: 'annas-own-password' })
      .expect(201);
    const login = await http().post('/api/v1/auth/login').send({ email: 'anna@example.am', password: 'annas-own-password' }).expect(201);
    const anna = `Bearer ${login.body.accessToken as string}`;

    const events = await http().get('/api/v1/events').set('Authorization', anna).expect(200);
    expect((events.body as { id: string }[]).map((event) => event.id)).toEqual([eventId]);
    await http().patch(`/api/v1/events/${eventId}`).set('Authorization', anna).send({ title: 'Our wedding' }).expect(200);
  });

  it('finds an organization again by name', async () => {
    const { concierge, organizationId } = await setUp();

    const { body } = await http()
      .get('/api/v1/concierge/organizations')
      .query({ search: 'petrosyan' })
      .set('Authorization', concierge.authorization)
      .expect(200);

    expect(body).toEqual([
      expect.objectContaining({ id: organizationId, name: 'Petrosyan Wedding', owners: [], pendingOwnerInvites: ['anna@example.am'] }),
    ]);
  });

  it('is closed to customers', async () => {
    const { authorization } = await authenticateAs(app, prisma);

    await http()
      .post('/api/v1/concierge/organizations')
      .set('Authorization', authorization)
      .send({ name: 'Mine', ownerEmail: 'me@example.am' })
      .expect(403);
    await http().get('/api/v1/concierge/organizations').set('Authorization', authorization).expect(403);
  });
});
