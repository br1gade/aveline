import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  PaymentPurpose,
  Prisma,
  TicketOrderStatus,
  TicketStatus,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PromoCodesService } from '../billing/promo-codes.service';
import { PaymentsService } from '../payments/payments.service';
import { CheckPromoCodeDto } from '../billing/dto/promo-code.dto';
import { CreateOrderDto, OrderLineDto } from './dto/create-order.dto';
import { TicketInventoryService } from './ticket-inventory.service';

/** How long a checkout holds inventory before the sweep returns it. */
const RESERVATION_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class TicketingService {
  private readonly logger = new Logger(TicketingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: TicketInventoryService,
    private readonly payments: PaymentsService,
    private readonly promoCodes: PromoCodesService,
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
    try {
      for (const line of dto.items) {
        await this.inventory.reserve(line.ticketTypeId, line.quantity);
        reserved.push(line);
      }
      return await this.recordOrder(event, dto, types);
    } catch (error) {
      // Anything already held must go back, or a failed checkout silently
      // removes seats from sale until the sweep catches them.
      await this.releaseAll(reserved);
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
    if (order.status === TicketOrderStatus.PAID) return this.describe(order);

    if (order.status !== TicketOrderStatus.RESERVED) {
      throw new BadRequestException(`Order is ${order.status.toLowerCase()}`);
    }
    if (!order.paymentOrderNumber) {
      throw new BadRequestException('Order has no payment to confirm');
    }

    const payment = await this.payments.confirm(order.paymentOrderNumber, 'CALLBACK');
    if (payment.status !== 'CAPTURED') {
      return { ...this.describe(order), payment };
    }

    return this.markPaid(order.id);
  }

  /**
   * Converts holds into sales and issues the tickets. Idempotent: a repeated
   * callback must not issue a second set.
   */
  async markPaid(orderId: string) {
    const order = await this.prisma.ticketOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    if (order.status === TicketOrderStatus.PAID) return this.describe(order);

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
    });

    return this.describe(
      await this.prisma.ticketOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true },
      }),
    );
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

  /** Admits a ticket at the door. A code may only be used once. */
  async admit(code: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { code } });
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

  private async recordOrder(
    event: { id: string; organizationId: string },
    dto: CreateOrderDto,
    types: { id: string; priceMinor: bigint; currency: string }[],
  ) {
    const subtotalMinor = subtotalFor(dto.items, types);

    const order = await this.createOrderRow(event, dto, types, subtotalMinor);

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

  private async releaseAll(items: { ticketTypeId: string; quantity: number }[]): Promise<void> {
    for (const item of items) {
      await this.inventory.release(item.ticketTypeId, item.quantity).catch((error: unknown) => {
        this.logger.error(`failed to release inventory: ${describeError(error)}`);
      });
    }
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
