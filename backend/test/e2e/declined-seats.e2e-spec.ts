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
 * B29: a guest who declined kept their seat, and it still counted against
 * the table. Decided 9 October 2026: declining frees the seat automatically,
 * and the plan flags where it was until the host seats someone again.
 */
describe('A seat freed by a decline (e2e)', () => {
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

  /** The fixture's primary guest, attending and seated at Table 3. */
  const seated = async () => {
    const seeded = await seedEvent(prisma);
    const { eventId } = seeded;
    const { authorization } = await authenticateAs(app, prisma, { eventId, role: EventRole.COORDINATOR });
    const guest = await prisma.guest.findFirstOrThrow({ where: { eventId, isPrimary: true } });
    await prisma.rsvp.update({ where: { guestId: guest.id }, data: { status: 'ATTENDING' } });
    const table = await prisma.table.create({ data: { eventId, name: 'Table 3', capacity: 8 } });
    await prisma.seat.create({ data: { tableId: table.id, guestId: guest.id } });
    return { ...seeded, authorization, guestId: guest.id, tableId: table.id };
  };

  const answer = (slug: string, token: string, status: string) =>
    http().post(`/api/v1/invitations/${slug}/g/${token}/rsvp`).send({ status }).expect(201);

  const tables = async (eventId: string, authorization: string) =>
    (await http().get(`/api/v1/events/${eventId}/tables`).set('Authorization', authorization).expect(200)).body as {
      name: string;
      seated: number;
      released: { guestId: string; name: string; releasedAt: string }[];
    }[];

  it('frees the seat when the guest declines, and flags it on the plan', async () => {
    const { eventId, slug, primaryGuestToken, authorization, guestId } = await seated();

    await answer(slug, primaryGuestToken, 'DECLINED');

    const [table] = await tables(eventId, authorization);
    expect(table).toMatchObject({ name: 'Table 3', seated: 0 });
    expect(table.released).toEqual([{ guestId, name: 'Primary Guest', releasedAt: expect.any(String) }]);
  });

  it('says on the guest list which table they were released from', async () => {
    const { eventId, slug, primaryGuestToken, authorization, guestId } = await seated();
    await answer(slug, primaryGuestToken, 'DECLINED');

    const { body } = await http().get(`/api/v1/events/${eventId}/guests/${guestId}`).set('Authorization', authorization).expect(200);

    expect(body.table).toBeNull();
    expect(body.seatReleased).toEqual({ table: 'Table 3', releasedAt: expect.any(String) });
  });

  it.each(['ATTENDING', 'UNDECIDED'])('keeps the seat of a guest who answers %s', async (status) => {
    const { eventId, slug, primaryGuestToken, authorization } = await seated();

    await answer(slug, primaryGuestToken, status);

    const [table] = await tables(eventId, authorization);
    expect(table).toMatchObject({ seated: 1, released: [] });
  });

  it('clears the flag when the host seats them again', async () => {
    const { eventId, slug, primaryGuestToken, authorization, guestId, tableId } = await seated();
    await answer(slug, primaryGuestToken, 'DECLINED');

    await http().post(`/api/v1/events/${eventId}/seats`).set('Authorization', authorization).send({ guestId, tableId }).expect(201);

    const [table] = await tables(eventId, authorization);
    expect(table).toMatchObject({ seated: 1, released: [] });
  });

  it('lets the host dismiss the flag without seating them', async () => {
    const { eventId, slug, primaryGuestToken, authorization, guestId } = await seated();
    await answer(slug, primaryGuestToken, 'DECLINED');

    await http().delete(`/api/v1/events/${eventId}/seats/${guestId}`).set('Authorization', authorization).expect(200);

    const [table] = await tables(eventId, authorization);
    expect(table.released).toEqual([]);
  });
});
