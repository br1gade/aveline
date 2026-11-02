import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@prisma/client';
import { CommunicationsService } from '../communications/communications.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Tells a buyer their tickets exist.
 *
 * Its own service rather than another method on `TicketingService`, which was
 * already selling, settling, admitting and expiring — adding notification made
 * six collaborators, and a constructor that long is the signal that a class
 * has stopped being about one thing.
 *
 * Until this existed a buyer paid, tickets were issued, and they received
 * nothing: the only way to reach them was the access token in the checkout
 * response, which a browser that navigated away had already lost. The
 * `ticket.issued` copy had been seeded since the outbox was built and nothing
 * ever sent it.
 */
@Injectable()
export class TicketNotifierService {
  private readonly logger = new Logger(TicketNotifierService.name);
  private readonly appUrl: string;
  /** Where the next sweep resumes. Per process: losing it only restarts the rotation. */
  private sweepCursor: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly communications: CommunicationsService,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:5173';
  }

  /**
   * Queues the buyer's tickets.
   *
   * A failure is logged and swallowed. The money has moved and the tickets
   * exist; failing settlement because an email could not be queued would
   * leave a paid order unsettled, which is far worse than a buyer who has to
   * be sent their link by hand.
   */
  async sendTickets(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.ticketOrder.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          accessToken: true,
          buyerName: true,
          buyerEmail: true,
          locale: true,
          event: { select: { organizationId: true, id: true, title: true } },
        },
      });

      await this.communications.enqueue({
        organizationId: order.event.organizationId,
        eventId: order.event.id,
        channel: MessageChannel.EMAIL,
        templateKey: 'ticket.issued',
        toAddress: order.buyerEmail,
        locale: order.locale,
        variables: {
          buyerName: order.buyerName,
          eventTitle: order.event.title,
          link: `${this.appUrl}/tickets/${order.accessToken}`,
        },
        // One confirmation per order, whatever retries the bank's callback and
        // the buyer's refresh button produce between them.
        dedupeKey: `ticket-issued:${orderId}`,
      });
    } catch (error) {
      this.logger.error(`could not queue tickets for order ${orderId}: ${describeError(error)}`);
    }
  }

  /**
   * Queues what a failed attempt did not: tickets for paid orders, notices
   * for cancelled and refunded ones, from the last week. Settlement swallows
   * a failure to queue — rightly, the money has moved — so without this sweep
   * one database blip meant a buyer who was never told.
   *
   * Each run takes the batch after the last one; a short batch means the end
   * was reached and the next run starts over. An order whose notice keeps
   * failing (its organization has no copy, say) writes no message and so
   * stays eligible all week; read from the start every time, a batch of those
   * was all the sweep ever reached, and every buyer behind them went untold.
   */
  async sendMissing(limit = 50): Promise<{ queued: number }> {
    const orders = await this.ordersWithoutNotice(this.sweepCursor, limit);
    this.sweepCursor = orders.length < limit ? null : orders[orders.length - 1].id;

    for (const order of orders) {
      await (order.status === 'PAID' ? this.sendTickets(order.id) : this.sendCancellation(order.id));
    }
    return { queued: orders.length };
  }

  private ordersWithoutNotice(after: string | null, limit: number) {
    return this.prisma.$queryRaw<{ id: string; status: string }[]>`
      SELECT o.id, o.status::text AS status FROM ticket_orders o
       WHERE o.status IN ('PAID', 'CANCELLED', 'REFUNDED')
         AND o."updatedAt" > now() - interval '7 days'
         AND (${after}::text IS NULL OR o.id > ${after})
         AND NOT EXISTS (
           SELECT 1 FROM messages m
            WHERE m."dedupeKey" = (CASE WHEN o.status = 'PAID' THEN 'ticket-issued:' ELSE 'ticket-cancelled:' END) || o.id)
         -- "Refunded" only once the bank has refunded. The order is claimed
         -- REFUNDED before the bank is asked, and an unknown outcome stays
         -- that way until staff confirm it (B85).
         AND (o.status = 'PAID' OR o."paymentOrderNumber" IS NULL OR EXISTS (
           SELECT 1 FROM refunds r JOIN payments p ON p.id = r."paymentId"
            WHERE p."orderNumber" = o."paymentOrderNumber" AND r.status = 'COMPLETED'))
       ORDER BY o.id
       LIMIT ${limit}`;
  }

  /**
   * Tells the buyer their order was cancelled and refunded.
   *
   * Without it a buyer finds out from their bank statement, or at the door —
   * which is the worse of the two. Same failure rule as `sendTickets`: logged,
   * never raised, because the money has already gone back.
   */
  async sendCancellation(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.ticketOrder.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          buyerName: true,
          buyerEmail: true,
          locale: true,
          totalMinor: true,
          currency: true,
          event: { select: { organizationId: true, id: true, title: true } },
        },
      });

      await this.communications.enqueue({
        organizationId: order.event.organizationId,
        eventId: order.event.id,
        channel: MessageChannel.EMAIL,
        templateKey: 'ticket.cancelled',
        toAddress: order.buyerEmail,
        locale: order.locale,
        variables: {
          buyerName: order.buyerName,
          eventTitle: order.event.title,
          amount: `${order.totalMinor.toString()} ${order.currency}`,
        },
        dedupeKey: `ticket-cancelled:${orderId}`,
      });
    } catch (error) {
      this.logger.error(`could not queue cancellation for order ${orderId}: ${describeError(error)}`);
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
