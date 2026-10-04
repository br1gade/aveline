import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  PaymentPurpose,
  Prisma,
  TicketOrderStatus,
  TicketStatus,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
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
      return await this.recordOrder(event.id, dto, types);
    } catch (error) {
      // Anything already held must go back, or a failed checkout silently
      // removes seats from sale until the sweep catches them.
      await this.releaseAll(reserved);
      throw error;
    }
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

    for (const item of order.items) {
      await this.inventory.commit(item.ticketTypeId, item.quantity);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.ticketOrder.update({
        where: { id: orderId },
        data: { status: TicketOrderStatus.PAID, reservesUntil: null },
      });
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
        await this.releaseAll(order.items);
        await this.prisma.ticketOrder.update({
          where: { id: order.id },
          data: { status: TicketOrderStatus.EXPIRED },
        });
        released += 1;
      } catch (error) {
        this.logger.warn(`could not release order ${order.id}: ${describeError(error)}`);
      }
    }

    return { released };
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
      include: { event: { select: { id: true, visibility: true, status: true } } },
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
    eventId: string,
    dto: CreateOrderDto,
    types: { id: string; priceMinor: bigint; currency: string }[],
  ) {
    const totalMinor = dto.items.reduce((sum, line) => {
      const type = types.find((candidate) => candidate.id === line.ticketTypeId)!;
      return sum + type.priceMinor * BigInt(line.quantity);
    }, 0n);

    const order = await this.prisma.ticketOrder.create({
      data: {
        eventId,
        buyerName: dto.buyerName,
        buyerEmail: dto.buyerEmail,
        buyerPhone: dto.buyerPhone ?? null,
        locale: dto.locale ?? 'hy',
        totalMinor,
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

    // A free event skips payment entirely and issues immediately.
    if (totalMinor === 0n) return this.markPaid(order.id);
    if (!dto.provider) {
      throw new BadRequestException('This event requires payment; choose a provider');
    }

    const payment = await this.payments.start({
      organizationId: (await this.prisma.event.findUniqueOrThrow({ where: { id: eventId } }))
        .organizationId,
      eventId,
      purpose: PaymentPurpose.TICKET,
      provider: dto.provider,
      amountMinor: totalMinor.toString(),
      currency: order.currency,
      returnUrl: dto.returnUrl ?? 'https://aveline.test/tickets/return',
      description: `Tickets for ${eventId}`,
      locale: order.locale,
      idempotencyKey: `order-${order.id}`,
    });

    await this.prisma.ticketOrder.update({
      where: { id: order.id },
      data: { paymentOrderNumber: payment.orderNumber },
    });

    return { ...this.describe(order), payment };
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
