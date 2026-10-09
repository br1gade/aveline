import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, PrismaClient, RsvpStatus, EventVisibility } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Covers the product rule in spec §12: operations are fast and arrangeable,
 * reached by the shortest path rather than a multi-step workflow.
 */
describe('Operations UX (e2e)', () => {
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
    app.enableShutdownHooks();
    await app.init();
  });

  beforeEach(() => resetTestDatabase());

  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  // B32: every request counted, from guests who are not coming too, and
  // "Sirun Yar" and "sirun yar " were two tracks.
  describe('the playlist', () => {
    it('counts requests from guests who are coming, whatever the capitals', async () => {
      const { eventId, householdId } = await seedEvent(prisma, { seatsAllotted: 6 });
      const { authorization } = await authenticateAs(app, prisma, { eventId });
      const requested = (firstName: string, status: RsvpStatus, songRequest: string) =>
        prisma.guest.create({
          data: { eventId, householdId, firstName, token: `${firstName}-${eventId}`, rsvp: { create: { status, songRequest } } },
        });
      await requested('Ani', RsvpStatus.ATTENDING, 'Sirun Yar');
      await requested('Aram', RsvpStatus.ATTENDING, ' sirun  yar ');
      await requested('Lusine', RsvpStatus.ATTENDING, 'Sirun Yar');
      await requested('Narek', RsvpStatus.DECLINED, 'Hey Jan Ghapama');
      await requested('Mariam', RsvpStatus.ATTENDING, '   ');

      const { body } = await http().get(`/api/v1/events/${eventId}/playlist`).set('Authorization', authorization).expect(200);

      expect(body).toEqual({ uniqueTracks: 1, tracks: [{ track: 'Sirun Yar', requests: 3 }] });
    });
  });

  describe('one-call dashboard', () => {
    it('returns every operational view in a single request', async () => {
      const { slug, primaryGuestToken, eventId } = await seedEvent(prisma, { seatsAllotted: 2 });

      await http()
        .post(`/api/v1/invitations/${slug}/g/${primaryGuestToken}/rsvp`)
        .send({
          status: RsvpStatus.ATTENDING,
          dietary: ['vegan'],
          drinkPreference: 'wine',
          songRequest: 'Sirun Yar',
        })
        .expect(201);

      const { authorization } = await authenticateAs(app, prisma, { eventId });
      const { body } = await http()
        .get(`/api/v1/events/${eventId}/dashboard`)
        .set('Authorization', authorization)
        .expect(200);

      expect(Object.keys(body as Record<string, unknown>).sort()).toEqual([
        'bar',
        'catering',
        'engagement',
        'generatedAt',
        'headcount',
        'playlist',
      ]);
      expect(body.headcount).toMatchObject({ invited: 1, attending: 1, responseRate: 100 });
      expect(body.catering.covers).toBe(1);
      expect(body.bar.preferences).toContainEqual({ drink: 'wine', key: 'wine', guests: 1, share: 100 });
      expect(body.playlist.tracks).toContainEqual({ track: 'Sirun Yar', requests: 1 });
    });

    it('404s an unknown event rather than returning an empty dashboard', async () => {
      const { authorization } = await authenticateAs(app, prisma);
      // A platform account with no membership is still refused by the policy,
      // so this asserts the 404 path for someone who could otherwise read it.
      await prisma.user.updateMany({ where: {}, data: { platformRole: 'ADMIN' } });

      await http()
        .get('/api/v1/events/does-not-exist/dashboard')
        .set('Authorization', authorization)
        .expect(404);
    });
  });

  describe('cached invitation payload', () => {
    it('serves identical content on a repeat read', async () => {
      const { slug } = await seedEvent(prisma, { visibility: EventVisibility.UNLISTED });

      const first = await http().get(`/api/v1/invitations/${slug}`).expect(200);
      const second = await http().get(`/api/v1/invitations/${slug}`).expect(200);

      expect(second.body).toEqual(first.body);
    });

    it('reflects a rearrangement immediately, proving invalidation works', async () => {
      const { slug, eventId } = await seedEvent(prisma, { visibility: EventVisibility.UNLISTED });
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.DESIGNER,
      });

      const before = await http().get(`/api/v1/invitations/${slug}`).expect(200);
      const beforeTypes = (before.body as { blocks: { type: string }[] }).blocks.map((b) => b.type);
      expect(beforeTypes).toEqual(['HERO', 'RSVP']);

      await http()
        .patch(`/api/v1/invitations/${slug}/arrangement`)
        .set('Authorization', authorization)
        .send({ blocks: [{ type: 'RSVP' }, { type: 'HERO' }] })
        .expect(200);

      const after = await http().get(`/api/v1/invitations/${slug}`).expect(200);
      const afterTypes = (after.body as { blocks: { type: string }[] }).blocks.map((b) => b.type);
      expect(afterTypes).toEqual(['RSVP', 'HERO']);
    });
  });

  // B24: blocks not sent kept their old positions, tying with the ones that
  // were — so the page order was whatever the database returned.
  describe('rearranging some of the blocks', () => {
    it('puts the blocks sent first, in that order, and keeps the rest after them as they were', async () => {
      const { slug, eventId } = await seedEvent(prisma);
      const { authorization } = await authenticateAs(app, prisma, { eventId, role: EventRole.DESIGNER });
      const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug } });
      await prisma.invitationBlock.createMany({
        data: [
          { invitationId: invitation.id, type: 'COUNTDOWN', sortOrder: 2 },
          { invitationId: invitation.id, type: 'GALLERY', sortOrder: 3 },
        ],
      });

      const { body } = await http()
        .patch(`/api/v1/invitations/${slug}/arrangement`)
        .set('Authorization', authorization)
        .send({ blocks: [{ type: 'RSVP' }] })
        .expect(200);

      const order = (body as { blocks: { type: string; sortOrder: number }[] }).blocks.map((block) => [block.type, block.sortOrder]);
      expect(order).toEqual([['RSVP', 0], ['HERO', 1], ['COUNTDOWN', 2], ['GALLERY', 3]]);
      const stored = await prisma.invitationBlock.findMany({ where: { invitationId: invitation.id }, orderBy: { sortOrder: 'asc' } });
      expect(stored.map((block) => block.type)).toEqual(['RSVP', 'HERO', 'COUNTDOWN', 'GALLERY']);
    });
  });

  describe('skeleton contracts', () => {
    // Every list endpoint shares one envelope, so a client learns it once.
    it('returns a paged envelope', async () => {
      const { body } = await http().get('/api/v1/public/events').expect(200);

      expect(body).toMatchObject({ total: expect.any(Number), limit: 20, offset: 0 });
      expect(Array.isArray(body.items)).toBe(true);
      expect(typeof body.hasMore).toBe('boolean');
    });

    it('honours a limit within range', async () => {
      const { body } = await http().get('/api/v1/public/events').query({ limit: 5 }).expect(200);
      expect(body.limit).toBe(5);
    });

    // Rejecting an out-of-range limit beats silently changing it: a client
    // asking for 500 and receiving 100 has no way to tell.
    it.each([{ limit: 500 }, { limit: 0 }, { limit: -1 }, { limit: 'abc' }, { offset: -1 }])(
      'rejects $0 with 400',
      async (query) => {
        await http().get('/api/v1/public/events').query(query).expect(400);
      },
    );

    // BigInt is not JSON-serialisable; the interceptor converts it globally.
    it('serialises money as a string rather than throwing', async () => {
      const { slug, primaryGuestToken } = await seedEvent(prisma);
      await http()
        .post(`/api/v1/invitations/${slug}/g/${primaryGuestToken}/rsvp`)
        .send({ status: 'ATTENDING' })
        .expect(201);

      const { body } = await http().get('/api/v1/public/events').expect(200);
      const { items } = body as { items: { fromPriceMinor: unknown }[] };
      expect(
        items.every(
          (item) => item.fromPriceMinor === null || typeof item.fromPriceMinor === 'string',
        ),
      ).toBe(true);
    });

    it('stamps every response with a request id', async () => {
      const response = await http().get('/api/v1/health/live').expect(200);
      expect(response.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
    });

    it('honours a request id supplied upstream, so a trace survives a proxy', async () => {
      const response = await http()
        .get('/api/v1/health/live')
        .set('x-request-id', 'trace-from-upstream')
        .expect(200);

      expect(response.headers['x-request-id']).toBe('trace-from-upstream');
    });

    it('reports errors in one shape, carrying the request id', async () => {
      const { body } = await http().get('/api/v1/invitations/does-not-exist').expect(404);

      expect(body).toMatchObject({
        statusCode: 404,
        path: '/api/v1/invitations/does-not-exist',
      });
      expect(typeof body.requestId).toBe('string');
      expect(typeof body.at).toBe('string');
    });
  });

  describe('media upload', () => {
    // A 1x1 PNG — the smallest thing that is genuinely an image.
    const pixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    it('stores a file and records it against the event', async () => {
      const { eventId } = await seedEvent(prisma);
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.DESIGNER,
      });

      const { body } = await http()
        .post(`/api/v1/events/${eventId}/media`)
        .set('Authorization', authorization)
        .attach('file', pixel, { filename: 'pixel.png', contentType: 'image/png' })
        .expect(201);

      expect(body).toMatchObject({ kind: 'PHOTO', sizeBytes: pixel.byteLength });
      // Backend-agnostic: the URL ends in the generated key, whichever
      // adapter is configured. Asserting a path prefix would pin the test to
      // local disk and fail the moment object storage is used.
      expect(body.url).toMatch(/[0-9a-f-]{36}\.png$/);

      const stored = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: body.id } });
      expect(stored.eventId).toBe(eventId);
    });

    it('refuses a file type that is not on the allowlist', async () => {
      const { eventId } = await seedEvent(prisma);
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.DESIGNER,
      });

      await http()
        .post(`/api/v1/events/${eventId}/media`)
        .set('Authorization', authorization)
        .attach('file', Buffer.from('#!/bin/sh'), {
          filename: 'script.sh',
          contentType: 'application/x-sh',
        })
        .expect(415);
    });

    it('refuses an upload without a session', async () => {
      const { eventId } = await seedEvent(prisma);

      await http()
        .post(`/api/v1/events/${eventId}/media`)
        .attach('file', pixel, { filename: 'pixel.png', contentType: 'image/png' })
        .expect(401);
    });
  });

  describe('locale negotiation', () => {
    // Regression: an unvalidated ?locale= became a Redis cache key, so junk
    // values grew the keyspace without limit on a public endpoint.
    it.each(['zz', 'de', '../../etc/passwd', 'a'.repeat(300)])(
      'falls back to the default locale for %p instead of echoing it',
      async (junk) => {
        const { slug } = await seedEvent(prisma, { visibility: EventVisibility.UNLISTED });

        const { body } = await http()
          .get(`/api/v1/invitations/${slug}`)
          .query({ locale: junk })
          .expect(200);

        const page = body as { locale: string; availableLocales: string[] };
        expect(page.availableLocales).toContain(page.locale);
        expect(page.locale).toBe('hy');
      },
    );

    it('serves a locale the event does publish', async () => {
      const { slug } = await seedEvent(prisma, { visibility: EventVisibility.UNLISTED });

      const { body } = await http()
        .get(`/api/v1/invitations/${slug}`)
        .query({ locale: 'en' })
        .expect(200);

      expect((body as { locale: string }).locale).toBe('en');
    });
  });

  describe('block arrangement', () => {
    it('reorders, toggles and re-variants in one atomic request', async () => {
      const { slug, eventId } = await seedEvent(prisma, { visibility: EventVisibility.UNLISTED });
      // DESIGNER is the least-privileged role that may change an invitation,
      // so using it here also asserts the permission is scoped correctly.
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.DESIGNER,
      });

      const { body } = await http()
        .patch(`/api/v1/invitations/${slug}/arrangement`)
        .set('Authorization', authorization)
        .send({
          blocks: [
            { type: 'RSVP', variant: 'split' },
            { type: 'HERO', enabled: false },
          ],
        })
        .expect(200);

      expect(body.blocks).toEqual([
        { type: 'RSVP', sortOrder: 0, enabled: true, variant: 'split' },
        { type: 'HERO', sortOrder: 1, enabled: false, variant: null },
      ]);

      // A disabled block must disappear from the public page.
      const page = await http().get(`/api/v1/invitations/${slug}`).expect(200);
      const types = (page.body as { blocks: { type: string }[] }).blocks.map((b) => b.type);
      expect(types).toEqual(['RSVP']);
    });

    it('rejects a block the template cannot render and changes nothing', async () => {
      const { slug, eventId } = await seedEvent(prisma, { visibility: EventVisibility.UNLISTED });
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.DESIGNER,
      });

      const response = await http()
        .patch(`/api/v1/invitations/${slug}/arrangement`)
        .set('Authorization', authorization)
        .send({ blocks: [{ type: 'HERO' }, { type: 'TIMELINE' }] })
        .expect(400);
      expect(response.body.message).toContain('TIMELINE');

      const page = await http().get(`/api/v1/invitations/${slug}`).expect(200);
      const types = (page.body as { blocks: { type: string }[] }).blocks.map((b) => b.type);
      expect(types).toEqual(['HERO', 'RSVP']);
    });

    it.each([
      { label: 'empty list', payload: { blocks: [] } },
      { label: 'duplicate type', payload: { blocks: [{ type: 'HERO' }, { type: 'HERO' }] } },
      { label: 'unknown block type', payload: { blocks: [{ type: 'NOT_A_BLOCK' }] } },
      { label: 'unknown field', payload: { blocks: [{ type: 'HERO', colour: 'red' }] } },
    ])('rejects $label with 400', async ({ payload }) => {
      const { slug, eventId } = await seedEvent(prisma, { visibility: EventVisibility.UNLISTED });
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.DESIGNER,
      });

      await http()
        .patch(`/api/v1/invitations/${slug}/arrangement`)
        .set('Authorization', authorization)
        .send(payload)
        .expect(400);
    });

    it('404s an unknown invitation', async () => {
      const { authorization } = await authenticateAs(app, prisma);
      await prisma.user.updateMany({ where: {}, data: { platformRole: 'ADMIN' } });

      await http()
        .patch('/api/v1/invitations/nope/arrangement')
        .set('Authorization', authorization)
        .send({ blocks: [{ type: 'HERO' }] })
        .expect(404);
    });
  });
});
