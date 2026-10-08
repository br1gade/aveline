import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, MessageChannel, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * The grandmother who phones her answer in. Until now the only way an RSVP
 * was recorded was the guest's own link, so the host had nowhere to put it
 * and the headcount stayed wrong.
 */
describe('Recording an answer for a guest (e2e)', () => {
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

  const coordinator = async (role: EventRole = EventRole.COORDINATOR) => {
    const seeded = await seedEvent(prisma);
    const { authorization } = await authenticateAs(app, prisma, { eventId: seeded.eventId, role });
    const guest = await prisma.guest.findFirstOrThrow({ where: { eventId: seeded.eventId } });
    await prisma.guest.update({ where: { id: guest.id }, data: { email: 'grandma@test.local' } });
    return { ...seeded, authorization, guestId: guest.id };
  };

  const record = (eventId: string, guestId: string, authorization: string, body: Record<string, unknown>) =>
    http().patch(`/api/v1/events/${eventId}/guests/${guestId}/rsvp`).set('Authorization', authorization).send(body);

  it('records a phoned-in answer, and the headcount counts it', async () => {
    const { eventId, guestId, authorization } = await coordinator();

    const { body } = await record(eventId, guestId, authorization, {
      status: 'ATTENDING',
      dietary: ['vegetarian'],
      dietaryNotes: 'no salt, doctor’s orders',
    }).expect(200);

    expect(body).toMatchObject({ status: 'ATTENDING', dietary: ['vegetarian'], respondedAt: expect.any(String) });
    const headcount = await http().get(`/api/v1/events/${eventId}/headcount`).set('Authorization', authorization).expect(200);
    expect(headcount.body.attending).toBe(1);
  });

  it('keeps what the host left out', async () => {
    const { eventId, guestId, authorization } = await coordinator();
    await record(eventId, guestId, authorization, { status: 'ATTENDING', songRequest: 'Sirun Yar' }).expect(200);

    const { body } = await record(eventId, guestId, authorization, { status: 'DECLINED' }).expect(200);

    expect(body).toMatchObject({ status: 'DECLINED', songRequest: 'Sirun Yar' });
  });

  // She told the host on the phone; a message about it would be a surprise.
  it('sends the guest nothing unless the host asks', async () => {
    const { eventId, guestId, authorization } = await coordinator();
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    await prisma.messageTemplate.create({
      data: {
        organizationId: event.organizationId,
        key: 'rsvp.confirmation.attending',
        channel: MessageChannel.EMAIL,
        subject: { hy: 'Շնորհակալություն' },
        body: { hy: '{{guestName}} {{link}}' },
      },
    });

    await record(eventId, guestId, authorization, { status: 'ATTENDING' }).expect(200);
    expect(await prisma.message.count({ where: { guestId } })).toBe(0);

    await record(eventId, guestId, authorization, { status: 'ATTENDING', notifyGuest: true }).expect(200);
    expect(await prisma.message.count({ where: { guestId, templateKey: 'rsvp.confirmation.attending' } })).toBe(1);
  });

  it('checks answers to the host’s questions as the guest’s form does, naming answers', async () => {
    const { eventId, slug, guestId, authorization } = await coordinator();
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug } });
    const meal = await prisma.rsvpQuestion.create({
      data: {
        invitationId: invitation.id,
        type: 'SINGLE_CHOICE',
        required: true,
        prompt: { en: 'Meat or fish?' },
        options: { en: ['Meat', 'Fish'] },
      },
    });

    // Required is not enforced: the host may not know her meal yet.
    await record(eventId, guestId, authorization, { status: 'ATTENDING' }).expect(200);
    const refused = await record(eventId, guestId, authorization, {
      status: 'ATTENDING',
      answers: [{ questionId: meal.id, value: 'Fish' }],
    }).expect(400);
    expect(refused.body.message).toMatch(/^answers: /);

    await record(eventId, guestId, authorization, {
      status: 'ATTENDING',
      answers: [{ questionId: meal.id, value: 1 }],
    }).expect(200);
    const sheet = await http().get(`/api/v1/events/${eventId}/answers`).set('Authorization', authorization).expect(200);
    expect(sheet.body.questions[0].tally).toEqual([
      { option: 'Meat', attending: 0, total: 0 },
      { option: 'Fish', attending: 1, total: 1 },
    ]);
  });

  it('refuses a guest whose details were erased', async () => {
    const { eventId, guestId, authorization } = await coordinator();
    await prisma.guest.update({ where: { id: guestId }, data: { anonymizedAt: new Date() } });

    await record(eventId, guestId, authorization, { status: 'ATTENDING' }).expect(400);
  });

  it('404s a guest from another event', async () => {
    const { eventId, authorization } = await coordinator();
    const other = await coordinator();

    await record(eventId, other.guestId, authorization, { status: 'ATTENDING' }).expect(404);
  });

  it('refuses a designer', async () => {
    const { eventId, guestId, authorization } = await coordinator(EventRole.DESIGNER);

    await record(eventId, guestId, authorization, { status: 'ATTENDING' }).expect(403);
  });
});
