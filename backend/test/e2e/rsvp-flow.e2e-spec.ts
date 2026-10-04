import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, RsvpStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
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
    app.setGlobalPrefix('api');
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

    const anonymous = await http().get(`/api/invitations/${slug}`).expect(200);
    expect(anonymous.body.guest).toBeNull();
    expect(anonymous.body.locale).toBe('hy');
    const { blocks } = anonymous.body as { blocks: { type: string }[] };
    expect(blocks.map((block) => block.type)).toEqual(['HERO', 'RSVP']);

    const personalized = await http()
      .get(`/api/invitations/${slug}/g/${primaryGuestToken}`)
      .expect(200);
    expect(personalized.body.guest.name).toBe('Primary Guest');
    expect(personalized.body.guest.household.seatsAllotted).toBe(2);
  });

  it('404s an unknown slug and an unpublished invitation', async () => {
    const draft = await seedEvent(prisma, { isPublished: false });

    await http().get('/api/invitations/does-not-exist').expect(404);
    await http().get(`/api/invitations/${draft.slug}`).expect(404);
  });

  it('accepts a response and reflects it in the operational views', async () => {
    const { slug, primaryGuestToken, eventId } = await seedEvent(prisma, { seatsAllotted: 2 });

    await http()
      .post(`/api/invitations/${slug}/g/${primaryGuestToken}/rsvp`)
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

    const headcount = await http().get(`/api/events/${eventId}/headcount`).expect(200);
    expect(headcount.body).toMatchObject({ invited: 2, attending: 2, declined: 0, responseRate: 100 });

    const catering = await http().get(`/api/events/${eventId}/catering-sheet`).expect(200);
    expect(catering.body.covers).toBe(2);
    expect(catering.body.requirements).toContainEqual({ requirement: 'vegan', count: 1 });

    const bar = await http().get(`/api/events/${eventId}/bar-sheet`).expect(200);
    expect(bar.body.preferences).toContainEqual({ drink: 'wine', guests: 1, share: 100 });

    const playlist = await http().get(`/api/events/${eventId}/playlist`).expect(200);
    expect(playlist.body.tracks).toContainEqual({ track: 'Sirun Yar', requests: 1 });

    const guestBook = await http().get(`/api/events/${eventId}/guest-book`).expect(200);
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
      .post(`/api/invitations/${slug}/g/${primaryGuestToken}/rsvp`)
      .send(payload)
      .expect(400);

    expect(Array.isArray(response.body.message)).toBe(true);
  });

  it('enforces household capacity over HTTP', async () => {
    const { slug, primaryGuestToken } = await seedEvent(prisma, { seatsAllotted: 1 });

    const response = await http()
      .post(`/api/invitations/${slug}/g/${primaryGuestToken}/rsvp`)
      .send({ status: RsvpStatus.ATTENDING, party: [{ firstName: 'TooMany' }] })
      .expect(400);

    expect(response.body.message).toContain('allows 1 guest(s)');
  });

  it('404s a response sent with an unknown guest token', async () => {
    const { slug } = await seedEvent(prisma);

    await http()
      .post(`/api/invitations/${slug}/g/unknown-token/rsvp`)
      .send({ status: RsvpStatus.ATTENDING })
      .expect(404);
  });
});
