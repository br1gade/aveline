import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, EventType, EventVisibility, MessageChannel, OrganizationRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * Correcting, archiving and deleting an event: the boundaries the existing
 * suites left open — clearing fields with null, who may edit or put an event
 * away, which edits offer to tell guests, and when a delete must be an archive.
 */
describe('Event editing, archiving and deleting — coverage (e2e)', () => {
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

  const seedCopy = async (organizationId: string) => {
    const copy = {
      'invitation.send': '{{guestName}} {{link}}',
      'event.details-changed': '{{guestName}} {{note}} {{link}}',
    };
    for (const [key, body] of Object.entries(copy)) {
      await prisma.messageTemplate.create({
        data: { organizationId, key, channel: MessageChannel.EMAIL, subject: { hy: '{{eventTitle}}' }, body: { hy: body } },
      });
    }
  };

  const host = async (options: { isPublished?: boolean; role?: EventRole } = {}) => {
    const seeded = await seedEvent(prisma, { visibility: EventVisibility.UNLISTED, isPublished: options.isPublished });
    if (options.isPublished === false) {
      await prisma.event.update({ where: { id: seeded.eventId }, data: { status: 'DRAFT' } });
    }
    const event = await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } });
    const { authorization, userId } = await authenticateAs(app, prisma, {
      eventId: seeded.eventId,
      role: options.role ?? EventRole.OWNER,
    });
    await seedCopy(event.organizationId);
    await prisma.guest.updateMany({ where: { eventId: seeded.eventId }, data: { email: 'armen@test.local' } });
    return { ...seeded, authorization, userId, organizationId: event.organizationId };
  };

  const edit = (eventId: string, authorization: string, body: Record<string, unknown>) =>
    http().patch(`/api/v1/events/${eventId}`).set('Authorization', authorization).send(body);

  const act = (method: 'post' | 'delete', path: string, authorization: string) =>
    http()[method](`/api/v1${path}`).set('Authorization', authorization);

  const sendInvitations = async (slug: string, authorization: string) => {
    const response = await http().post(`/api/v1/invitations/${slug}/send`).set('Authorization', authorization).send({});
    if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  };

  /** A user who is a member of the event's organization in the given role, and of no event. */
  const organizationMember = async (organizationId: string, role: OrganizationRole) => {
    const member = await authenticateAs(app, prisma);
    await prisma.organizationMembership.create({ data: { userId: member.userId, organizationId, role } });
    return member;
  };

  describe('clearing fields with null', () => {
    it('clears both side labels sent as null and leaves the title alone', async () => {
      const { eventId, authorization } = await host();

      const { body } = await edit(eventId, authorization, { sideALabel: null, sideBLabel: null }).expect(200);

      expect(body).toMatchObject({ sideALabel: null, sideBLabel: null, title: 'Fixture Wedding' });
      expect(await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).toMatchObject({
        sideALabel: null,
        sideBLabel: null,
        title: 'Fixture Wedding',
      });
    });

    it.each(['type', 'hostsLabel', 'startsAt', 'timezone', 'locales', 'defaultLocale'])(
      'refuses %s sent as null with a 400 "<field>: cannot be cleared", and changes nothing',
      async (field) => {
        const { eventId, authorization } = await host();
        const before = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });

        const { body } = await edit(eventId, authorization, { [field]: null }).expect(400);

        expect(body.message).toBe(`${field}: cannot be cleared`);
        const after = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
        expect(after).toMatchObject({
          type: before.type,
          hostsLabel: before.hostsLabel,
          startsAt: before.startsAt,
          timezone: before.timezone,
          locales: before.locales,
          defaultLocale: before.defaultLocale,
        });
      },
    );
  });

  describe('who may correct an event', () => {
    it('refuses an event viewer, and the title stays', async () => {
      const { eventId } = await host();
      const viewer = await authenticateAs(app, prisma, { eventId, role: EventRole.VIEWER });

      await edit(eventId, viewer.authorization, { title: 'Changed by a viewer' }).expect(403);

      expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).title).toBe('Fixture Wedding');
    });

    it('refuses an organization viewer, and the title stays', async () => {
      const { eventId, organizationId } = await host();
      const viewer = await organizationMember(organizationId, OrganizationRole.VIEWER);

      await http().get(`/api/v1/events/${eventId}`).set('Authorization', viewer.authorization).expect(200);
      await edit(eventId, viewer.authorization, { title: 'Changed by a viewer' }).expect(403);

      expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).title).toBe('Fixture Wedding');
    });

    it("refuses the owner of another organization both reading and editing this organization's event", async () => {
      const { eventId } = await host();
      const other = await seedEvent(prisma);
      const otherEvent = await prisma.event.findUniqueOrThrow({ where: { id: other.eventId } });
      const stranger = await organizationMember(otherEvent.organizationId, OrganizationRole.OWNER);

      await http().get(`/api/v1/events/${eventId}`).set('Authorization', stranger.authorization).expect(403);
      await edit(eventId, stranger.authorization, { title: 'Hijacked' }).expect(403);

      expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).title).toBe('Fixture Wedding');
    });
  });

  describe('offering to tell guests after an edit', () => {
    it.each([
      ['the end time', { endsAt: '2099-01-01T00:00:00.000Z' }, 'endsAt'],
      ['the time zone', { timezone: 'Europe/Moscow' }, 'timezone'],
    ])('offers it when %s changes after the invitation went out', async (_label, payload, field) => {
      const { eventId, slug, authorization } = await host();
      await sendInvitations(slug, authorization);

      const { body } = await edit(eventId, authorization, payload).expect(200);

      expect(body.notice).toEqual({ isSuggested: true, changed: [field], householdsInvited: 1 });
    });

    it('counts every household the invitation reached', async () => {
      const { eventId, slug, authorization } = await host();
      const second = await prisma.household.create({ data: { eventId, name: 'Second Household', seatsAllotted: 2 } });
      await prisma.guest.create({
        data: {
          eventId,
          householdId: second.id,
          firstName: 'Second',
          lastName: 'Guest',
          email: 'second@test.local',
          token: randomUUID().replace(/-/g, '').slice(0, 12),
          isPrimary: true,
          rsvp: { create: { status: 'PENDING' } },
        },
      });
      await sendInvitations(slug, authorization);

      const { body } = await edit(eventId, authorization, { startsAt: '2027-07-01T15:00:00.000Z' }).expect(200);

      expect(body.notice).toEqual({ isSuggested: true, changed: ['startsAt'], householdsInvited: 2 });
    });
  });

  describe('archiving', () => {
    /** An event created over HTTP, made public, with a published listing. */
    const listed = async () => {
      const { authorization } = await authenticateAs(app, prisma);
      await http().post('/api/v1/organizations').set('Authorization', authorization).send({ name: 'Yerevan Jazz' }).expect(201);
      const { body: event } = await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send({ type: EventType.OTHER, title: 'Autumn Jazz Night', startsAt: '2027-10-01T18:00:00.000Z' })
        .expect(201);
      const base = `/api/v1/events/${event.id as string}`;
      await http().patch(`${base}/settings`).set('Authorization', authorization).send({ visibility: 'PUBLIC' }).expect(200);
      await http()
        .post(`${base}/ticket-types`)
        .set('Authorization', authorization)
        .send({ name: { en: 'GA' }, priceMinor: '0', quantityTotal: 10 })
        .expect(201);
      const { body: listing } = await http()
        .put(`${base}/listing`)
        .set('Authorization', authorization)
        .send({ headline: { en: 'Jazz' }, categories: ['concert'] })
        .expect(200);
      await http().post(`${base}/listing/publish`).set('Authorization', authorization).send({}).expect(201);
      return { authorization, eventId: event.id as string, slug: listing.slug as string };
    };

    const browse = async () =>
      ((await http().get('/api/v1/public/events').expect(200)).body as { items: { slug: string }[] }).items.map(
        (item) => item.slug,
      );

    it('takes the public listing down', async () => {
      const { authorization, eventId, slug } = await listed();
      expect(await browse()).toContain(slug);

      await act('post', `/events/${eventId}/archive`, authorization).expect(201);

      expect(await browse()).not.toContain(slug);
      expect((await prisma.eventListing.findFirstOrThrow({ where: { eventId } })).publishedAt).toBeNull();
    });

    it('will not publish a draft invitation while the event is archived', async () => {
      const { eventId, slug, authorization } = await host({ isPublished: false });
      await act('post', `/events/${eventId}/archive`, authorization).expect(201);

      const { body } = await act('post', `/invitations/${slug}/publish`, authorization).expect(400);

      expect(JSON.stringify(body.message)).toMatch(/archived/i);
      const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: { invitation: true } });
      expect(event.status).toBe('ARCHIVED');
      expect(event.invitation?.status).toBe('DRAFT');
    });

    it('archives an already-archived event as a no-op, remembering the status from before the first', async () => {
      const { eventId, authorization } = await host();

      const first = await act('post', `/events/${eventId}/archive`, authorization).expect(201);
      const second = await act('post', `/events/${eventId}/archive`, authorization).expect(201);

      expect(first.body.status).toBe('ARCHIVED');
      expect(second.body.status).toBe('ARCHIVED');
      expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).statusBeforeArchive).toBe('PUBLISHED');
      const { body } = await act('post', `/events/${eventId}/unarchive`, authorization).expect(201);
      expect(body.status).toBe('PUBLISHED');
    });

    it('keeps the pre-archive status when two archives arrive at once', async () => {
      const { eventId, authorization } = await host();

      const results = await Promise.all([
        act('post', `/events/${eventId}/archive`, authorization),
        act('post', `/events/${eventId}/archive`, authorization),
      ]);

      expect(results.map((result) => result.status)).toEqual([201, 201]);
      expect(await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).toMatchObject({
        status: 'ARCHIVED',
        statusBeforeArchive: 'PUBLISHED',
      });
    });

    it('refuses to unarchive an event that is not archived, and leaves its status alone', async () => {
      const { eventId, authorization } = await host();

      const { body } = await act('post', `/events/${eventId}/unarchive`, authorization).expect(400);

      expect(body.message).toMatch(/not archived/);
      expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status).toBe('PUBLISHED');
    });

    it('brings an archived draft back as a draft', async () => {
      const { eventId, authorization } = await host({ isPublished: false });
      await act('post', `/events/${eventId}/archive`, authorization).expect(201);
      // Remembered, not the unarchive fallback: a missing status would also come back DRAFT.
      expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).statusBeforeArchive).toBe('DRAFT');

      const { body } = await act('post', `/events/${eventId}/unarchive`, authorization).expect(201);

      expect(body.status).toBe('DRAFT');
      expect(await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).toMatchObject({
        status: 'DRAFT',
        statusBeforeArchive: null,
      });
    });
  });

  describe('deleting', () => {
    it('refuses to delete an archived event that had been published, and says to archive', async () => {
      const { eventId, authorization } = await host();
      await act('post', `/events/${eventId}/archive`, authorization).expect(201);

      const { body } = await act('delete', `/events/${eventId}`, authorization).expect(409);

      expect(body.message).toMatch(/archive/i);
      expect(await prisma.event.findUnique({ where: { id: eventId } })).not.toBeNull();
    });

    it('deletes an archived event that was never published', async () => {
      const { eventId, authorization } = await host({ isPublished: false });
      await act('post', `/events/${eventId}/archive`, authorization).expect(201);

      await act('delete', `/events/${eventId}`, authorization).expect(200);

      expect(await prisma.event.findUnique({ where: { id: eventId } })).toBeNull();
    });

    it('refuses to delete a never-published event that holds a ticket order but no payment', async () => {
      const { eventId, authorization } = await host({ isPublished: false });
      await prisma.ticketOrder.create({
        data: {
          eventId,
          buyerName: 'Buyer',
          buyerEmail: 'buyer@test.local',
          totalMinor: 0n,
          currency: 'AMD',
          status: 'PAID',
          idempotencyKey: randomUUID(),
          accessToken: randomUUID(),
        },
      });

      const { body } = await act('delete', `/events/${eventId}`, authorization).expect(409);

      expect(body.message).toMatch(/Money has moved/);
      expect(await prisma.event.findUnique({ where: { id: eventId } })).not.toBeNull();
    });
  });

  describe('who may archive, unarchive and delete', () => {
    it('refuses a coordinator unarchiving what an owner archived', async () => {
      const { eventId, authorization } = await host();
      const coordinator = await authenticateAs(app, prisma, { eventId, role: EventRole.COORDINATOR });
      await act('post', `/events/${eventId}/archive`, authorization).expect(201);

      await act('post', `/events/${eventId}/unarchive`, coordinator.authorization).expect(403);

      expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status).toBe('ARCHIVED');
    });

    it('lets a viewer list archived events but not archive, unarchive or delete', async () => {
      const { eventId, authorization } = await host({ isPublished: false });
      const viewer = await authenticateAs(app, prisma, { eventId, role: EventRole.VIEWER });

      await act('post', `/events/${eventId}/archive`, viewer.authorization).expect(403);
      await act('post', `/events/${eventId}/archive`, authorization).expect(201);
      const { body } = await http()
        .get('/api/v1/events')
        .query({ archived: 'true' })
        .set('Authorization', viewer.authorization)
        .expect(200);
      await act('post', `/events/${eventId}/unarchive`, viewer.authorization).expect(403);
      await act('delete', `/events/${eventId}`, viewer.authorization).expect(403);

      expect((body as { id: string }[]).map((event) => event.id)).toEqual([eventId]);
      expect(await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).toMatchObject({ status: 'ARCHIVED' });
    });

    it('lets an organization viewer list archived events', async () => {
      const { eventId, authorization, organizationId } = await host();
      const viewer = await organizationMember(organizationId, OrganizationRole.VIEWER);
      await act('post', `/events/${eventId}/archive`, authorization).expect(201);

      const { body } = await http()
        .get('/api/v1/events')
        .query({ archived: 'true' })
        .set('Authorization', viewer.authorization)
        .expect(200);

      expect((body as { id: string }[]).map((event) => event.id)).toEqual([eventId]);
    });
  });
});
