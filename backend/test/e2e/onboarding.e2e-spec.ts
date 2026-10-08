import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BlockType, EventType, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Getting from nothing to a usable event.
 *
 * This is the path a real customer takes and the one nothing covered: every
 * other test starts from a seeded event. Until these endpoints existed, an
 * account could register, create an organization, and then stop — there was
 * no way to create an event at all.
 */
describe('Onboarding (e2e)', () => {
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

  /** A template has to exist for an invitation to be built from. Idempotent,
   *  because templates are platform-wide and several tests ensure one. */
  const withTemplate = () =>
    prisma.designTemplate.upsert({
      where: { key: 'classic' },
      update: {},
      create: {
        key: 'classic',
        name: 'Classic',
        allowedFonts: ['Noto Serif Armenian'],
        supportedBlocks: [BlockType.HERO, BlockType.TIMELINE, BlockType.RSVP],
        defaultTheme: { bodyFont: 'Noto Serif Armenian' },
      },
    });

  /** A signed-in account that owns an organization — the state before step one. */
  const newCustomer = async () => {
    const { authorization } = await authenticateAs(app, prisma);
    await http()
      .post('/api/v1/organizations')
      .set('Authorization', authorization)
      .send({ name: 'Petrosyan Wedding' })
      .expect(201);
    return { authorization };
  };

  const anEvent = {
    type: EventType.WEDDING,
    title: 'Anna & Davit',
    startsAt: '2027-06-12T15:00:00.000Z',
    locales: ['hy', 'en'],
  };

  describe('creating the first event', () => {
    it('creates the event, its invitation and the caller’s ownership at once', async () => {
      const { authorization } = await newCustomer();
      await withTemplate();

      const { body } = await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send(anEvent)
        .expect(201);

      expect(body).toMatchObject({ title: 'Anna & Davit', type: 'WEDDING', status: 'DRAFT' });
      expect(body.invitation.slug).toMatch(/^anna-davit-[0-9a-f]{8}$/);
      expect(body.invitation.status).toBe('DRAFT');
    });

    /**
     * Without the membership the event exists and its creator cannot read it
     * back, because access is resolved from membership.
     */
    it('lets the creator read it back immediately', async () => {
      const { authorization } = await newCustomer();
      await withTemplate();
      const { body: created } = await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send(anEvent)
        .expect(201);

      await http()
        .get(`/api/v1/events/${created.id}`)
        .set('Authorization', authorization)
        .expect(200);

      const { body: list } = await http()
        .get('/api/v1/events')
        .set('Authorization', authorization)
        .expect(200);
      expect(list).toHaveLength(1);
    });

    /**
     * A new invitation used to have no blocks at all, so a host opened a blank
     * page and could publish it in that state.
     */
    it('starts with the template’s blocks, the useful ones switched on', async () => {
      const { authorization } = await newCustomer();
      await withTemplate();

      const { body } = await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send(anEvent)
        .expect(201);

      const blocks = await prisma.invitationBlock.findMany({
        where: { invitation: { slug: body.invitation.slug as string } },
        orderBy: { sortOrder: 'asc' },
        select: { type: true, enabled: true },
      });

      // The fixture template supports HERO, TIMELINE and RSVP, in that order.
      expect(blocks).toEqual([
        { type: BlockType.HERO, enabled: true },
        { type: BlockType.TIMELINE, enabled: true },
        { type: BlockType.RSVP, enabled: true },
      ]);
    });

    it('renders those blocks on the published page', async () => {
      const { authorization } = await newCustomer();
      await withTemplate();
      const { body: created } = await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send(anEvent)
        .expect(201);
      await http()
        .post(`/api/v1/events/${created.id}/venues`)
        .set('Authorization', authorization)
        .send({ role: 'RECEPTION', name: 'Ararat Hall', address: 'Yerevan' })
        .expect(201);
      await http()
        .post(`/api/v1/invitations/${created.invitation.slug}/publish`)
        .set('Authorization', authorization)
        .expect(201);

      const { body } = await http()
        .get(`/api/v1/invitations/${created.invitation.slug}`)
        .expect(200);

      expect(body.blocks.length).toBeGreaterThan(0);
    });

    it('applies the theme of the template it chose', async () => {
      const { authorization } = await newCustomer();
      await withTemplate();

      const { body } = await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send({ ...anEvent, templateKey: 'classic' })
        .expect(201);

      expect(body.invitation.theme).toEqual({ bodyFont: 'Noto Serif Armenian' });
    });

    // An Armenian title transliterates to nothing, which a product written for
    // Armenia cannot treat as an edge case.
    it('still produces a usable slug for an Armenian title', async () => {
      const { authorization } = await newCustomer();
      await withTemplate();

      const { body } = await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send({ ...anEvent, title: 'Աննա և Դավիթ', hostsLabel: 'Աննա և Դավիթ' })
        .expect(201);

      expect(body.invitation.slug).toMatch(/^event-[0-9a-f]{8}$/);
    });

    it('gives two events with the same hosts different slugs', async () => {
      const { authorization } = await newCustomer();
      await withTemplate();

      const first = await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send(anEvent)
        .expect(201);
      const second = await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send(anEvent)
        .expect(201);

      expect(first.body.invitation.slug).not.toBe(second.body.invitation.slug);
    });

    it('defaults the hosts label, timezone and locale', async () => {
      const { authorization } = await newCustomer();
      await withTemplate();

      const { body } = await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send({ type: EventType.BIRTHDAY, title: 'Davit turns 40', startsAt: anEvent.startsAt })
        .expect(201);

      expect(body).toMatchObject({
        hostsLabel: 'Davit turns 40',
        timezone: 'Asia/Yerevan',
        defaultLocale: 'hy',
      });
    });

    it.each([
      { label: 'no title', payload: { type: EventType.WEDDING, startsAt: anEvent.startsAt } },
      { label: 'no start', payload: { type: EventType.WEDDING, title: 'Anna & Davit' } },
      { label: 'an unknown type', payload: { ...anEvent, type: 'FUNERAL' } },
      { label: 'a start that is not a date', payload: { ...anEvent, startsAt: 'soon' } },
      { label: 'an end before the start', payload: { ...anEvent, endsAt: '2027-06-11T15:00:00.000Z' } },
      { label: 'an unknown field', payload: { ...anEvent, budget: 1000 } },
    ])('rejects $label with 400', async ({ payload }) => {
      const { authorization } = await newCustomer();
      await withTemplate();

      await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send(payload)
        .expect(400);
    });

    it('404s a template key that does not exist', async () => {
      const { authorization } = await newCustomer();
      await withTemplate();

      await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send({ ...anEvent, templateKey: 'nope' })
        .expect(404);
    });

    // An account with no organization has nowhere to put an event.
    it('refuses an account that has not created an organization', async () => {
      const { authorization } = await authenticateAs(app, prisma);
      await withTemplate();

      await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send(anEvent)
        .expect(403);
    });
  });

  describe('an event created before any template existed', () => {
    it('is created without an invitation, and can be given one later', async () => {
      const { authorization } = await newCustomer();

      const { body: created } = await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send(anEvent)
        .expect(201);
      expect(created.invitation).toBeNull();

      await withTemplate();
      const { body } = await http()
        .post(`/api/v1/events/${created.id}/invitation`)
        .set('Authorization', authorization)
        .send({})
        .expect(201);

      expect(body.slug).toEqual(expect.any(String));
    });

    it('refuses a second invitation, naming the one that exists', async () => {
      const { authorization } = await newCustomer();
      await withTemplate();
      const { body: created } = await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send(anEvent)
        .expect(201);

      const { body } = await http()
        .post(`/api/v1/events/${created.id}/invitation`)
        .set('Authorization', authorization)
        .send({})
        .expect(400);

      expect(body.message).toContain(created.invitation.slug);
    });
  });

  describe('the running order', () => {
    const eventWithTimeline = async () => {
      const { authorization } = await newCustomer();
      await withTemplate();
      const { body } = await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send(anEvent)
        .expect(201);
      return { authorization, eventId: body.id as string, slug: body.invitation.slug as string };
    };

    it('adds entries and returns them in the order they happen', async () => {
      const { authorization, eventId } = await eventWithTimeline();

      await http()
        .post(`/api/v1/events/${eventId}/timeline`)
        .set('Authorization', authorization)
        .send({ label: { hy: 'Ընթրիք' }, occursAt: '2027-06-12T19:00:00.000Z' })
        .expect(201);
      await http()
        .post(`/api/v1/events/${eventId}/timeline`)
        .set('Authorization', authorization)
        .send({ label: { hy: 'Պսակադրություն' }, occursAt: '2027-06-12T15:00:00.000Z' })
        .expect(201);

      const { body } = await http()
        .get(`/api/v1/events/${eventId}/timeline`)
        .set('Authorization', authorization)
        .expect(200);

      const entries = body as { label: { hy: string } }[];
      expect(entries.map((entry) => entry.label.hy)).toEqual(['Պսակադրություն', 'Ընթրիք']);
    });

    it('attaches an entry to one of the event’s venues', async () => {
      const { authorization, eventId } = await eventWithTimeline();
      const { body: venue } = await http()
        .post(`/api/v1/events/${eventId}/venues`)
        .set('Authorization', authorization)
        .send({ role: 'RECEPTION', name: 'Ararat Hall', address: 'Yerevan' })
        .expect(201);

      await http()
        .post(`/api/v1/events/${eventId}/timeline`)
        .set('Authorization', authorization)
        .send({
          label: { hy: 'Ընթրիք' },
          occursAt: '2027-06-12T19:00:00.000Z',
          venueId: venue.id,
        })
        .expect(201);

      const { body } = await http()
        .get(`/api/v1/events/${eventId}/timeline`)
        .set('Authorization', authorization)
        .expect(200);
      expect(body[0].venue).toMatchObject({ name: 'Ararat Hall' });
    });

    // A venue from another event would put someone else's address on the page.
    it('refuses a venue that belongs to another event', async () => {
      const first = await eventWithTimeline();
      const second = await eventWithTimeline();
      const { body: venue } = await http()
        .post(`/api/v1/events/${second.eventId}/venues`)
        .set('Authorization', second.authorization)
        .send({ role: 'RECEPTION', name: 'Elsewhere', address: 'Gyumri' })
        .expect(201);

      await http()
        .post(`/api/v1/events/${first.eventId}/timeline`)
        .set('Authorization', first.authorization)
        .send({
          label: { hy: 'Ընթրիք' },
          occursAt: '2027-06-12T19:00:00.000Z',
          venueId: venue.id,
        })
        .expect(400);
    });

    // A blank row on the invitation reads as a bug to the guests looking at it.
    it('refuses an entry with no label in any language', async () => {
      const { authorization, eventId } = await eventWithTimeline();

      await http()
        .post(`/api/v1/events/${eventId}/timeline`)
        .set('Authorization', authorization)
        .send({ label: {}, occursAt: '2027-06-12T19:00:00.000Z' })
        .expect(400);
    });

    it('changes and removes an entry', async () => {
      const { authorization, eventId } = await eventWithTimeline();
      const { body: entry } = await http()
        .post(`/api/v1/events/${eventId}/timeline`)
        .set('Authorization', authorization)
        .send({ label: { hy: 'Ընթրիք' }, occursAt: '2027-06-12T19:00:00.000Z' })
        .expect(201);

      await http()
        .patch(`/api/v1/events/${eventId}/timeline/${entry.id}`)
        .set('Authorization', authorization)
        .send({ label: { hy: 'Ընթրիք', en: 'Dinner' }, occursAt: '2027-06-12T20:00:00.000Z' })
        .expect(200);

      await http()
        .delete(`/api/v1/events/${eventId}/timeline/${entry.id}`)
        .set('Authorization', authorization)
        .expect(200);

      const { body } = await http()
        .get(`/api/v1/events/${eventId}/timeline`)
        .set('Authorization', authorization)
        .expect(200);
      expect(body).toHaveLength(0);
    });

    it('404s an entry from another event', async () => {
      const first = await eventWithTimeline();
      const second = await eventWithTimeline();
      const { body: entry } = await http()
        .post(`/api/v1/events/${second.eventId}/timeline`)
        .set('Authorization', second.authorization)
        .send({ label: { hy: 'Ընթրիք' }, occursAt: '2027-06-12T19:00:00.000Z' })
        .expect(201);

      await http()
        .delete(`/api/v1/events/${first.eventId}/timeline/${entry.id}`)
        .set('Authorization', first.authorization)
        .expect(404);
    });
  });

  /**
   * Nothing used to set an invitation to PUBLISHED. A host could design it,
   * and `send` then refused with "publish it before sending" — with no way to
   * publish. Every test passed because fixtures seeded PUBLISHED directly.
   */
  describe('publishing', () => {
    const designedEvent = async (options: { withVenue?: boolean } = {}) => {
      const { authorization } = await newCustomer();
      await withTemplate();
      const { body } = await http()
        .post('/api/v1/events')
        .set('Authorization', authorization)
        .send(anEvent)
        .expect(201);
      if (options.withVenue ?? true) {
        await http()
          .post(`/api/v1/events/${body.id}/venues`)
          .set('Authorization', authorization)
          .send({ role: 'RECEPTION', name: 'Ararat Hall', address: 'Yerevan' })
          .expect(201);
      }
      return { authorization, eventId: body.id as string, slug: body.invitation.slug as string };
    };

    const act = (slug: string, action: string, authorization: string) =>
      http().post(`/api/v1/invitations/${slug}/${action}`).set('Authorization', authorization);

    it('publishes a ready invitation and makes it readable', async () => {
      const { slug, authorization } = await designedEvent();

      await http().get(`/api/v1/invitations/${slug}`).expect(404);
      const { body } = await act(slug, 'publish', authorization).expect(201);

      expect(body).toEqual({ slug, status: 'PUBLISHED' });
      const page = await http().get(`/api/v1/invitations/${slug}`).expect(200);
      expect(page.body.isAcceptingResponses).toBe(true);
    });

    // Publishing also marks the event live, which is what public listings
    // filter on.
    it('marks the event published too', async () => {
      const { slug, eventId, authorization } = await designedEvent();

      await act(slug, 'publish', authorization).expect(201);

      const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
      expect(event.status).toBe('PUBLISHED');
    });

    it('refuses an invitation with no venue, naming what is missing', async () => {
      const { slug, authorization } = await designedEvent({ withVenue: false });

      const { body } = await act(slug, 'publish', authorization).expect(400);

      expect(body.message).toEqual([
        'Add a venue with an address, so guests know where to go',
      ]);
    });

    it('refuses an invitation whose RSVP block is switched off', async () => {
      const { slug, authorization } = await designedEvent();
      await prisma.invitationBlock.updateMany({
        where: { invitation: { slug }, type: BlockType.RSVP },
        data: { enabled: false },
      });

      const { body } = await act(slug, 'publish', authorization).expect(400);

      expect(JSON.stringify(body.message)).toContain('RSVP');
    });

    it('refuses to publish twice', async () => {
      const { slug, authorization } = await designedEvent();
      await act(slug, 'publish', authorization).expect(201);

      await act(slug, 'publish', authorization).expect(400);
    });

    /**
     * Closing stops responses but keeps the page readable: the venue and time
     * still matter to everyone who is coming.
     */
    it('closes to new responses while staying readable', async () => {
      const { slug, authorization } = await designedEvent();
      await act(slug, 'publish', authorization).expect(201);

      await act(slug, 'close', authorization).expect(201);

      const page = await http().get(`/api/v1/invitations/${slug}`).expect(200);
      expect(page.body.isAcceptingResponses).toBe(false);
    });

    it('reopens after closing', async () => {
      const { slug, authorization } = await designedEvent();
      await act(slug, 'publish', authorization).expect(201);
      await act(slug, 'close', authorization).expect(201);

      const { body } = await act(slug, 'reopen', authorization).expect(201);

      expect(body.status).toBe('PUBLISHED');
    });

    it('cannot close a draft', async () => {
      const { slug, authorization } = await designedEvent();

      await act(slug, 'close', authorization).expect(400);
    });

    // The flow that was impossible: create, publish, send, all over HTTP.
    it('can be sent once published, with no database writes in between', async () => {
      const { slug, eventId, authorization } = await designedEvent();
      const household = await prisma.household.create({
        data: { eventId, name: 'Petrosyan', seatsAllotted: 2 },
      });
      await prisma.guest.create({
        data: {
          eventId,
          householdId: household.id,
          firstName: 'Armen',
          email: 'armen@test.local',
          isPrimary: true,
          token: 'tok-onboarding-armen',
        },
      });
      await prisma.messageTemplate.create({
        data: {
          organizationId: null,
          key: 'invitation.send',
          channel: 'EMAIL',
          subject: { hy: '{{hosts}}' },
          body: { hy: '{{guestName}} {{link}}' },
        },
      });

      await act(slug, 'send', authorization).expect(400);
      await act(slug, 'publish', authorization).expect(201);
      const { body } = await act(slug, 'send', authorization).send({}).expect(201);

      expect(body.queued).toBe(1);
    });
  });

});