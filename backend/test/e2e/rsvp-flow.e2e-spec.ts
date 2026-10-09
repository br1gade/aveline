import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, RsvpStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * E2E scope: the whole stack over HTTP, exactly as a guest's browser and an
 * organizer's dashboard would reach it. This is where validation pipes, status
 * codes and response shapes are the subject — not business rules, which the
 * integration layer already covers.
 */
describe('RSVP flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  /** Typed accessor — keeps supertest from degrading every call to `any`. */
  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    prisma = testPrisma();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  beforeEach(() => resetTestDatabase());

  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  it('serves a published invitation and personalizes it for a guest', async () => {
    const { slug, primaryGuestToken } = await seedEvent(prisma);

    const anonymous = await http().get(`/api/v1/invitations/${slug}`).expect(200);
    expect(anonymous.body.guest).toBeNull();
    expect(anonymous.body.locale).toBe('hy');
    const { blocks } = anonymous.body as { blocks: { type: string }[] };
    expect(blocks.map((block) => block.type)).toEqual(['HERO', 'RSVP']);

    const personalized = await http()
      .get(`/api/v1/invitations/${slug}/g/${primaryGuestToken}`)
      .expect(200);
    expect(personalized.body.guest.name).toBe('Primary Guest');
    expect(personalized.body.guest.household.seatsAllotted).toBe(2);
  });

  it('404s an unknown slug and an unpublished invitation', async () => {
    const draft = await seedEvent(prisma, { isPublished: false });

    await http().get('/api/v1/invitations/does-not-exist').expect(404);
    await http().get(`/api/v1/invitations/${draft.slug}`).expect(404);
  });

  it('accepts a response and reflects it in the operational views', async () => {
    const { slug, primaryGuestToken, eventId } = await seedEvent(prisma, { seatsAllotted: 2 });

    await http()
      .post(`/api/v1/invitations/${slug}/g/${primaryGuestToken}/rsvp`)
      .send({
        status: RsvpStatus.ATTENDING,
        attribution: 'SIDE_A',
        party: [{ firstName: 'Companion' }],
        dietary: ['vegan'],
        drinkPreference: 'wine',
        songRequest: 'Sirun Yar',
        message: 'Congratulations',
      })
      .expect(201);

    const { authorization } = await authenticateAs(app, prisma, { eventId });
    const headcount = await http()
      .get(`/api/v1/events/${eventId}/headcount`)
      .set('Authorization', authorization)
      .expect(200);
    expect(headcount.body).toMatchObject({ invited: 2, attending: 2, declined: 0, responseRate: 100 });

    const catering = await http()
      .get(`/api/v1/events/${eventId}/catering-sheet`)
      .set('Authorization', authorization)
      .expect(200);
    expect(catering.body.covers).toBe(2);
    expect(catering.body.requirements).toContainEqual({ requirement: 'vegan', key: 'vegan', count: 1 });

    const bar = await http()
      .get(`/api/v1/events/${eventId}/bar-sheet`)
      .set('Authorization', authorization)
      .expect(200);
    expect(bar.body.preferences).toContainEqual({ drink: 'wine', key: 'wine', guests: 1, share: 100 });

    const playlist = await http()
      .get(`/api/v1/events/${eventId}/playlist`)
      .set('Authorization', authorization)
      .expect(200);
    expect(playlist.body.tracks).toContainEqual({ track: 'Sirun Yar', requests: 1 });

    const guestBook = await http()
      .get(`/api/v1/events/${eventId}/guest-book`)
      .set('Authorization', authorization)
      .expect(200);
    expect(guestBook.body[0]).toMatchObject({ from: 'Primary Guest', message: 'Congratulations' });
  });

  // Output range: every rejected payload must be a 400 naming the bad field,
  // never a 500 and never a silent coercion.
  it.each([
    { label: 'unknown status', payload: { status: 'MAYBE' } },
    { label: 'missing status', payload: { dietary: ['vegan'] } },
    { label: 'unknown field', payload: { status: 'ATTENDING', nickname: 'x' } },
    { label: 'oversized party', payload: { status: 'ATTENDING', party: Array.from({ length: 21 }, () => ({ firstName: 'x' })) } },
  ])('rejects $label with 400', async ({ payload }) => {
    const { slug, primaryGuestToken } = await seedEvent(prisma);

    const response = await http()
      .post(`/api/v1/invitations/${slug}/g/${primaryGuestToken}/rsvp`)
      .send(payload)
      .expect(400);

    expect(Array.isArray(response.body.message)).toBe(true);
  });

  it('enforces household capacity over HTTP', async () => {
    const { slug, primaryGuestToken } = await seedEvent(prisma, { seatsAllotted: 1 });

    const response = await http()
      .post(`/api/v1/invitations/${slug}/g/${primaryGuestToken}/rsvp`)
      .send({ status: RsvpStatus.ATTENDING, party: [{ firstName: 'TooMany' }] })
      .expect(400);

    expect(response.body.message).toContain('allows 1 guest(s)');
  });

  /**
   * The bug this pins: `value` had no validation decorator, so the global
   * whitelist rejected every answer to a host's own question — any RSVP that
   * answered "Meat or fish?" failed with a 400 the guest could do nothing
   * about. Only reachable over HTTP, which is why it went unnoticed.
   */
  describe('a household answering together', () => {
    const household = async () => {
      const seeded = await seedEvent(prisma, { seatsAllotted: 3 });
      const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: seeded.slug } });
      const meal = await prisma.rsvpQuestion.create({
        data: {
          invitationId: invitation.id,
          type: 'SINGLE_CHOICE',
          required: true,
          prompt: { en: 'Meat or fish?' },
          options: { en: ['Meat', 'Fish'] },
        },
      });
      const lusine = await prisma.guest.create({
        data: {
          eventId: seeded.eventId,
          householdId: seeded.householdId,
          firstName: 'Lusine',
          token: `lusine-${seeded.slug}`,
          rsvp: { create: {} },
        },
      });
      const rsvpUrl = `/api/v1/invitations/${seeded.slug}/g/${seeded.primaryGuestToken}/rsvp`;
      return { ...seeded, mealId: meal.id, lusineId: lusine.id, rsvpUrl };
    };

    it('answers a custom question and the rest of the household in one request', async () => {
      const { rsvpUrl, mealId, lusineId } = await household();

      const { body } = await http()
        .post(rsvpUrl)
        .send({
          status: RsvpStatus.ATTENDING,
          answers: [{ questionId: mealId, value: 1 }],
          members: [{ guestId: lusineId, status: RsvpStatus.DECLINED }],
        })
        .expect(201);

      expect(body).toMatchObject({ status: 'ATTENDING', membersAnswered: 1, partyAdded: 0 });
      const current = await http().get(rsvpUrl).expect(200);
      expect(current.body.rsvp.answers).toEqual([{ questionId: mealId, value: 1 }]);
      expect(current.body.household.members).toEqual([
        expect.objectContaining({ id: lusineId, firstName: 'Lusine', status: 'DECLINED' }),
      ]);
    });

    it.each([
      { label: 'a choice by its text', body: (q: string) => ({ status: 'ATTENDING', answers: [{ questionId: q, value: 'Fish' }] }) },
      { label: 'a required question left out', body: () => ({ status: 'ATTENDING' }) },
    ])('refuses $label with a 400 naming answers', async ({ body }) => {
      const { rsvpUrl, mealId } = await household();

      const response = await http().post(rsvpUrl).send(body(mealId)).expect(400);

      expect(response.body.message).toMatch(/^answers: /);
    });

    it('refuses PENDING as an answer for a household member', async () => {
      const { rsvpUrl, lusineId } = await household();

      const response = await http()
        .post(rsvpUrl)
        .send({ status: 'DECLINED', members: [{ guestId: lusineId, status: 'PENDING' }] })
        .expect(400);

      expect(JSON.stringify(response.body.message)).toContain('members');
    });
  });

  it('404s a response sent with an unknown guest token', async () => {
    const { slug } = await seedEvent(prisma);

    await http()
      .post(`/api/v1/invitations/${slug}/g/unknown-token/rsvp`)
      .send({ status: RsvpStatus.ATTENDING })
      .expect(404);
  });
});
