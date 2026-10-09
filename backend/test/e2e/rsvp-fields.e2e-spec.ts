import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, PrismaClient, EventVisibility } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * A host with no bar should not ask about drinks; a host with one needs to
 * count them. Every built-in question used to be asked, as free text — so
 * "Wine", "Вино" and "Գինի" were three rows on the bar sheet.
 */
describe('Configuring the built-in RSVP questions (e2e)', () => {
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

  const DRINKS = {
    drinkPreference: {
      options: [
        { key: 'wine', label: { hy: 'Գինի', en: 'Wine', ru: 'Вино' } },
        { key: 'soft', label: { hy: 'Ոչ ալկոհոլային', en: 'Soft drinks' } },
      ],
    },
    songRequest: { isEnabled: false },
  };

  const configured = async (role: EventRole = EventRole.COORDINATOR) => {
    const seeded = await seedEvent(prisma, { seatsAllotted: 3, visibility: EventVisibility.UNLISTED });
    const { authorization } = await authenticateAs(app, prisma, { eventId: seeded.eventId, role });
    return { ...seeded, authorization };
  };

  const configure = (slug: string, authorization: string, body: Record<string, unknown>) =>
    http().patch(`/api/v1/invitations/${slug}/rsvp-fields`).set('Authorization', authorization).send(body);

  const answer = (slug: string, token: string, body: Record<string, unknown>) =>
    http().post(`/api/v1/invitations/${slug}/g/${token}/rsvp`).send(body);

  it('shows guests the questions as configured, choices labelled in their language', async () => {
    const { slug, authorization } = await configured();
    await configure(slug, authorization, DRINKS).expect(200);

    const { body } = await http().get(`/api/v1/invitations/${slug}`).query({ locale: 'en' }).expect(200);

    expect(body.rsvpFields).toMatchObject({
      drinkPreference: { isEnabled: true, options: [{ key: 'wine', label: 'Wine' }, { key: 'soft', label: 'Soft drinks' }] },
      songRequest: { isEnabled: false, options: null },
      dietary: { isEnabled: true, options: null },
    });
  });

  it('counts one drink as one row, whatever language each guest answered in', async () => {
    const { eventId, slug, householdId, primaryGuestToken, authorization } = await configured();
    await configure(slug, authorization, DRINKS).expect(200);
    const lusine = await prisma.guest.create({
      data: { eventId, householdId, firstName: 'Lusine', locale: 'ru', token: `lusine-${slug}`, rsvp: { create: {} } },
    });

    await answer(slug, primaryGuestToken, { status: 'ATTENDING', drinkPreference: 'wine' }).expect(201);
    await answer(slug, lusine.token, { status: 'ATTENDING', drinkPreference: 'wine' }).expect(201);

    const { body } = await http().get(`/api/v1/events/${eventId}/bar-sheet`).set('Authorization', authorization).expect(200);
    expect(body.preferences).toEqual([{ drink: 'Գինի', key: 'wine', guests: 2, share: 100 }]);
  });

  it.each([
    [{ drinkPreference: 'Wine' }, /^drinkPreference: choose from wine, soft/],
    [{ songRequest: 'Sirun Yar' }, /^songRequest: this invitation does not ask/],
  ])('refuses %j from a guest, naming the field', async (extra, message) => {
    const { slug, primaryGuestToken, authorization } = await configured();
    await configure(slug, authorization, DRINKS).expect(200);

    const { body } = await answer(slug, primaryGuestToken, { status: 'ATTENDING', ...extra }).expect(400);

    expect(body.message).toMatch(message);
  });

  it('holds a household member’s dietary choices to the same list', async () => {
    const { eventId, slug, householdId, primaryGuestToken, authorization } = await configured();
    await configure(slug, authorization, {
      dietary: { options: [{ key: 'vegan', label: { en: 'Vegan' } }, { key: 'halal', label: { en: 'Halal' } }] },
    }).expect(200);
    const lusine = await prisma.guest.create({
      data: { eventId, householdId, firstName: 'Lusine', token: `lusine-${slug}`, rsvp: { create: {} } },
    });

    const { body } = await answer(slug, primaryGuestToken, {
      status: 'ATTENDING',
      members: [{ guestId: lusine.id, status: 'ATTENDING', dietary: ['pescatarian'] }],
    }).expect(400);

    expect(body.message).toMatch(/^members: .*dietary: choose from vegan, halal/);
  });

  it('changes one question without touching the others', async () => {
    const { slug, authorization } = await configured();
    await configure(slug, authorization, DRINKS).expect(200);

    const { body } = await configure(slug, authorization, { dietary: { isEnabled: false } }).expect(200);

    expect(body.drinkPreference.options).toHaveLength(2);
    expect(body.dietary).toEqual({ isEnabled: false, options: null });
    expect(body.songRequest).toEqual({ isEnabled: false, options: null });
  });

  it.each([
    [{ shoeSize: { isEnabled: false } }, /shoeSize/],
    [{ drinkPreference: { options: [{ key: 'Red Wine', label: { en: 'Red' } }] } }, /^drinkPreference: /],
  ])('refuses a configuration %j, naming the field', async (body, message) => {
    const { slug, authorization } = await configured();

    const response = await configure(slug, authorization, body).expect(400);

    expect(JSON.stringify(response.body.message)).toMatch(message.source.replace('^', ''));
  });

  it('refuses a viewer', async () => {
    const { slug, authorization } = await configured(EventRole.VIEWER);

    await configure(slug, authorization, DRINKS).expect(403);
  });
});
