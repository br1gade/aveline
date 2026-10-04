import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Ticket inventory.
 *
 * Overselling is a correctness failure, not a race to be tolerated: it sells
 * a seat that does not exist and the customer finds out at the door. So every
 * mutation here is a SINGLE conditional UPDATE whose WHERE clause carries the
 * invariant. Postgres evaluates the predicate and the write atomically, so two
 * concurrent buyers cannot both see room for the last seat.
 *
 * What this deliberately does NOT do:
 *   - read the row, decide in Node, then write. That is the bug.
 *   - take a row lock. Correct, but serialises every buyer on a popular tier.
 *
 * `prisma/migrations/...ticketing.../migration.sql` adds CHECK constraints as
 * a backstop, so even a future code path that writes the counters directly
 * cannot breach capacity.
 */
@Injectable()
export class TicketInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Holds `quantity` seats for an in-flight checkout. */
  async reserve(ticketTypeId: string, quantity: number): Promise<void> {
    assertPositive(quantity);

    const updated = await this.prisma.$executeRaw`
      UPDATE "ticket_types"
         SET "quantityReserved" = "quantityReserved" + ${quantity},
             "updatedAt" = NOW()
       WHERE "id" = ${ticketTypeId}
         AND "isActive" = true
         AND "quantitySold" + "quantityReserved" + ${quantity} <= "quantityTotal"
    `;

    if (updated === 0) await this.explainFailure(ticketTypeId, quantity);
  }

  /** Turns a hold into a sale once payment settles. */
  async commit(ticketTypeId: string, quantity: number): Promise<void> {
    assertPositive(quantity);

    const updated = await this.prisma.$executeRaw`
      UPDATE "ticket_types"
         SET "quantityReserved" = "quantityReserved" - ${quantity},
             "quantitySold" = "quantitySold" + ${quantity},
             "updatedAt" = NOW()
       WHERE "id" = ${ticketTypeId}
         AND "quantityReserved" >= ${quantity}
    `;

    if (updated === 0) {
      throw new ConflictException(
        `Cannot commit ${quantity} ticket(s): fewer are currently held`,
      );
    }
  }

  /** Returns a hold to the pool when a checkout is abandoned or expires. */
  async release(ticketTypeId: string, quantity: number): Promise<void> {
    assertPositive(quantity);

    const updated = await this.prisma.$executeRaw`
      UPDATE "ticket_types"
         SET "quantityReserved" = "quantityReserved" - ${quantity},
             "updatedAt" = NOW()
       WHERE "id" = ${ticketTypeId}
         AND "quantityReserved" >= ${quantity}
    `;

    if (updated === 0) {
      throw new ConflictException(
        `Cannot release ${quantity} ticket(s): fewer are currently held`,
      );
    }
  }

  async availableFor(ticketTypeId: string): Promise<number> {
    const type = await this.prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
      select: { quantityTotal: true, quantitySold: true, quantityReserved: true },
    });
    if (!type) throw new NotFoundException(`No ticket type ${ticketTypeId}`);

    return Math.max(0, type.quantityTotal - type.quantitySold - type.quantityReserved);
  }

  /**
   * A zero-row update is ambiguous — missing, inactive, or sold out — so the
   * reason is looked up only on the failure path, where an extra query costs
   * nothing and a vague error costs a support ticket.
   */
  private async explainFailure(ticketTypeId: string, quantity: number): Promise<never> {
    const type = await this.prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
      select: { isActive: true, quantityTotal: true, quantitySold: true, quantityReserved: true },
    });

    if (!type) throw new NotFoundException(`No ticket type ${ticketTypeId}`);
    if (!type.isActive) throw new ConflictException('This ticket type is not on sale');

    const available = type.quantityTotal - type.quantitySold - type.quantityReserved;
    throw new ConflictException(
      `Only ${Math.max(0, available)} ticket(s) remain; ${quantity} were requested`,
    );
  }
}

function assertPositive(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ConflictException('Ticket quantity must be a positive whole number');
  }
}
