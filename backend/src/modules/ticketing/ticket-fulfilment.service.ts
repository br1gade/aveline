import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TicketOrderStatus, TicketStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PromoCodesService } from '../billing/promo-codes.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TicketInventoryService } from './ticket-inventory.service';
import { TicketNotifierService } from './ticket-notifier.service';

/**
 * Inventory movements and what follows from them.
 *
 * Holding seats, turning a hold into a sale, issuing the tickets, telling the
 * buyer, and giving everything back when a checkout is abandoned. Separated
 * from `TicketingService`, which orchestrates a purchase, because these are
 * the operations that must be exactly-once — and because a class that sells,
 * prices, allocates, admits and notifies had grown five collaborators, which
 * is the signal that it had stopped being about one thing.
 *
 * Every mutation here is claim-first, for the reason stated on each: the
 * failure mode is selling a seat twice or issuing a second valid ticket for
 * one paid seat.
 */
/**
 * What settlement returns: the order with its tickets.
 *
 * The tickets are included because for a free event the checkout response is
 * the moment the buyer sees them — it used to carry none, leaving them a
 * second request away from the thing they had just been given.
 */
const SETTLED_ORDER = {
  items: true,
  tickets: { select: { code: true, status: true } },
} as const;

@Injectable()
export class TicketFulfilmentService {
  private readonly logger = new Logger(TicketFulfilmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: TicketInventoryService,
    private readonly promoCodes: PromoCodesService,
    private readonly notifier: TicketNotifierService,
  ) {}

  /** Holds seats for an in-flight checkout, one line at a time. */
  async hold(items: { ticketTypeId: string; quantity: number }[]): Promise<void> {
    for (const line of items) {
      await this.inventory.reserve(line.ticketTypeId, line.quantity);
    }
  }

  async markPaid(orderId: string) {
    const order = await this.prisma.ticketOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: SETTLED_ORDER,
    });
    // Already settled: a retried callback or a refreshed return page. Nothing
    // is issued again; the confirmation is queued again, which its dedupe key
    // makes a no-op unless the first attempt to queue it failed.
    if (order.status === TicketOrderStatus.PAID) {
      await this.notifier.sendTickets(orderId);
      return order;
    }

    /**
     * Claiming, committing inventory and issuing tickets happen in one
     * transaction, with the claim first.
     *
     * The claim is a conditional update that only matches a RESERVED order,
     * so a second settlement — a retried callback, a user refreshing the
     * return page — matches nothing and issues no tickets. Ticket codes are
     * random, so without this guard a duplicate run would mint a second valid
     * set for one paid seat rather than failing on a constraint.
     *
     * Everything inside one transaction means a crash cannot leave inventory
     * sold with no tickets against it.
     */
    let wasIssued = false;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.ticketOrder.updateMany({
        where: { id: orderId, status: TicketOrderStatus.RESERVED },
        data: { status: TicketOrderStatus.PAID, reservesUntil: null },
      });
      if (claimed.count === 0) return;

      for (const item of order.items) {
        await this.inventory.commit(item.ticketTypeId, item.quantity, tx);
      }
      await tx.ticket.createMany({ data: this.ticketsFor(order) });
      wasIssued = true;
    });

    // Outside the transaction, and only when this call is the one that issued.
    // Queueing inside it would send a confirmation for a transaction that
    // then rolled back; doing it unconditionally would send a second copy on
    // every retried callback, because settlement is deliberately idempotent.
    if (wasIssued) await this.notifier.sendTickets(orderId);

    return this.prisma.ticketOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: SETTLED_ORDER,
    });
  }

  /**
   * Returns inventory held by checkouts that were never completed.
   *
   * Without this, every abandoned basket permanently removes seats from sale
   * and a popular event sells out to nobody.
   */
  async releaseExpiredReservations(limit = 100): Promise<{ released: number }> {
    const expired = await this.prisma.ticketOrder.findMany({
      where: { status: TicketOrderStatus.RESERVED, reservesUntil: { lt: new Date() } },
      include: { items: true },
      orderBy: { reservesUntil: 'asc' },
      take: limit,
    });

    let released = 0;
    for (const order of expired) {
      try {
        if (await this.expireOrder(order)) released += 1;
      } catch (error) {
        this.logger.warn(`could not release order ${order.id}: ${describeError(error)}`);
      }
    }

    return { released };
  }

  /**
   * Expires one abandoned checkout: marks it, returns its seats, and gives
   * back the promo redemption it took.
   *
   * All three in one transaction, claim first. The claim — a conditional
   * update matching only a RESERVED order — is what makes this safe to run
   * twice: a second sweep, or this endpoint called directly while the cron is
   * running, matches nothing and returns nothing. Without it, two passes would
   * return the same seats twice and oversell them, which is the one outcome
   * worse than holding inventory too long.
   */
  private async expireOrder(order: {
    id: string;
    promoCodeId: string | null;
    items: { ticketTypeId: string; quantity: number }[];
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.ticketOrder.updateMany({
        where: { id: order.id, status: TicketOrderStatus.RESERVED },
        data: { status: TicketOrderStatus.EXPIRED, reservesUntil: null },
      });
      if (claimed.count === 0) return false;

      for (const item of order.items) {
        await this.inventory.release(item.ticketTypeId, item.quantity, tx);
      }

      // An abandoned checkout must not burn a limited code — the next buyer
      // is entitled to it.
      await this.promoCodes.releaseClaim(order.promoCodeId, tx);
      return true;
    });
  }

  /**
   * Expires one order by id: a checkout that failed after its order was
   * written. Claim-first like the sweep, so the sweep finding it later
   * changes nothing — releasing the seats here and leaving the order RESERVED
   * had the sweep release them a second time.
   */
  async expire(orderId: string): Promise<boolean> {
    const order = await this.prisma.ticketOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    return this.expireOrder(order);
  }

  /**
   * Issues tickets for a payment that arrived after the order's hold lapsed
   * (decided 9 October 2026: issue them if the seats are still there, refund
   * if not). One transaction, claim first: the claim matches only an EXPIRED
   * order, so two settlements of one late payment issue one set.
   */
  async issueLate(orderId: string): Promise<'ISSUED' | 'SOLD_OUT' | 'NOT_EXPIRED'> {
    const order = await this.prisma.ticketOrder.findUniqueOrThrow({ where: { id: orderId }, include: SETTLED_ORDER });

    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.ticketOrder.updateMany({
          where: { id: orderId, status: TicketOrderStatus.EXPIRED },
          data: { status: TicketOrderStatus.PAID },
        });
        if (claimed.count === 0) return 'NOT_EXPIRED' as const;

        for (const item of order.items) {
          // Thrown to roll the claim back: some seats are not all seats.
          if (!(await this.inventory.sellLate(item.ticketTypeId, item.quantity, tx))) throw new SoldOut();
        }
        await tx.ticket.createMany({ data: this.ticketsFor(order) });
        return 'ISSUED' as const;
      });
      if (outcome === 'ISSUED') await this.notifier.sendTickets(orderId);
      return outcome;
    } catch (error) {
      if (error instanceof SoldOut) return 'SOLD_OUT';
      throw error;
    }
  }

  /**
   * Claims a late, sold-out order for refunding: EXPIRED to REFUNDED, once.
   * Returns false if another settlement got there first.
   */
  async claimLateRefund(orderId: string): Promise<boolean> {
    const claimed = await this.prisma.ticketOrder.updateMany({
      where: { id: orderId, status: TicketOrderStatus.EXPIRED },
      data: { status: TicketOrderStatus.REFUNDED },
    });
    return claimed.count === 1;
  }

  sendMissingNotices(): Promise<{ queued: number }> {
    return this.notifier.sendMissing();
  }

  /** Tells the buyer their late payment was refunded. Idempotent by its dedupe key. */
  notifyCancelled(orderId: string): Promise<void> {
    return this.notifier.sendCancellation(orderId);
  }

  /** Puts a late order back to EXPIRED when the bank refused its refund, so the sweep tries again. */
  async reopenLateRefund(orderId: string): Promise<void> {
    await this.prisma.ticketOrder.updateMany({
      where: { id: orderId, status: TicketOrderStatus.REFUNDED },
      data: { status: TicketOrderStatus.EXPIRED },
    });
  }

  /** The tickets a paid order is owed, each with an unguessable code. */
  private ticketsFor(order: {
    id: string;
    eventId: string;
    buyerName: string;
    buyerEmail: string;
    items: { ticketTypeId: string; quantity: number }[];
  }): Prisma.TicketCreateManyInput[] {
    return order.items.flatMap((item) =>
      Array.from({ length: item.quantity }, () => ({
        eventId: order.eventId,
        orderId: order.id,
        ticketTypeId: item.ticketTypeId,
        code: randomBytes(12).toString('base64url').toUpperCase(),
        holderName: order.buyerName,
        holderEmail: order.buyerEmail,
      })),
    );
  }

  /**
   * Voids a paid order's tickets and puts its seats back on sale.
   *
   * The mirror of `markPaid`, and claim-first for the same reason: the update
   * only matches a PAID order, so a second cancellation — a double click, a
   * retry after a timeout — matches nothing and returns nothing to inventory
   * twice. Voiding, returning seats and giving back the promo redemption are
   * one transaction, so none can happen without the others.
   *
   * Returns whether this call was the one that voided, so the caller tells
   * the buyer exactly once.
   */
  async voidPaidOrder(
    orderId: string,
    finalStatus: 'CANCELLED' | 'REFUNDED',
  ): Promise<boolean> {
    const order = await this.prisma.ticketOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });

    const wasVoided = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.ticketOrder.updateMany({
        where: { id: orderId, status: TicketOrderStatus.PAID },
        data: { status: finalStatus },
      });
      if (claimed.count === 0) return false;

      // Only VALID ones. A ticket already admitted is refused before this is
      // ever called, and the condition keeps a concurrent admission at the
      // door from being silently overwritten.
      await tx.ticket.updateMany({
        where: { orderId, status: TicketStatus.VALID },
        data: { status: TicketStatus.VOID },
      });

      for (const item of order.items) {
        await this.inventory.returnSold(item.ticketTypeId, item.quantity, tx);
      }

      await this.promoCodes.releaseClaim(order.promoCodeId, tx);
      return true;
    });

    if (wasVoided) await this.notifier.sendCancellation(orderId);
    return wasVoided;
  }

  /** Gives holds back when a checkout fails or is abandoned. */
  async releaseHolds(items: { ticketTypeId: string; quantity: number }[]): Promise<void> {
    for (const item of items) {
      await this.inventory.release(item.ticketTypeId, item.quantity).catch((error: unknown) => {
        this.logger.error(`failed to release inventory: ${describeError(error)}`);
      });
    }
  }

}

/** The seats a late payment was for have been sold to someone else. */
class SoldOut extends Error {}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
