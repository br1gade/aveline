import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, PrismaClient, RsvpStatus } from '@prisma/client';
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
    app.setGlobalPrefix('api');
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

  describe('one-call dashboard', () => {
    it('returns every operational view in a single request', async () => {
      const { slug, primaryGuestToken, eventId } = await seedEvent(prisma, { seatsAllotted: 2 });

      await http()
        .post(`/api/invitations/${slug}/g/${primaryGuestToken}/rsvp`)
        .send({
          status: RsvpStatus.ATTENDING,
          dietary: ['vegan'],
          drinkPreference: 'wine',
          songRequest: 'Sirun Yar',
        })
        .expect(201);

      const { authorization } = await authenticateAs(app, prisma, { eventId });
      const { body } = await http()
        .get(`/api/events/${eventId}/dashboard`)
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
      expect(body.bar.preferences).toContainEqual({ drink: 'wine', guests: 1, share: 100 });
      expect(body.playlist.tracks).toContainEqual({ track: 'Sirun Yar', requests: 1 });
    });

    it('404s an unknown event rather than returning an empty dashboard', async () => {
      const { authorization } = await authenticateAs(app, prisma);
      // A platform account with no membership is still refused by the policy,
      // so this asserts the 404 path for someone who could otherwise read it.
      await prisma.user.updateMany({ where: {}, data: { platformRole: 'ADMIN' } });

      await http()
        .get('/api/events/does-not-exist/dashboard')
        .set('Authorization', authorization)
        .expect(404);
    });
  });

  describe('cached invitation payload', () => {
    it('serves identical content on a repeat read', async () => {
      const { slug } = await seedEvent(prisma);

      const first = await http().get(`/api/invitations/${slug}`).expect(200);
      const second = await http().get(`/api/invitations/${slug}`).expect(200);

      expect(second.body).toEqual(first.body);
    });

    it('reflects a rearrangement immediately, proving invalidation works', async () => {
      const { slug, eventId } = await seedEvent(prisma);
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.DESIGNER,
      });

      const before = await http().get(`/api/invitations/${slug}`).expect(200);
      const beforeTypes = (before.body as { blocks: { type: string }[] }).blocks.map((b) => b.type);
      expect(beforeTypes).toEqual(['HERO', 'RSVP']);

      await http()
        .patch(`/api/invitations/${slug}/arrangement`)
        .set('Authorization', authorization)
        .send({ blocks: [{ type: 'RSVP' }, { type: 'HERO' }] })
        .expect(200);

      const after = await http().get(`/api/invitations/${slug}`).expect(200);
      const afterTypes = (after.body as { blocks: { type: string }[] }).blocks.map((b) => b.type);
      expect(afterTypes).toEqual(['RSVP', 'HERO']);
    });
  });

  describe('locale negotiation', () => {
    // Regression: an unvalidated ?locale= became a Redis cache key, so junk
    // values grew the keyspace without limit on a public endpoint.
    it.each(['zz', 'de', '../../etc/passwd', 'a'.repeat(300)])(
      'falls back to the default locale for %p instead of echoing it',
      async (junk) => {
        const { slug } = await seedEvent(prisma);

        const { body } = await http()
          .get(`/api/invitations/${slug}`)
          .query({ locale: junk })
          .expect(200);

        const page = body as { locale: string; availableLocales: string[] };
        expect(page.availableLocales).toContain(page.locale);
        expect(page.locale).toBe('hy');
      },
    );

    it('serves a locale the event does publish', async () => {
      const { slug } = await seedEvent(prisma);

      const { body } = await http()
        .get(`/api/invitations/${slug}`)
        .query({ locale: 'en' })
        .expect(200);

      expect((body as { locale: string }).locale).toBe('en');
    });
  });

  describe('block arrangement', () => {
    it('reorders, toggles and re-variants in one atomic request', async () => {
      const { slug, eventId } = await seedEvent(prisma);
      // DESIGNER is the least-privileged role that may change an invitation,
      // so using it here also asserts the permission is scoped correctly.
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.DESIGNER,
      });

      const { body } = await http()
        .patch(`/api/invitations/${slug}/arrangement`)
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
      const page = await http().get(`/api/invitations/${slug}`).expect(200);
      const types = (page.body as { blocks: { type: string }[] }).blocks.map((b) => b.type);
      expect(types).toEqual(['RSVP']);
    });

    it('rejects a block the template cannot render and changes nothing', async () => {
      const { slug, eventId } = await seedEvent(prisma);
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.DESIGNER,
      });

      const response = await http()
        .patch(`/api/invitations/${slug}/arrangement`)
        .set('Authorization', authorization)
        .send({ blocks: [{ type: 'HERO' }, { type: 'TIMELINE' }] })
        .expect(400);
      expect(response.body.message).toContain('TIMELINE');

      const page = await http().get(`/api/invitations/${slug}`).expect(200);
      const types = (page.body as { blocks: { type: string }[] }).blocks.map((b) => b.type);
      expect(types).toEqual(['HERO', 'RSVP']);
    });

    it.each([
      { label: 'empty list', payload: { blocks: [] } },
      { label: 'duplicate type', payload: { blocks: [{ type: 'HERO' }, { type: 'HERO' }] } },
      { label: 'unknown block type', payload: { blocks: [{ type: 'NOT_A_BLOCK' }] } },
      { label: 'unknown field', payload: { blocks: [{ type: 'HERO', colour: 'red' }] } },
    ])('rejects $label with 400', async ({ payload }) => {
      const { slug, eventId } = await seedEvent(prisma);
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.DESIGNER,
      });

      await http()
        .patch(`/api/invitations/${slug}/arrangement`)
        .set('Authorization', authorization)
        .send(payload)
        .expect(400);
    });

    it('404s an unknown invitation', async () => {
      const { authorization } = await authenticateAs(app, prisma);
      await prisma.user.updateMany({ where: {}, data: { platformRole: 'ADMIN' } });

      await http()
        .patch('/api/invitations/nope/arrangement')
        .set('Authorization', authorization)
        .send({ blocks: [{ type: 'HERO' }] })
        .expect(404);
    });
  });
});
