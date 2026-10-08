import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TicketOrderStatus, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { TicketFulfilmentService } from './ticket-fulfilment.service';

/**
 * Cancelling a ticket order, which refunds it.
 *
 * Decided with the product owner: the host cancels tickets and the refund
 * follows, as one action. Before this, a refund was a separate call on the
 * payment that left the tickets valid — so a refunded buyer could still get in,
 * and the money and the access could disagree whenever a host remembered one
 * step and not the other. Whole orders only, also as decided.
 *
 * The order of operations is the design:
 *
 *   1. **Refund first**, through `PaymentsService.refund`, which is already
 *      exactly-once — it claims the refund in the database before calling the
 *      bank, so two concurrent cancellations cannot both pay out.
 *   2. **Then void**, through a claim that only matches a PAID order.
 *
 * If the process dies between the two, the money has gone back and the
 * tickets are still valid. Running the cancellation again finishes it: step 1
 * sees the payment already refunded and skips straight to step 2. So a retry
 * heals the gap rather than refunding twice.
 */
@Injectable()
export class TicketCancellationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly fulfilment: TicketFulfilmentService,
  ) {}

  async cancel(eventId: string, orderId: string) {
    const order = await this.prisma.ticketOrder.findFirst({
      where: { id: orderId, eventId },
      select: {
        id: true,
        status: true,
        totalMinor: true,
        paymentOrderNumber: true,
        tickets: { select: { status: true } },
      },
    });
    if (!order) throw new NotFoundException('No such order on this event');

    // Already done: a retry, or a second click. Answered, not refused.
    if (order.status === TicketOrderStatus.REFUNDED || order.status === TicketOrderStatus.CANCELLED) {
      return this.describe(orderId);
    }
    if (order.status !== TicketOrderStatus.PAID) {
      throw new BadRequestException(
        `This order is ${order.status.toLowerCase()}, not paid, so there is nothing to cancel`,
      );
    }

    /**
     * Someone with one of these tickets has already been let in. Refunding
     * after attendance is a dispute to settle with the buyer, not a
     * cancellation — and voiding a used ticket would erase the record that
     * they came.
     */
    const admitted = order.tickets.filter((ticket) => ticket.status === TicketStatus.USED).length;
    if (admitted > 0) {
      throw new ConflictException(
        `${admitted} ticket(s) on this order were already admitted at the door, so it cannot be cancelled`,
      );
    }

    const isPaid = order.totalMinor > 0n && order.paymentOrderNumber !== null;
    if (isPaid) await this.refundRemaining(order.paymentOrderNumber!);

    await this.fulfilment.voidPaidOrder(orderId, isPaid ? 'REFUNDED' : 'CANCELLED');
    return this.describe(orderId);
  }

  /**
   * Refunds whatever of the payment has not already been refunded.
   *
   * Reading what is left, rather than refunding the order total, is what makes
   * a retry safe: a cancellation that refunded and then died finds nothing
   * left to refund and moves on to voiding.
   */
  private async refundRemaining(orderNumber: string): Promise<void> {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { orderNumber },
      select: { amountMinor: true, refundedMinor: true },
    });

    const remaining = payment.amountMinor - payment.refundedMinor;
    if (remaining > 0n) {
      await this.payments.refund(orderNumber, remaining, 'Ticket order cancelled by the host');
    }
  }

  private async describe(orderId: string) {
    const order = await this.prisma.ticketOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        totalMinor: true,
        currency: true,
        buyerName: true,
        buyerEmail: true,
        tickets: { select: { code: true, status: true } },
      },
    });

    return {
      orderId: order.id,
      status: order.status,
      refundedMinor: order.status === TicketOrderStatus.REFUNDED ? order.totalMinor.toString() : '0',
      currency: order.currency,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      tickets: order.tickets,
    };
  }

  /** The orders on an event, for a host deciding which to cancel. */
  async listOrders(eventId: string, status?: TicketOrderStatus) {
    const orders = await this.prisma.ticketOrder.findMany({
      where: { eventId, status },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        status: true,
        buyerName: true,
        buyerEmail: true,
        totalMinor: true,
        discountMinor: true,
        currency: true,
        createdAt: true,
        _count: { select: { tickets: true } },
      },
    });

    return orders.map((order) => ({
      orderId: order.id,
      status: order.status,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      totalMinor: order.totalMinor.toString(),
      discountMinor: order.discountMinor.toString(),
      currency: order.currency,
      tickets: order._count.tickets,
      createdAt: order.createdAt,
    }));
  }
}
