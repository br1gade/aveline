import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * A host asks "meat or fish?" and needs the count. Answers to a host's own
 * questions used to be stored and shown only to the guest who gave them — no
 * sheet, no export. Answered here the way guests answer, over the public RSVP
 * endpoint, and read the way a host reads them.
 */
describe('Answers to the host’s questions (e2e)', () => {
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

  /** The Petrosyans answer: Armen fish and the shuttle, Lusine meat and a note. */
  const answered = async (role: EventRole = EventRole.COORDINATOR) => {
    const seeded = await seedEvent(prisma, { seatsAllotted: 3 });
    const { authorization } = await authenticateAs(app, prisma, { eventId: seeded.eventId, role });
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: seeded.slug } });
    const ask = (data: Record<string, unknown>) =>
      prisma.rsvpQuestion.create({ data: { invitationId: invitation.id, ...data } as never });
    const meal = await ask({
      type: 'SINGLE_CHOICE',
      required: true,
      sortOrder: 0,
      prompt: { hy: 'Միս թե ձուկ', en: 'Meat or fish?' },
      options: { hy: ['Միս', 'Ձուկ'], en: ['Meat', 'Fish'] },
    });
    const shuttle = await ask({ type: 'BOOLEAN', sortOrder: 1, prompt: { en: 'Shuttle from Yerevan?' } });
    const lusine = await prisma.guest.create({
      data: {
        eventId: seeded.eventId,
        householdId: seeded.householdId,
        firstName: 'Lusine',
        token: `lusine-${seeded.slug}`,
        rsvp: { create: {} },
      },
    });

    await http()
      .post(`/api/v1/invitations/${seeded.slug}/g/${seeded.primaryGuestToken}/rsvp`)
      .send({
        status: 'ATTENDING',
        answers: [
          { questionId: meal.id, value: 1 },
          { questionId: shuttle.id, value: true },
        ],
        members: [
          {
            guestId: lusine.id,
            status: 'ATTENDING',
            dietaryNotes: 'severe nut allergy',
            answers: [{ questionId: meal.id, value: 0 }],
          },
        ],
      })
      .expect(201);

    return { ...seeded, authorization, mealId: meal.id, shuttleId: shuttle.id };
  };

  const exportCsv = async (eventId: string, authorization: string, kind: string) => {
    const { body } = await http()
      .post(`/api/v1/events/${eventId}/exports`)
      .set('Authorization', authorization)
      .send({ kind })
      .expect(201);
    const file = await fetch(body.asset.url as string);
    return file.text();
  };

  it('counts each option among those coming, in the host’s language', async () => {
    const { eventId, authorization, mealId, shuttleId } = await answered();

    const { body } = await http()
      .get(`/api/v1/events/${eventId}/answers`)
      .query({ locale: 'en' })
      .set('Authorization', authorization)
      .expect(200);

    expect(body.locale).toBe('en');
    const questions = body.questions as { id: string; responses: unknown[]; tally: unknown }[];
    const meal = questions.find((q) => q.id === mealId);
    expect(meal).toMatchObject({
      prompt: 'Meat or fish?',
      options: ['Meat', 'Fish'],
      answered: 2,
      tally: [
        { option: 'Meat', attending: 1, total: 1 },
        { option: 'Fish', attending: 1, total: 1 },
      ],
    });
    expect(meal?.responses).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Lusine', status: 'ATTENDING', value: 0, display: 'Meat' })]),
    );
    const shuttle = questions.find((q) => q.id === shuttleId);
    expect(shuttle?.tally).toEqual([
      { option: 'Yes', attending: 1, total: 1 },
      { option: 'No', attending: 0, total: 0 },
    ]);
  });

  it('puts every answer, as words, in the guest-list export — with the dietary notes', async () => {
    const { eventId, authorization } = await answered();

    const csv = await exportCsv(eventId, authorization, 'GUEST_LIST');

    expect(csv).toContain('Q1: Միս թե ձուկ');
    expect(csv).toContain('Dietary notes');
    expect(csv).toContain('severe nut allergy');
    expect(csv).toContain('Ձուկ');
  });

  // The allergy was on screen and missing from the file the venue receives.
  it('puts dietary notes in the catering export handed to the venue', async () => {
    const { eventId, authorization } = await answered();

    const csv = await exportCsv(eventId, authorization, 'CATERING_SHEET');

    expect(csv).toContain('severe nut allergy');
  });

  it('refuses a designer, who has no operational sheets', async () => {
    const { eventId, authorization } = await answered(EventRole.DESIGNER);

    await http().get(`/api/v1/events/${eventId}/answers`).set('Authorization', authorization).expect(403);
  });
});
