import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, EventVisibility, MessageChannel, PlatformRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { reviseTemplateFixture } from '../../fixtures/template.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * Venues, the venue directory and the running order: who may write them,
 * what a venue write tells the host, when a venue may be removed, and what of
 * the directory a host is allowed to see.
 */
describe('Venues, directory and timeline — coverage (e2e)', () => {
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

  const host = async (role: EventRole = EventRole.OWNER) => {
    const seeded = await seedEvent(prisma, { visibility: EventVisibility.UNLISTED });
    const { authorization } = await authenticateAs(app, prisma, { eventId: seeded.eventId, role });
    const venue = await prisma.venue.findFirstOrThrow({ where: { eventId: seeded.eventId } });
    return { ...seeded, authorization, venueId: venue.id };
  };

  const staff = async () => {
    const { authorization, userId } = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: userId }, data: { platformRole: PlatformRole.SUPPORT } });
    return authorization;
  };

  const venuesPath = (eventId: string) => `/api/v1/events/${eventId}/venues`;

  describe('who may write venues', () => {
    it.each([EventRole.DESIGNER, EventRole.VIEWER])('lets a %s read venues but not add, change or remove one', async (role) => {
      const { eventId, venueId } = await host();
      const { authorization } = await authenticateAs(app, prisma, { eventId, role });
      const before = await prisma.venue.findUniqueOrThrow({ where: { id: venueId } });

      const { body } = await http().get(venuesPath(eventId)).set('Authorization', authorization).expect(200);
      await http()
        .post(venuesPath(eventId))
        .set('Authorization', authorization)
        .send({ role: 'CEREMONY', name: 'Church', address: '2 Test St' })
        .expect(403);
      await http()
        .patch(`${venuesPath(eventId)}/${venueId}`)
        .set('Authorization', authorization)
        .send({ address: 'Somewhere else' })
        .expect(403);
      await http().delete(`${venuesPath(eventId)}/${venueId}`).set('Authorization', authorization).expect(403);

      expect((body as { id: string }[]).map((venue) => venue.id)).toEqual([venueId]);
      expect(await prisma.venue.findMany({ where: { eventId } })).toEqual([before]);
    });
  });

  describe('venues that are not there', () => {
    it('refuses a venue copied from a retired directory hall, and adds nothing', async () => {
      const { eventId, authorization } = await host();
      const staffAuth = await staff();
      const { body: hall } = await http()
        .post('/api/v1/venue-profiles')
        .set('Authorization', staffAuth)
        .send({ name: 'Old Hall', address: '1 Old St' })
        .expect(201);
      await http().patch(`/api/v1/venue-profiles/${hall.id as string}`).set('Authorization', staffAuth).send({ isActive: false }).expect(200);

      const { body } = await http()
        .post(venuesPath(eventId))
        .set('Authorization', authorization)
        .send({ role: 'RECEPTION', name: 'Old Hall', address: '1 Old St', profileId: hall.id })
        .expect(404);

      expect(body.message).toBe('No such venue in the directory');
      expect(await prisma.venue.count({ where: { eventId } })).toBe(1);
    });

    it('refuses a venue copied from a directory hall that does not exist, and adds nothing', async () => {
      const { eventId, authorization } = await host();

      const { body } = await http()
        .post(venuesPath(eventId))
        .set('Authorization', authorization)
        .send({ role: 'RECEPTION', name: 'Hall', address: '1 St', profileId: 'no-such-profile' })
        .expect(404);

      expect(body.message).toBe('No such venue in the directory');
      expect(await prisma.venue.count({ where: { eventId } })).toBe(1);
    });

    it("answers 404 to a change or removal of another event's venue, and leaves it alone", async () => {
      const { eventId, authorization } = await host();
      const other = await seedEvent(prisma);
      const foreign = await prisma.venue.findFirstOrThrow({ where: { eventId: other.eventId } });

      await http()
        .patch(`${venuesPath(eventId)}/${foreign.id}`)
        .set('Authorization', authorization)
        .send({ address: 'Hijacked' })
        .expect(404);
      await http().delete(`${venuesPath(eventId)}/${foreign.id}`).set('Authorization', authorization).expect(404);

      expect(await prisma.venue.findUniqueOrThrow({ where: { id: foreign.id } })).toEqual(foreign);
    });
  });

  describe('what a venue write tells the host', () => {
    /** A guest page showing its venues, sent to the one household. */
    const invited = async () => {
      const seeded = await host();
      const event = await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } });
      await prisma.messageTemplate.create({
        data: {
          organizationId: event.organizationId,
          key: 'invitation.send',
          channel: MessageChannel.EMAIL,
          subject: { hy: '{{eventTitle}}' },
          body: { hy: '{{guestName}} {{link}}' },
        },
      });
      await prisma.guest.updateMany({ where: { eventId: seeded.eventId }, data: { email: 'armen@test.local' } });
      await reviseTemplateFixture(prisma, { where: { key: 'test-template' }, data: { supportedBlocks: ['HERO', 'VENUE', 'RSVP'] } });
      await http()
        .patch(`/api/v1/invitations/${seeded.slug}/arrangement`)
        .set('Authorization', seeded.authorization)
        .send({ blocks: [{ type: 'HERO' }, { type: 'VENUE' }, { type: 'RSVP' }] })
        .expect(200);
      await http().post(`/api/v1/invitations/${seeded.slug}/send`).set('Authorization', seeded.authorization).send({}).expect(201);
      return seeded;
    };

    const venueNamesOnPage = async (slug: string) => {
      const { body } = await http().get(`/api/v1/invitations/${slug}`).expect(200);
      const block = (body.blocks as { type: string; data: { name: string }[] }[]).find((b) => b.type === 'VENUE');
      return block?.data.map((venue) => venue.name);
    };

    it('offers to tell guests after a venue is added, and the guest page lists it at once', async () => {
      const { eventId, slug, authorization } = await invited();
      // Read first, so the page is cached and the write has to drop it.
      expect(await venueNamesOnPage(slug)).toEqual(['Fixture Hall']);

      const { body } = await http()
        .post(venuesPath(eventId))
        .set('Authorization', authorization)
        .send({ role: 'AFTER_PARTY', name: 'Night Club', address: '9 Late St' })
        .expect(201);

      expect(body.notice).toEqual({ isSuggested: true, changed: ['venues'], householdsInvited: 1 });
      expect(await venueNamesOnPage(slug)).toEqual(['Fixture Hall', 'Night Club']);
    });

    it('offers to tell guests after a venue is removed, and the guest page drops it at once', async () => {
      const { eventId, slug, authorization } = await invited();
      const added = await prisma.venue.create({
        data: { eventId, role: 'AFTER_PARTY', name: 'Night Club', address: '9 Late St', sortOrder: 5 },
      });
      expect(await venueNamesOnPage(slug)).toEqual(['Fixture Hall', 'Night Club']);

      const { body } = await http().delete(`${venuesPath(eventId)}/${added.id}`).set('Authorization', authorization).expect(200);

      expect(body).toEqual({ ok: true, notice: { isSuggested: true, changed: ['venues'], householdsInvited: 1 } });
      expect(await venueNamesOnPage(slug)).toEqual(['Fixture Hall']);
    });
  });

  describe('removing a venue something depends on', () => {
    it('refuses while a table stands at the venue, naming how many, and keeps both', async () => {
      const { eventId, authorization } = await host();
      const { body: venue } = await http()
        .post(venuesPath(eventId))
        .set('Authorization', authorization)
        .send({ role: 'CEREMONY', name: 'Church', address: '2 Test St' })
        .expect(201);
      const table = await prisma.table.create({ data: { eventId, venueId: venue.id, name: 'Front row', capacity: 4 } });

      const { body } = await http().delete(`${venuesPath(eventId)}/${venue.id as string}`).set('Authorization', authorization).expect(400);

      expect(body.message).toContain('1 table(s)');
      expect(await prisma.venue.findUnique({ where: { id: venue.id } })).not.toBeNull();
      expect(await prisma.table.findUnique({ where: { id: table.id } })).not.toBeNull();
    });

    it('refuses while a seat-release marker points at the venue, naming it', async () => {
      const { eventId, authorization, primaryGuestToken } = await host();
      const { body: venue } = await http()
        .post(venuesPath(eventId))
        .set('Authorization', authorization)
        .send({ role: 'CEREMONY', name: 'Church', address: '2 Test St' })
        .expect(201);
      const table = await prisma.table.create({ data: { eventId, venueId: venue.id, name: 'Front row', capacity: 4 } });
      const guest = await prisma.guest.findUniqueOrThrow({ where: { token: primaryGuestToken } });
      await prisma.seatRelease.create({
        data: { guestId: guest.id, eventId, arrangementId: table.arrangementId, releasedAt: new Date() },
      });
      await prisma.table.delete({ where: { id: table.id } });

      const { body } = await http().delete(`${venuesPath(eventId)}/${venue.id as string}`).set('Authorization', authorization).expect(400);

      expect(body.message).toContain('0 table(s) and 1 release marker(s)');
      expect(await prisma.venue.findUnique({ where: { id: venue.id } })).not.toBeNull();
    });
  });

  describe('what hosts see of the directory', () => {
    it("shows a hall's operator by id and name only, never its contacts or anyone's notes", async () => {
      const { eventId, authorization } = await host();
      const staffAuth = await staff();
      const operator = await prisma.vendor.create({
        data: {
          name: 'Garden Hall LLC',
          category: 'VENUE',
          email: 'bookings@garden.example',
          phone: '+37410000000',
          notes: 'Owner prefers calls after 6pm',
        },
      });
      await http()
        .post('/api/v1/venue-profiles')
        .set('Authorization', staffAuth)
        .send({ name: 'Garden Hall', address: '12 Garden Lane', city: 'Yerevan', capacity: 300, notes: 'Staff note: deposit 30%', vendorId: operator.id })
        .expect(201);

      const response = await http().get(`/api/v1/events/${eventId}/venue-profiles`).set('Authorization', authorization).expect(200);

      const [hall] = response.body as Record<string, unknown>[];
      expect(Object.keys(hall).sort()).toEqual(['address', 'capacity', 'city', 'id', 'name', 'vendor', 'vendorId']);
      expect(hall).toMatchObject({ vendorId: operator.id, vendor: { id: operator.id, name: 'Garden Hall LLC' } });
      expect(Object.keys(hall.vendor as object).sort()).toEqual(['id', 'name']);
      for (const secret of ['bookings@garden.example', '+37410000000', 'Owner prefers calls', 'deposit 30%']) {
        expect(response.text).not.toContain(secret);
      }
    });
  });

  describe('who may write the running order', () => {
    it.each([EventRole.DESIGNER, EventRole.VIEWER])('lets a %s read the timeline but not add, change or remove an entry', async (role) => {
      const { eventId, authorization: ownerAuth } = await host();
      const { body: entry } = await http()
        .post(`/api/v1/events/${eventId}/timeline`)
        .set('Authorization', ownerAuth)
        .send({ label: { en: 'Ceremony' }, occursAt: '2027-06-12T15:00:00Z' })
        .expect(201);
      const { authorization } = await authenticateAs(app, prisma, { eventId, role });
      const timeline = `/api/v1/events/${eventId}/timeline`;

      const { body } = await http().get(timeline).set('Authorization', authorization).expect(200);
      await http()
        .post(timeline)
        .set('Authorization', authorization)
        .send({ label: { en: 'Party' }, occursAt: '2027-06-12T20:00:00Z' })
        .expect(403);
      await http()
        .patch(`${timeline}/${entry.id as string}`)
        .set('Authorization', authorization)
        .send({ label: { en: 'Renamed' } })
        .expect(403);
      await http().delete(`${timeline}/${entry.id as string}`).set('Authorization', authorization).expect(403);

      expect((body as { id: string }[]).map((item) => item.id)).toEqual([entry.id]);
      const entries = await prisma.timelineEntry.findMany({ where: { eventId } });
      expect(entries).toHaveLength(1);
      expect(entries[0].label).toEqual({ en: 'Ceremony' });
    });
  });
});
