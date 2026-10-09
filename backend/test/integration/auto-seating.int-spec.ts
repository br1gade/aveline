import { PrismaClient, RsvpStatus } from '@prisma/client';
import { SeatingService } from '../../src/modules/seating/seating.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * B28: auto-seating read the room, planned, and wrote later without checking
 * again — so a planner seating someone by hand in between overfilled a table.
 * The gap is held open here on purpose, because over HTTP it is too narrow to
 * hit reliably and still real.
 */
describe('auto-seating alongside other seating (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = testPrisma();
  });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  /** The same database, with every transaction starting `ms` late. */
  const slowToCommit = (ms: number) =>
    new Proxy(prisma, {
      get(target, property, receiver) {
        if (property !== '$transaction') return Reflect.get(target, property, receiver) as unknown;
        return async (...args: Parameters<PrismaClient['$transaction']>) => {
          await new Promise((resolve) => setTimeout(resolve, ms));
          return (target.$transaction as (...a: unknown[]) => Promise<unknown>)(...args);
        };
      },
    });

  it('re-checks the table it writes to, so a guest seated by hand in the meantime is not overfilled', async () => {
    const { eventId } = await seedEvent(prisma);
    const table = await prisma.table.create({ data: { eventId, name: 'Table 1', capacity: 2 } });
    const attending = async (name: string) => {
      const household = await prisma.household.create({ data: { eventId, name, seatsAllotted: 1 } });
      return prisma.guest.create({
        data: { eventId, householdId: household.id, firstName: name, token: `${name}-${eventId}`, rsvp: { create: { status: RsvpStatus.ATTENDING } } },
      });
    };
    await attending('Ani');
    await attending('Aram');
    const household = await prisma.household.create({ data: { eventId, name: 'Narek', seatsAllotted: 1 } });
    const narek = await prisma.guest.create({ data: { eventId, householdId: household.id, firstName: 'Narek', token: `narek-${eventId}` } });

    const automatic = new SeatingService(slowToCommit(300) as unknown as PrismaService);
    const byHand = new SeatingService(prisma as unknown as PrismaService);

    const running = automatic.autoAssign(eventId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await byHand.assign(eventId, { guestId: narek.id, tableId: table.id });
    await running;

    expect(await prisma.seat.count({ where: { tableId: table.id } })).toBe(2);
  });
});
