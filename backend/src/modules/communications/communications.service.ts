import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MessageChannel, MessageStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveTranslation } from '../../common/locale';
import { MessageTransport } from './channels/message-channel';
import { renderTemplate } from './message-renderer';

export interface EnqueueParams {
  organizationId: string;
  eventId?: string;
  guestId?: string;
  channel: MessageChannel;
  templateKey: string;
  toAddress: string;
  locale: string;
  variables: Record<string, string>;
  scheduledFor?: Date;
  /** Same logical message is only ever enqueued once. */
  dedupeKey?: string;
}

/**
 * Outbound messaging, built as an outbox.
 *
 * A message is written to the database in the same transaction as the action
 * that causes it, and dispatched afterwards by a separate sweep. The naive
 * alternative — call the provider inline — loses the message whenever the
 * process dies between committing the action and the provider replying, and
 * makes every send a latency cost the user pays for.
 */
@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transports: Map<MessageChannel, MessageTransport>,
  ) {}

  /** Renders now, sends later. Returns the queued message. */
  async enqueue(params: EnqueueParams) {
    if (params.dedupeKey) {
      const existing = await this.prisma.message.findUnique({
        where: { dedupeKey: params.dedupeKey },
      });
      if (existing) return existing;
    }

    const template = await this.loadTemplate(
      params.organizationId,
      params.templateKey,
      params.channel,
    );

    const subject = resolveTranslation<string>(template.subject, params.locale, 'hy');
    const body = resolveTranslation<string>(template.body, params.locale, 'hy');
    if (body === null) {
      throw new NotFoundException(`Template "${params.templateKey}" has no body for any locale`);
    }

    return this.prisma.message.create({
      data: {
        organizationId: params.organizationId,
        eventId: params.eventId ?? null,
        guestId: params.guestId ?? null,
        channel: params.channel,
        templateKey: params.templateKey,
        toAddress: params.toAddress,
        locale: params.locale,
        subject: subject === null ? null : renderTemplate(subject, params.variables),
        body: renderTemplate(body, params.variables),
        scheduledFor: params.scheduledFor ?? new Date(),
        dedupeKey: params.dedupeKey ?? null,
      },
    });
  }

  /**
   * Sends everything due. Claims each message by moving it to SENDING first,
   * conditioned on it still being QUEUED, so two dispatchers running at once
   * cannot both send the same message.
   */
  async dispatchDue(limit = 50): Promise<{ sent: number; failed: number }> {
    const due = await this.prisma.message.findMany({
      where: { status: MessageStatus.QUEUED, scheduledFor: { lte: new Date() } },
      orderBy: { scheduledFor: 'asc' },
      take: limit,
    });

    let sent = 0;
    let failed = 0;
    for (const message of due) {
      const wasClaimed = await this.claim(message.id);
      if (!wasClaimed) continue;

      const didSend = await this.deliver(message);
      if (didSend) sent += 1;
      else failed += 1;
    }

    return { sent, failed };
  }

  async findForEvent(eventId: string, paging: { take: number; skip: number }) {
    return this.prisma.message.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      ...paging,
      select: {
        id: true,
        channel: true,
        toAddress: true,
        status: true,
        templateKey: true,
        failureReason: true,
        sentAt: true,
      },
    });
  }

  private async claim(messageId: string): Promise<boolean> {
    const claimed = await this.prisma.message.updateMany({
      where: { id: messageId, status: MessageStatus.QUEUED },
      data: { status: MessageStatus.SENDING, attempts: { increment: 1 } },
    });
    return claimed.count === 1;
  }

  private async deliver(message: {
    id: string;
    channel: MessageChannel;
    toAddress: string;
    subject: string | null;
    body: string;
    locale: string;
  }): Promise<boolean> {
    const transport = this.transports.get(message.channel);
    if (!transport) {
      await this.fail(message.id, `No transport configured for ${message.channel}`);
      return false;
    }

    try {
      const result = await transport.send({
        toAddress: message.toAddress,
        subject: message.subject ?? undefined,
        body: message.body,
        locale: message.locale,
      });

      await this.prisma.message.update({
        where: { id: message.id },
        data: {
          status: result.isDelivered ? MessageStatus.DELIVERED : MessageStatus.SENT,
          providerRef: result.providerRef ?? null,
          sentAt: new Date(),
          deliveredAt: result.isDelivered ? new Date() : null,
        },
      });
      return true;
    } catch (error) {
      await this.fail(message.id, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private async fail(messageId: string, reason: string): Promise<void> {
    this.logger.warn(`message ${messageId} failed: ${reason}`);
    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.FAILED, failureReason: reason },
    });
  }

  /**
   * An organization's own copy wins over the Aveline default. Ordering by
   * organizationId descending puts the override first, because NULLs sort
   * last in Postgres under DESC.
   */
  private async loadTemplate(organizationId: string, key: string, channel: MessageChannel) {
    const found = await this.prisma.messageTemplate.findFirst({
      where: {
        key,
        channel,
        isActive: true,
        OR: [{ organizationId }, { organizationId: null }],
      },
      orderBy: { organizationId: Prisma.SortOrder.desc },
    });

    if (!found) throw new NotFoundException(`No ${channel} template "${key}"`);
    return found;
  }
}
