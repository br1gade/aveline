import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, MessageChannel, MessageStatus, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * The core loop: getting the invitation to the guests.
 *
 * This is the step the market still does by hand — pasting a link into four
 * hundred chats — so the cases that matter are the ones that would embarrass a
 * host: inviting one family three times, pressing send twice, or mailing
 * everyone a link to a page that is not published yet.
 */
describe('Invitation sending (e2e)', () => {
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

  /** An event whose host can publish, with templates the outbox can render. */
  const host = async (options: { isPublished?: boolean } = {}) => {
    const seeded = await seedEvent(prisma, options);
    const event = await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } });
    const { authorization } = await authenticateAs(app, prisma, {
      eventId: seeded.eventId,
      role: EventRole.OWNER,
    });
    // Both templates: a real deployment has these seeded as Aveline defaults,
    // but the test database starts empty.
    for (const key of ['invitation.send', 'rsvp.reminder']) {
      await prisma.messageTemplate.create({
        data: {
          organizationId: event.organizationId,
          key,
          channel: MessageChannel.EMAIL,
          subject: { hy: 'Հրավեր {{hosts}}-ից' },
          body: { hy: 'Հարգելի {{guestName}}, սիրով հրավիրում ենք Ձեզ։ {{link}}' },
        },
      });
    }
    // The fixture guest has no email, which would make its household
    // correctly unreachable and the counts below ambiguous.
    await prisma.guest.updateMany({
      where: { eventId: seeded.eventId },
      data: { email: 'primary@test.local' },
    });
    return { ...seeded, organizationId: event.organizationId, authorization };
  };

  /** A household of three sharing one invitation, plus a single guest. */
  const guestList = async (eventId: string) => {
    const petrosyans = await prisma.household.create({
      data: { eventId, name: 'Petrosyan family', seatsAllotted: 3 },
    });
    const sargsyans = await prisma.household.create({
      data: { eventId, name: 'Sargsyan', seatsAllotted: 1 },
    });

    await prisma.guest.createMany({
      data: [
        { eventId, householdId: petrosyans.id, firstName: 'Armen', lastName: 'Petrosyan', email: 'armen@test.local', isPrimary: true, token: 'tok-armen' },
        { eventId, householdId: petrosyans.id, firstName: 'Lusine', lastName: 'Petrosyan', email: 'lusine@test.local', token: 'tok-lusine' },
        { eventId, householdId: petrosyans.id, firstName: 'Narek', lastName: 'Petrosyan', email: 'narek@test.local', token: 'tok-narek' },
        { eventId, householdId: sargsyans.id, firstName: 'Mariam', lastName: 'Sargsyan', email: 'mariam@test.local', isPrimary: true, token: 'tok-mariam' },
      ],
    });
    return { petrosyans, sargsyans };
  };

  const send = (slug: string, authorization: string, body: Record<string, unknown> = {}) =>
    http().post(`/api/v1/invitations/${slug}/send`).set('Authorization', authorization).send(body);

  describe('sending', () => {
    /**
     * The household rule. Three emails about one invitation means three people
     * answering for the same seats and a host who looks careless.
     */
    it('sends one email per household, to the primary guest', async () => {
      const { slug, eventId, authorization } = await host();
      await guestList(eventId);

      const { body } = await send(slug, authorization).expect(201);

      // Two new households plus the fixture's own.
      expect(body.queued).toBe(3);
      const addresses = (body.recipients as { toAddress: string }[]).map((r) => r.toAddress);
      expect(addresses).toContain('armen@test.local');
      expect(addresses).not.toContain('lusine@test.local');
      expect(addresses).not.toContain('narek@test.local');
    });

    it('queues the mail rather than sending it inside the request', async () => {
      const { slug, eventId, authorization } = await host();
      await guestList(eventId);

      await send(slug, authorization).expect(201);

      const messages = await prisma.message.findMany({ where: { eventId } });
      expect(messages).toHaveLength(3);
      expect(messages.every((message) => message.status === MessageStatus.QUEUED)).toBe(true);
    });

    it('renders the guest’s own link into the body', async () => {
      const { slug, eventId, authorization } = await host();
      await guestList(eventId);

      await send(slug, authorization).expect(201);

      const message = await prisma.message.findFirstOrThrow({
        where: { eventId, toAddress: 'armen@test.local' },
      });
      expect(message.body).toContain(`/invitations/${slug}/g/tok-armen`);
      expect(message.body).toContain('Armen Petrosyan');
      expect(message.subject).toContain('A & B');
    });

    /**
     * A host clicks send, sees nothing happen for a second, and clicks again.
     * That must not invite four hundred people twice.
     */
    it('invites each household only once, however many times send is pressed', async () => {
      const { slug, eventId, authorization } = await host();
      await guestList(eventId);

      const first = await send(slug, authorization).expect(201);
      const second = await send(slug, authorization).expect(201);

      expect(first.body.queued).toBe(3);
      expect(second.body).toMatchObject({ queued: 0, alreadySent: 3 });
      expect(await prisma.message.count({ where: { eventId } })).toBe(3);
    });

    it('invites only the households named when guestIds is given', async () => {
      const { slug, eventId, authorization } = await host();
      await guestList(eventId);
      const narek = await prisma.guest.findFirstOrThrow({ where: { firstName: 'Narek' } });

      const { body } = await send(slug, authorization, { guestIds: [narek.id] }).expect(201);

      // Named a non-primary guest; the household's primary still receives it.
      expect(body.queued).toBe(1);
      expect(body.recipients[0].toAddress).toBe('armen@test.local');
    });

    it('rejects an unknown guest id rather than silently sending nothing', async () => {
      const { slug, authorization } = await host();

      await send(slug, authorization, { guestIds: ['does-not-exist'] }).expect(400);
    });
  });

  describe('what it refuses', () => {
    /**
     * The link resolves to a page that 404s until the invitation is published,
     * and four hundred emails cannot be recalled.
     */
    it('refuses to send a draft, saying why', async () => {
      const { slug, eventId, authorization } = await host({ isPublished: false });
      await guestList(eventId);

      const { body } = await send(slug, authorization).expect(400);

      expect(body.message).toContain('publish');
      expect(await prisma.message.count({ where: { eventId } })).toBe(0);
    });

    it('refuses an event with no guests', async () => {
      const { slug, authorization } = await host();
      await prisma.guest.deleteMany();
      await prisma.household.deleteMany();

      await send(slug, authorization).expect(400);
    });

    // Sending is publishing, so it is not a designer's to press.
    it('refuses a designer', async () => {
      const { slug, eventId } = await host();
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.DESIGNER,
      });

      await send(slug, authorization).expect(403);
    });
  });

  describe('who could not be reached', () => {
    it('reports a household with no address, and still invites the rest', async () => {
      const { slug, eventId, authorization } = await host();
      await guestList(eventId);
      const unreachable = await prisma.household.create({
        data: { eventId, name: 'No Contact', seatsAllotted: 2 },
      });
      await prisma.guest.create({
        data: {
          eventId,
          householdId: unreachable.id,
          firstName: 'Tigran',
          isPrimary: true,
          token: 'tok-tigran',
        },
      });

      const { body } = await send(slug, authorization).expect(201);

      expect(body.queued).toBe(3);
      expect(body.unreachable).toHaveLength(1);
      expect(body.unreachable[0]).toMatchObject({ householdName: 'No Contact' });
      expect(body.unreachable[0].reason).toContain('No email address');
    });

    /**
     * Suppressed is its own list, not an error and not a success: it needs a
     * conversation with the guest, which is a different action from fixing a
     * typo.
     */
    it('reports a suppressed address separately', async () => {
      const { slug, eventId, authorization, organizationId } = await host();
      await guestList(eventId);
      await prisma.suppression.create({
        data: {
          organizationId,
          channel: MessageChannel.EMAIL,
          address: 'armen@test.local',
          reason: 'UNSUBSCRIBED',
        },
      });

      const { body } = await send(slug, authorization).expect(201);

      expect(body.suppressed).toHaveLength(1);
      expect(body.suppressed[0].toAddress).toBe('armen@test.local');
      expect(body.queued).toBe(2);
    });
  });

  describe('delivery status', () => {
    it('reports nothing sent before the first send', async () => {
      const { slug, eventId, authorization } = await host();
      await guestList(eventId);

      const { body } = await http()
        .get(`/api/v1/invitations/${slug}/delivery`)
        .set('Authorization', authorization)
        .expect(200);

      expect(body).toMatchObject({ invited: 0, notSent: 3 });
      expect(body.households[0].status).toBe('NOT_SENT');
    });

    it('reports each household’s outcome after sending', async () => {
      const { slug, eventId, authorization } = await host();
      await guestList(eventId);
      await send(slug, authorization).expect(201);

      const { body } = await http()
        .get(`/api/v1/invitations/${slug}/delivery`)
        .set('Authorization', authorization)
        .expect(200);

      expect(body).toMatchObject({ invited: 3, notSent: 0 });
      const petrosyans = (body.households as { household: string; status: string }[]).find(
        (row) => row.household === 'Petrosyan family',
      );
      expect(petrosyans?.status).toBe('QUEUED');
    });

    // The question a host asks on the day: who never got it, and why.
    it('surfaces a failure reason against the household', async () => {
      const { slug, eventId, authorization } = await host();
      await guestList(eventId);
      await send(slug, authorization).expect(201);
      await prisma.message.updateMany({
        where: { eventId, toAddress: 'armen@test.local' },
        data: { status: MessageStatus.BOUNCED, failureReason: '550 no such user' },
      });

      const { body } = await http()
        .get(`/api/v1/invitations/${slug}/delivery`)
        .set('Authorization', authorization)
        .expect(200);

      const petrosyans = (
        body.households as { household: string; status: string; failureReason: string }[]
      ).find((row) => row.household === 'Petrosyan family');
      expect(petrosyans).toMatchObject({
        status: 'BOUNCED',
        failureReason: '550 no such user',
      });
    });
  });

  describe('reminders', () => {
    it('chases the households that have not answered', async () => {
      const { slug, eventId, authorization } = await host();
      await guestList(eventId);
      await send(slug, authorization).expect(201);

      const { body } = await http()
        .post(`/api/v1/invitations/${slug}/remind`)
        .set('Authorization', authorization)
        .expect(201);

      expect(body.queued).toBe(3);
    });

    // Pressing twice must not write to a guest twice.
    it('reminds at most once a day', async () => {
      const { slug, eventId, authorization } = await host();
      await guestList(eventId);
      await send(slug, authorization).expect(201);
      await http()
        .post(`/api/v1/invitations/${slug}/remind`)
        .set('Authorization', authorization)
        .expect(201);

      const { body } = await http()
        .post(`/api/v1/invitations/${slug}/remind`)
        .set('Authorization', authorization)
        .expect(201);

      expect(body).toMatchObject({ queued: 0, alreadyRemindedToday: 3 });
    });

    it('refuses a designer', async () => {
      const { slug, eventId } = await host();
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.DESIGNER,
      });

      await http()
        .post(`/api/v1/invitations/${slug}/remind`)
        .set('Authorization', authorization)
        .expect(403);
    });

    it('lets a host turn the automatic ones off', async () => {
      const { eventId, authorization } = await host();

      const { body } = await http()
        .patch(`/api/v1/events/${eventId}/settings`)
        .set('Authorization', authorization)
        .send({ remindersEnabled: false })
        .expect(200);

      expect(body.remindersEnabled).toBe(false);
    });

    it('rejects a settings payload it does not understand', async () => {
      const { eventId, authorization } = await host();

      await http()
        .patch(`/api/v1/events/${eventId}/settings`)
        .set('Authorization', authorization)
        .send({ remindersEnabled: 'yes please' })
        .expect(400);
    });
  });

});