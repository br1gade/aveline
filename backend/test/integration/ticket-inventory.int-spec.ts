import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TicketInventoryService } from '../../src/modules/ticketing/ticket-inventory.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Overselling is a correctness failure, not a race to be tolerated: it sells
 * a seat that does not exist and is discovered at the door. These tests run
 * real concurrent transactions against real Postgres, because a mocked client
 * would only confirm our assumptions about isolation rather than test them.
 */
describe('TicketInventoryService (integration)', () => {
  let prisma: PrismaClient;
  let service: TicketInventoryService;
  let eventId: string;

  const makeType = (quantityTotal: number) =>
    prisma.ticketType.create({
      data: { eventId, name: { en: 'General' }, priceMinor: 5000n, quantityTotal, maxPerOrder: 100 },
    });

  beforeAll(() => {
    prisma = testPrisma();
    service = new TicketInventoryService(prisma as unknown as PrismaService);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    ({ eventId } = await seedEvent(prisma));
  });

  afterAll(() => disconnectTestDatabase());

  describe('reserving', () => {
    it('holds inventory and reports what remains', async () => {
      const type = await makeType(10);

      await service.reserve(type.id, 3);

      const after = await prisma.ticketType.findUniqueOrThrow({ where: { id: type.id } });
      expect(after.quantityReserved).toBe(3);
      expect(after.quantitySold).toBe(0);
      expect(await service.availableFor(type.id)).toBe(7);
    });

    // Boundary set: the last seat, and one past it.
    it('allows a reservation that takes exactly the last seat', async () => {
      const type = await makeType(5);

      await expect(service.reserve(type.id, 5)).resolves.toBeUndefined();
      expect(await service.availableFor(type.id)).toBe(0);
    });

    it.each([6, 50])('refuses %p when only 5 exist', async (request) => {
      const type = await makeType(5);

      await expect(service.reserve(type.id, request)).rejects.toBeInstanceOf(ConflictException);
      expect(await service.availableFor(type.id)).toBe(5);
    });

    it.each([0, -1])('refuses a quantity of %p', async (quantity) => {
      const type = await makeType(10);
      await expect(service.reserve(type.id, quantity)).rejects.toBeInstanceOf(ConflictException);
    });

    /**
     * The test this whole module exists for. Ten buyers race for five seats;
     * exactly five must win.
     */
    it('never oversells when many buyers race for the last seats', async () => {
      const type = await makeType(5);

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => service.reserve(type.id, 1)),
      );

      const won = results.filter((r) => r.status === 'fulfilled').length;
      expect(won).toBe(5);

      const after = await prisma.ticketType.findUniqueOrThrow({ where: { id: type.id } });
      expect(after.quantityReserved).toBe(5);
      expect(after.quantitySold + after.quantityReserved).toBeLessThanOrEqual(after.quantityTotal);
    });

    it('never oversells with mixed basket sizes', async () => {
      const type = await makeType(10);

      await Promise.allSettled([
        service.reserve(type.id, 4),
        service.reserve(type.id, 4),
        service.reserve(type.id, 4),
        service.reserve(type.id, 3),
      ]);

      const after = await prisma.ticketType.findUniqueOrThrow({ where: { id: type.id } });
      expect(after.quantityReserved).toBeLessThanOrEqual(10);
    });
  });

  describe('settling a reservation', () => {
    it('converts a hold into a sale without changing the total held', async () => {
      const type = await makeType(10);
      await service.reserve(type.id, 4);

      await service.commit(type.id, 4);

      const after = await prisma.ticketType.findUniqueOrThrow({ where: { id: type.id } });
      expect(after.quantityReserved).toBe(0);
      expect(after.quantitySold).toBe(4);
      expect(await service.availableFor(type.id)).toBe(6);
    });

    it('returns inventory when a hold is released', async () => {
      const type = await makeType(10);
      await service.reserve(type.id, 4);

      await service.release(type.id, 4);

      expect(await service.availableFor(type.id)).toBe(10);
    });

    it('refuses to commit more than is held', async () => {
      const type = await makeType(10);
      await service.reserve(type.id, 2);

      await expect(service.commit(type.id, 3)).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to release more than is held', async () => {
      const type = await makeType(10);
      await service.reserve(type.id, 2);

      await expect(service.release(type.id, 3)).rejects.toBeInstanceOf(ConflictException);
    });

    it('a sold-out tier reports zero rather than a negative number', async () => {
      const type = await makeType(2);
      await service.reserve(type.id, 2);
      await service.commit(type.id, 2);

      expect(await service.availableFor(type.id)).toBe(0);
      await expect(service.reserve(type.id, 1)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
