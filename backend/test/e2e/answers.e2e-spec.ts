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
    const file = await http().get(body.downloadPath as string).set('Authorization', authorization).expect(200);
    return file.text;
  };

  it('pages question summaries and answers while keeping complete option counts', async () => {
    const { eventId, authorization, mealId, primaryGuestToken } = await answered();
    const base = `/api/v1/events/${eventId}/answers/questions`;
    const summary = await http().get(base).query({ locale: 'en', limit: 1 }).set('Authorization', authorization).expect(200);
    expect(summary.body).toMatchObject({ locale: 'en', total: 2, limit: 1, offset: 0, hasMore: true });
    expect(summary.body.items).toEqual([expect.objectContaining({ id: mealId, answered: 2, tally: [
      { option: 'Meat', attending: 1, total: 1 }, { option: 'Fish', attending: 1, total: 1 },
    ] })]);
    const first = await http().get(`${base}/${mealId}/responses`).query({ locale: 'en', limit: 1 }).set('Authorization', authorization).expect(200);
    const next = await http().get(`${base}/${mealId}/responses`).query({ locale: 'en', limit: 1, offset: 1 }).set('Authorization', authorization).expect(200);
    expect(first.body).toMatchObject({ questionId: mealId, total: 2, hasMore: true });
    expect(next.body).toMatchObject({ questionId: mealId, total: 2, hasMore: false });
    expect((first.body.items as { guestId: string }[])[0].guestId).not.toBe((next.body.items as { guestId: string }[])[0].guestId);
    expect(JSON.stringify(first.body)).not.toContain(primaryGuestToken);
    await http().get(base).query({ limit: 101 }).set('Authorization', authorization).expect(400);
  });

  it('localizes boolean reports and keeps questions inside their event scope', async () => {
    const { eventId, authorization, shuttleId } = await answered();
    const base = `/api/v1/events/${eventId}/answers/questions`;
    const result = await http().get(`${base}/${shuttleId}/responses`).query({ locale: 'hy' }).set('Authorization', authorization).expect(200);
    expect(result.body).toMatchObject({ locale: 'hy', items: [expect.objectContaining({ display: 'Այո' })] });
    const legacy = await http().get(`/api/v1/events/${eventId}/answers`).query({ locale: 'hy' }).set('Authorization', authorization).expect(200);
    expect(legacy.body.questions).toEqual(expect.arrayContaining([expect.objectContaining({
      id: shuttleId, tally: [{ option: 'Այո', attending: 1, total: 1 }, { option: 'Ոչ', attending: 0, total: 0 }],
      responses: [expect.objectContaining({ display: 'Այո' })],
    })]));
    const other = await seedEvent(prisma);
    const foreignQuestion = await prisma.rsvpQuestion.create({ data: { invitation: { connect: { slug: other.slug } }, type: 'TEXT', prompt: { en: 'Private' } } });
    await http().get(`${base}/${foreignQuestion.id}/responses`).set('Authorization', authorization).expect(404);
    await http().get(`/api/v1/events/${other.eventId}/answers/questions/${shuttleId}/responses`).set('Authorization', authorization).expect(403);
    await http().get(`${base}/missing-question/responses`).set('Authorization', authorization).expect(404);
  });

  it('counts multiple choices, declined and false answers in SQL while excluding erased people', async () => {
    const { eventId, slug, authorization, householdId, shuttleId } = await answered();
    const guests = await prisma.guest.findMany({ where: { eventId }, orderBy: { isPrimary: 'desc' } });
    const multiple = await prisma.rsvpQuestion.create({ data: { invitation: { connect: { slug } }, type: 'MULTI_CHOICE',
      prompt: { en: 'Extras' }, options: { en: ['Shuttle', 'Hotel'] } } });
    await prisma.rsvp.update({ where: { guestId: guests[0].id }, data: { status: 'DECLINED', answers: {
      updateMany: { where: { questionId: shuttleId }, data: { value: false } },
      create: { questionId: multiple.id, value: [0, 1] },
    } } });
    await prisma.rsvpAnswer.create({ data: { rsvp: { connect: { guestId: guests[1].id } }, question: { connect: { id: multiple.id } }, value: [1] } });
    await prisma.guest.create({ data: { eventId, householdId, firstName: 'Erased', token: 'erased-report-test', anonymizedAt: new Date('2026-11-01T00:00:00Z'),
      rsvp: { create: { status: 'ATTENDING', answers: { create: [
        { questionId: multiple.id, value: [0] }, { questionId: shuttleId, value: true },
      ] } } } } });
    const { body } = await http().get(`/api/v1/events/${eventId}/answers/questions`).query({ locale: 'en' }).set('Authorization', authorization).expect(200);
    expect(body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: multiple.id, answered: 2, tally: [
        { option: 'Shuttle', attending: 0, total: 1 }, { option: 'Hotel', attending: 1, total: 2 },
      ] }),
      expect.objectContaining({ id: shuttleId, answered: 1, tally: [
        { option: 'Yes', attending: 0, total: 0 }, { option: 'No', attending: 0, total: 1 },
      ] }),
    ]));
  });

  it('pages guest-book entries with undated messages last and no contact fields', async () => {
    const { eventId, authorization } = await answered();
    const guests = await prisma.guest.findMany({ where: { eventId }, orderBy: { firstName: 'asc' } });
    await prisma.rsvp.update({ where: { guestId: guests[0].id }, data: { message: 'Dated', respondedAt: new Date('2026-10-31T12:00:00Z') } });
    await prisma.rsvp.update({ where: { guestId: guests[1].id }, data: { message: 'Undated', respondedAt: null } });
    const path = `/api/v1/events/${eventId}/guest-book/entries`;
    const first = await http().get(path).query({ limit: 1 }).set('Authorization', authorization).expect(200);
    const next = await http().get(path).query({ limit: 1, offset: 1 }).set('Authorization', authorization).expect(200);
    expect(first.body).toMatchObject({ total: 2, hasMore: true, items: [expect.objectContaining({ message: 'Dated', at: '2026-10-31T12:00:00.000Z' })] });
    expect(next.body).toMatchObject({ total: 2, hasMore: false, items: [expect.objectContaining({ message: 'Undated', at: null })] });
    const legacy = await http().get(`/api/v1/events/${eventId}/guest-book`).set('Authorization', authorization).expect(200);
    expect(legacy.body).toEqual([{ from: expect.any(String), message: 'Dated', at: '2026-10-31T12:00:00.000Z' },
      { from: expect.any(String), message: 'Undated', at: null }]);
    expect(JSON.stringify(first.body)).not.toMatch(/"(?:email|phone|token)"/);
  });

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
