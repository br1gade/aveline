import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  PaymentPurpose,
  TicketOrderStatus,
  TicketStatus,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PromoCodesService } from '../billing/promo-codes.service';
import { PaymentsService } from '../payments/payments.service';
import { CheckPromoCodeDto } from '../billing/dto/promo-code.dto';
import { CreateOrderDto, OrderLineDto } from './dto/create-order.dto';
import { TicketFulfilmentService } from './ticket-fulfilment.service';

/** How long a checkout holds inventory before the sweep returns it. */
const RESERVATION_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class TicketingService {
  private readonly logger = new Logger(TicketingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly promoCodes: PromoCodesService,
    private readonly fulfilment: TicketFulfilmentService,
  ) {}

  /**
   * Reserves inventory, records the order, and starts payment if there is
   * anything to pay.
   *
   * Inventory is taken BEFORE payment, not after. The alternative — charge
   * first, allocate later — produces the worst outcome available: a customer
   * who has paid for a seat that no longer exists.
   */
  async createOrder(eventSlug: string, dto: CreateOrderDto) {
    const existing = await this.prisma.ticketOrder.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { items: true },
    });
    if (existing) return this.describe(existing);

    const event = await this.loadSellableEvent(eventSlug);
    const types = await this.loadTicketTypes(event.id, dto.items);

    const reserved: OrderLineDto[] = [];
    let order: Awaited<ReturnType<TicketingService['createOrderRow']>>;
    try {
      for (const line of dto.items) {
        await this.fulfilment.hold([line]);
        reserved.push(line);
      }
      order = await this.createOrderRow(event, dto, types, subtotalFor(dto.items, types));
    } catch (error) {
      // No order yet, so the holds are the only record: give them back.
      await this.fulfilment.releaseHolds(reserved);
      throw error;
    }

    try {
      return await this.settleOrPay(event, dto, order);
    } catch (error) {
      // The order exists now. Expiring it is what returns its seats — once,
      // claim-first — where releasing them beside a RESERVED order let the
      // sweep return them a second time.
      await this.fulfilment.expire(order.id);
      throw error;
    }
  }

  /**
   * What a promo code is worth on this basket, before committing to anything.
   *
   * The subtotal is computed from our own prices rather than taken from the
   * request, so the quote cannot be inflated by claiming a larger order. The
   * answer is a preview: a code with one redemption left can still be taken by
   * someone else before checkout, which is why the redemption itself is
   * claimed again, atomically, at that point.
   */
  async checkPromoCode(eventSlug: string, dto: CheckPromoCodeDto) {
    const event = await this.loadSellableEvent(eventSlug);
    const types = await this.loadTicketTypes(event.id, dto.items);
    const subtotalMinor = subtotalFor(dto.items, types);

    const evaluation = await this.promoCodes.evaluate(event.organizationId, dto.code, {
      eventId: event.id,
      subtotalMinor,
    });

    const discountMinor = evaluation.isApplicable ? evaluation.discountMinor : 0n;
    return {
      code: dto.code.trim().toUpperCase(),
      isApplicable: evaluation.isApplicable,
      reason: evaluation.isApplicable ? undefined : evaluation.reason,
      subtotalMinor: subtotalMinor.toString(),
      discountMinor: discountMinor.toString(),
      totalMinor: (subtotalMinor - discountMinor).toString(),
      currency: types[0]?.currency ?? 'AMD',
    };
  }

  /**
   * Asks the bank whether the order's payment settled, and issues tickets if
   * it did.
   *
   * Ticketing calls payments rather than payments calling ticketing: the
   * dependency points one way, so there is no cycle and payments stays
   * ignorant of what it is paying for.
   */
  async confirmOrder(accessToken: string) {
    const order = await this.prisma.ticketOrder.findUnique({
      where: { accessToken },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === TicketOrderStatus.PAID) return this.markPaid(order.id);

    // An expired order is still worth asking about: its buyer may have paid
    // after the hold lapsed (B36).
    const isAskable = order.status === TicketOrderStatus.RESERVED || order.status === TicketOrderStatus.EXPIRED;
    if (!isAskable) throw new BadRequestException(`Order is ${order.status.toLowerCase()}`);
    if (!order.paymentOrderNumber) {
      throw new BadRequestException('Order has no payment to confirm');
    }

    const payment = await this.payments.confirm(order.paymentOrderNumber, 'CALLBACK');
    if (payment.status !== 'CAPTURED') {
      return { ...this.describe(order), payment };
    }

    await this.settleCaptured(order.id);
    return this.findByAccessToken(accessToken);
  }

  /**
   * Settles every ticket order whose payment the bank has captured but which
   * is not yet paid — the ones reconciliation found, whose buyer never came
   * back to tell us. Run after each reconciliation sweep.
   */
  async settleCapturedPayments(limit = 50): Promise<{ settled: number }> {
    const orders = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT o.id FROM ticket_orders o
        JOIN payments p ON p."orderNumber" = o."paymentOrderNumber"
       WHERE o.status IN ('RESERVED', 'EXPIRED') AND p.status = 'CAPTURED'
       ORDER BY o."createdAt" ASC
       LIMIT ${limit}`;

    let settled = 0;
    for (const order of orders) {
      try {
        await this.settleCaptured(order.id);
        settled += 1;
      } catch (error) {
        this.logger.warn(`could not settle order ${order.id}: ${describeError(error)}`);
      }
    }
    return { settled };
  }

  /**
   * Turns a captured payment into tickets — or, when its hold had lapsed and
   * the seats were sold meanwhile, into a full refund the buyer is told about.
   */
  private async settleCaptured(orderId: string): Promise<void> {
    const order = await this.prisma.ticketOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status === TicketOrderStatus.RESERVED) {
      await this.fulfilment.markPaid(orderId);
      return;
    }
    if (order.status !== TicketOrderStatus.EXPIRED) return;

    const outcome = await this.fulfilment.issueLate(orderId);
    if (outcome === 'SOLD_OUT') await this.refundLate(order);
  }

  /** Claim first, then the bank; a refused refund reopens the claim for the next sweep. */
  private async refundLate(order: { id: string; paymentOrderNumber: string | null; totalMinor: bigint }): Promise<void> {
    if (!order.paymentOrderNumber || !(await this.fulfilment.claimLateRefund(order.id))) return;

    try {
      await this.payments.refund(order.paymentOrderNumber, order.totalMinor, 'Paid after the hold lapsed; sold out meanwhile');
    } catch (error) {
      await this.fulfilment.reopenLateRefund(order.id);
      throw error;
    }
    await this.fulfilment.notifyCancelled(order.id);
  }

  /**
   * Converts holds into sales and issues the tickets. Idempotent: a repeated
   * callback must not issue a second set.
   */
  /**
   * Turns a settled payment into tickets.
   *
   * Delegated: committing inventory, issuing codes and telling the buyer are
   * fulfilment, not the sale. This keeps the shape the callers already expect.
   */
  async markPaid(orderId: string) {
    return this.describe(await this.fulfilment.markPaid(orderId));
  }

  /**
   * Returns the seats of lapsed checkouts — after asking the bank about each
   * one that started a payment. Lapsing without asking resold the seats of
   * buyers who had paid and simply not come back to the site (B36).
   */
  async releaseExpiredReservations(limit = 100): Promise<{ released: number }> {
    const lapsed = await this.prisma.ticketOrder.findMany({
      where: { status: TicketOrderStatus.RESERVED, reservesUntil: { lt: new Date() }, paymentOrderNumber: { not: null } },
      select: { id: true, paymentOrderNumber: true },
      take: limit,
    });
    for (const order of lapsed) {
      const payment = await this.payments
        .confirm(order.paymentOrderNumber!, 'RECONCILIATION')
        .catch((error: unknown) => this.logger.warn(`could not ask about ${order.id}: ${describeError(error)}`));
      if (payment?.status === 'CAPTURED') await this.fulfilment.markPaid(order.id);
    }
    return this.fulfilment.releaseExpiredReservations(limit);
  }

  /** Delegated: queues the confirmations a failed attempt did not. */
  sendMissingNotices(): Promise<{ queued: number }> {
    return this.fulfilment.sendMissingNotices();
  }

  async admit(eventId: string, code: string) {
    // Not found, rather than forbidden, for another event's code: a door
    // scanner learns nothing about tickets that are not for its event.
    const ticket = await this.prisma.ticket.findFirst({ where: { code, eventId } });
    if (!ticket) throw new NotFoundException('Ticket not recognised');

    if (ticket.status !== TicketStatus.VALID) {
      throw new BadRequestException(`Ticket already ${ticket.status.toLowerCase()}`);
    }

    // Conditioned on VALID so two scanners cannot both admit one code.
    const admitted = await this.prisma.ticket.updateMany({
      where: { id: ticket.id, status: TicketStatus.VALID },
      data: { status: TicketStatus.USED, usedAt: new Date() },
    });
    if (admitted.count === 0) throw new BadRequestException('Ticket already used');

    return { code, admittedAt: new Date().toISOString(), holderName: ticket.holderName };
  }

  async findByAccessToken(accessToken: string) {
    const order = await this.prisma.ticketOrder.findUnique({
      where: { accessToken },
      include: { items: true, tickets: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.describe(order);
  }

  // ── internals ────────────────────────────────────────────────────────

  private async loadSellableEvent(slug: string) {
    const listing = await this.prisma.eventListing.findUnique({
      where: { slug },
      include: {
        event: { select: { id: true, organizationId: true, visibility: true, status: true } },
      },
    });

    if (!listing || listing.publishedAt === null) {
      throw new NotFoundException(`No published event at "${slug}"`);
    }
    if (listing.event.visibility === 'PRIVATE') {
      throw new NotFoundException(`No published event at "${slug}"`);
    }
    return listing.event;
  }

  private async loadTicketTypes(eventId: string, items: OrderLineDto[]) {
    const ids = items.map((item) => item.ticketTypeId);
    const types = await this.prisma.ticketType.findMany({
      where: { id: { in: ids }, eventId },
    });

    if (types.length !== new Set(ids).size) {
      throw new NotFoundException('One or more ticket types do not belong to this event');
    }

    const now = new Date();
    for (const line of items) {
      const type = types.find((candidate) => candidate.id === line.ticketTypeId)!;
      assertOnSale(type, now);
      assertWithinOrderLimits(type, line.quantity);
    }
    return types;
  }

  /** A free order is settled now; anything else starts its payment. */
  private async settleOrPay(
    event: { id: string; organizationId: string },
    dto: CreateOrderDto,
    order: Awaited<ReturnType<TicketingService['createOrderRow']>>,
  ) {
    // A free event — or one discounted to nothing — skips payment entirely.
    if (order.totalMinor === 0n) return this.markPaid(order.id);
    if (!dto.provider) {
      throw new BadRequestException('This event requires payment; choose a provider');
    }

    const payment = await this.payments.start({
      organizationId: event.organizationId,
      eventId: event.id,
      purpose: PaymentPurpose.TICKET,
      provider: dto.provider,
      amountMinor: order.totalMinor.toString(),
      currency: order.currency,
      returnUrl: dto.returnUrl ?? 'https://aveline.test/tickets/return',
      description: `Tickets for ${event.id}`,
      locale: order.locale,
      idempotencyKey: `order-${order.id}`,
    });

    await this.prisma.ticketOrder.update({
      where: { id: order.id },
      data: { paymentOrderNumber: payment.orderNumber },
    });

    return { ...this.describe(order), payment };
  }

  /**
   * Takes the discount and records the order in one transaction.
   *
   * Both or neither: an order that failed to insert must not have consumed a
   * redemption, and a redemption that was taken must be attached to an order.
   * Rolling back is how the redemption is returned — a compensating write
   * after the fact is a write that might not run.
   */
  private async createOrderRow(
    event: { id: string; organizationId: string },
    dto: CreateOrderDto,
    types: { id: string; priceMinor: bigint; currency: string }[],
    subtotalMinor: bigint,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const claim = dto.promoCode
        ? await this.promoCodes.claim(
            event.organizationId,
            dto.promoCode,
            { eventId: event.id, subtotalMinor },
            tx,
          )
        : null;

      const discountMinor = claim?.discountMinor ?? 0n;

      return tx.ticketOrder.create({
        data: {
          eventId: event.id,
          buyerName: dto.buyerName,
          buyerEmail: dto.buyerEmail,
          buyerPhone: dto.buyerPhone ?? null,
          locale: dto.locale ?? 'hy',
          totalMinor: subtotalMinor - discountMinor,
          promoCodeId: claim?.promoCodeId ?? null,
          discountMinor,
          currency: types[0]?.currency ?? 'AMD',
          idempotencyKey: dto.idempotencyKey,
          accessToken: randomBytes(16).toString('hex'),
          reservesUntil: new Date(Date.now() + RESERVATION_WINDOW_MS),
          items: {
            create: dto.items.map((line) => ({
              ticketTypeId: line.ticketTypeId,
              quantity: line.quantity,
              unitPriceMinor: types.find((t) => t.id === line.ticketTypeId)!.priceMinor,
            })),
          },
        },
        include: { items: true },
      });
    });
  }

  private describe(order: {
    id: string;
    accessToken: string;
    status: TicketOrderStatus;
    totalMinor: bigint;
    discountMinor?: bigint;
    currency: string;
    reservesUntil: Date | null;
    items: { ticketTypeId: string; quantity: number; unitPriceMinor: bigint }[];
    tickets?: { code: string; status: TicketStatus }[];
  }) {
    return {
      orderId: order.id,
      accessToken: order.accessToken,
      status: order.status,
      totalMinor: order.totalMinor.toString(),
      discountMinor: (order.discountMinor ?? 0n).toString(),
      currency: order.currency,
      reservesUntil: order.reservesUntil,
      items: order.items.map((item) => ({
        ticketTypeId: item.ticketTypeId,
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor.toString(),
      })),
      tickets: order.tickets?.map((ticket) => ({ code: ticket.code, status: ticket.status })),
    };
  }
}

function assertOnSale(
  type: { isActive: boolean; salesStartAt: Date | null; salesEndAt: Date | null },
  now: Date,
): void {
  if (!type.isActive) throw new BadRequestException('This ticket type is not on sale');
  if (type.salesStartAt && type.salesStartAt > now) {
    throw new BadRequestException('Sales have not opened for this ticket type');
  }
  if (type.salesEndAt && type.salesEndAt < now) {
    throw new BadRequestException('Sales have closed for this ticket type');
  }
}

function assertWithinOrderLimits(
  type: { minPerOrder: number; maxPerOrder: number },
  quantity: number,
): void {
  if (quantity < type.minPerOrder) {
    throw new BadRequestException(`At least ${type.minPerOrder} ticket(s) per order`);
  }
  if (quantity > type.maxPerOrder) {
    throw new BadRequestException(`At most ${type.maxPerOrder} ticket(s) per order`);
  }
}



function subtotalFor(
  items: OrderLineDto[],
  types: { id: string; priceMinor: bigint }[],
): bigint {
  return items.reduce((sum, line) => {
    const type = types.find((candidate) => candidate.id === line.ticketTypeId)!;
    return sum + type.priceMinor * BigInt(line.quantity);
  }, 0n);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
