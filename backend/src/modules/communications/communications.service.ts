import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MessageChannel, MessageStatus, Prisma,
  SuppressionReason,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  classifyDeliveryFailure,
  isWorthRetrying,
  nextAttemptAt,
  shouldSuppressAddress,
} from './delivery-outcome';
import { SuppressionService } from './suppression.service';
import { resolveTranslation } from '../../common/locale';
import { MessageTransport } from './channels/message-channel';
import { renderTemplate } from './message-renderer';

export interface EnqueueParams {
  /** Null for platform mail — a reset link, a verification, an org invite. */
  organizationId: string | null;
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
/** What one dispatch attempt resolved to. */
type DeliveryOutcome = 'SENT' | 'RETRYING' | 'FAILED';

@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transports: Map<MessageChannel, MessageTransport>,
    private readonly suppressions: SuppressionService,
  ) {}

  /** Renders now, sends later. Returns the queued message. */
  async enqueue(params: EnqueueParams) {
    if (params.dedupeKey) {
      const existing = await this.prisma.message.findUnique({
        where: { dedupeKey: params.dedupeKey },
      });
      if (existing) return existing;
    }

    const isSuppressed = await this.suppressions.isSuppressed(
      params.channel,
      params.toAddress,
      params.organizationId,
    );

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
        // Resolved here, not at dispatch, for the same reason the body is:
        // what was sent must stay knowable after the template changes.
        providerTemplate: template.providerTemplate,
        providerParams: template.providerTemplate
          ? positionalParams(template.providerParams, params.variables)
          : [],
        // Recorded rather than dropped: a host asking why a guest never got
        // their invitation deserves the answer "they opted out", and a
        // message that silently never existed cannot give it.
        ...queueState(isSuppressed),
      },
    });
  }

  /**
   * Sends everything due. Claims each message by moving it to SENDING first,
   * conditioned on it still being QUEUED, so two dispatchers running at once
   * cannot both send the same message.
   */
  async dispatchDue(
    limit = 50,
  ): Promise<{ sent: number; failed: number; suppressed: number; retrying: number }> {
    const due = await this.prisma.message.findMany({
      where: { status: MessageStatus.QUEUED, scheduledFor: { lte: new Date() } },
      orderBy: { scheduledFor: 'asc' },
      take: limit,
    });

    let sent = 0;
    let failed = 0;
    let suppressed = 0;
    let retrying = 0;
    for (const message of due) {
      const attempt = await this.claim(message.id);
      if (attempt === null) continue;

      // Checked again here, not only at enqueue: a bounce or an unsubscribe
      // between queueing and sending must stop the send, and a scheduled
      // reminder can sit in the outbox for weeks.
      const isSuppressed = await this.suppressions.isSuppressed(
        message.channel,
        message.toAddress,
        message.organizationId,
      );
      if (isSuppressed) {
        await this.markSuppressed(message.id);
        suppressed += 1;
        continue;
      }

      const outcome = await this.deliver({ ...message, attempts: attempt });
      if (outcome === 'SENT') sent += 1;
      else if (outcome === 'RETRYING') retrying += 1;
      else failed += 1;
    }

    return { sent, failed, suppressed, retrying };
  }

  private async markSuppressed(messageId: string): Promise<void> {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.SUPPRESSED, failureReason: 'Recipient is suppressed' },
    });
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

  /**
   * Takes ownership of one message and returns which attempt this is.
   *
   * The count comes back from the claim rather than from the row that was
   * read a moment earlier: the claim is what increments it, so a caller using
   * the stale value would allow one attempt more than the budget — which is
   * exactly the off-by-one this signature prevents. Null means another
   * dispatcher got there first.
   */
  private async claim(messageId: string): Promise<number | null> {
    const claimed = await this.prisma.message.updateMany({
      where: { id: messageId, status: MessageStatus.QUEUED },
      data: { status: MessageStatus.SENDING, attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) return null;

    const { attempts } = await this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      select: { attempts: true },
    });
    return attempts;
  }

  private async deliver(message: {
    id: string;
    organizationId: string | null;
    channel: MessageChannel;
    toAddress: string;
    subject: string | null;
    body: string;
    locale: string;
    attempts: number;
    providerTemplate?: string | null;
    providerParams?: string[];
  }): Promise<DeliveryOutcome> {
    const transport = this.transports.get(message.channel);
    if (!transport) {
      await this.fail(message.id, `No transport configured for ${message.channel}`);
      return 'FAILED';
    }

    try {
      const result = await transport.send({
        toAddress: message.toAddress,
        subject: message.subject ?? undefined,
        body: message.body,
        locale: message.locale,
        template: message.providerTemplate
          ? {
              providerTemplate: message.providerTemplate,
              params: message.providerParams ?? [],
            }
          : undefined,
      });

      await this.prisma.message.update({
        where: { id: message.id },
        data: {
          status: result.isDelivered ? MessageStatus.DELIVERED : MessageStatus.SENT,
          providerRef: result.providerRef ?? null,
          failureReason: null,
          sentAt: new Date(),
          deliveredAt: result.isDelivered ? new Date() : null,
        },
      });
      return 'SENT';
    } catch (error) {
      return this.handleFailure(message, error);
    }
  }

  /**
   * Decides what a failed send means.
   *
   * Three outcomes, because conflating them is how a product either loses mail
   * or keeps writing to an address that will never accept it:
   *
   *   - the recipient refused it      → bounced, and the address is suppressed
   *                                     platform-wide so no other host wastes
   *                                     reputation on it
   *   - the provider could not now    → back in the queue with a backoff
   *   - our configuration is wrong    → back in the queue, logged as ours, and
   *                                     never held against the recipient
   */
  private async handleFailure(
    message: {
      id: string;
      organizationId: string | null;
      channel: MessageChannel;
      toAddress: string;
      attempts: number;
    },
    error: unknown,
  ): Promise<DeliveryOutcome> {
    const failure = classifyDeliveryFailure(error);

    if (failure.kind === 'MISCONFIGURED') {
      // Loud, because every message on this channel is failing for the same
      // reason and no amount of retrying will fix it.
      this.logger.error(
        `${message.channel} transport is misconfigured: ${failure.reason}. ` +
          'Queued messages will retry; fix the credentials.',
      );
    }

    if (shouldSuppressAddress(failure.kind)) {
      await this.suppressions.suppress({
        organizationId: null,
        channel: message.channel,
        address: message.toAddress,
        reason: SuppressionReason.HARD_BOUNCE,
        notes: failure.reason,
      });
      await this.prisma.message.update({
        where: { id: message.id },
        data: { status: MessageStatus.BOUNCED, failureReason: failure.reason },
      });
      this.logger.warn(`message ${message.id} bounced: ${failure.reason}`);
      return 'FAILED';
    }

    if (!isWorthRetrying(failure.kind, message.attempts)) {
      await this.fail(message.id, `${failure.reason} (gave up after ${message.attempts} attempts)`);
      return 'FAILED';
    }

    await this.prisma.message.update({
      where: { id: message.id },
      data: {
        // Back to QUEUED rather than a separate state: the dispatcher's own
        // claim is what makes re-queueing safe, and one fewer state is one
        // fewer thing a future reader has to reason about.
        status: MessageStatus.QUEUED,
        failureReason: failure.reason,
        scheduledFor: nextAttemptAt(message.attempts, new Date()),
      },
    });
    return 'RETRYING';
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
  private async loadTemplate(
    organizationId: string | null,
    key: string,
    channel: MessageChannel,
  ) {
    const found = await this.prisma.messageTemplate.findFirst({
      where: {
        key,
        channel,
        isActive: true,
        // Platform mail has no tenant, so only Aveline's own copy applies to
        // it; an organization's override must not reach a message that is not
        // theirs.
        OR: organizationId === null
          ? [{ organizationId: null }]
          : [{ organizationId }, { organizationId: null }],
      },
      // An organization's own copy wins over Aveline's default.
      orderBy: { organizationId: Prisma.SortOrder.desc },
    });

    if (!found) throw new NotFoundException(`No ${channel} template "${key}"`);
    return found;
  }
}

/** A suppressed recipient is recorded as such instead of being queued. */
function queueState(isSuppressed: boolean): { status: MessageStatus; failureReason: string | null } {
  return isSuppressed
    ? { status: MessageStatus.SUPPRESSED, failureReason: 'Recipient is suppressed' }
    : { status: MessageStatus.QUEUED, failureReason: null };
}

/**
 * The template's variables in the order the provider expects them.
 *
 * A provider template addresses its variables by position, so the order in
 * `providerParams` is part of the contract with the provider. A missing
 * variable becomes an empty string rather than throwing: the rendered body has
 * already been validated by `renderTemplate`, so a gap here means the
 * provider mapping lists a name the copy does not use — worth seeing in the
 * sent message rather than failing the whole send.
 */
function positionalParams(names: string[], variables: Record<string, string>): string[] {
  return names.map((name) => variables[name] ?? '');
}
