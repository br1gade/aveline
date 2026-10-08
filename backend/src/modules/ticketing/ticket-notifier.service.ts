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
