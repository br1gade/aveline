import { normalizeAddress } from './address-form';
import { isUniqueViolation } from '../../common/prisma-errors';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MessageChannel, MessageStatus, Prisma,
  SuppressionReason,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MAX_DELIVERY_ATTEMPTS,
  classifyDeliveryFailure,
  isWorthRetrying,
  nextAttemptAt,
  shouldSuppressAddress,
} from './delivery-outcome';
import { SuppressionService } from './suppression.service';
import { resolveTranslation } from '../../common/locale';
import { DeliveryResult, MessageTransport } from './channels/message-channel';
import { priorityFor } from './message-priority';
import { renderTemplate } from './message-renderer';
import { EmailQuotaService, EmailQuotaWaitError } from './email-quota.service';

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

const TALLY_KEY: Record<Exclude<DispatchOutcome, 'TAKEN'>, 'sent' | 'failed' | 'suppressed' | 'retrying'> = {
  SENT: 'sent',
  FAILED: 'failed',
  SUPPRESSED: 'suppressed',
  RETRYING: 'retrying',
};

/** What happened to one due message, including not getting it. */
type DispatchOutcome = DeliveryOutcome | 'SUPPRESSED' | 'TAKEN';

/**
 * How long a message may sit in SENDING before it is presumed interrupted.
 *
 * Longer than any transport's own timeouts — a mail server can legitimately
 * hold a connection for minutes — so a send in progress is never taken from
 * under itself.
 */
const STRANDED_AFTER_MS = 15 * 60 * 1000;

type DueMessage = Prisma.MessageGetPayload<object>;

/** Whether a queued message still says something true, asked just before it is sent. */
export type StillWanted = (message: { guestId: string | null; eventId: string | null }) => Promise<boolean>;

@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);
  private readonly stillWanted = new Map<string, StillWanted>();
  private readonly emailQuota: EmailQuotaService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transports: Map<MessageChannel, MessageTransport>,
    private readonly suppressions: SuppressionService,
  ) { this.emailQuota = new EmailQuotaService(prisma); }

  /**
   * Lets the module that sends a kind of message withdraw it at the last
   * moment if it no longer applies. A reminder to answer was queued by a sweep
   * that read "unanswered" just before the answer landed, and went out anyway
   * (B87); the answer withdraws what is already queued, and this catches what
   * is queued after.
   */
  checkBeforeSending(templateKey: string, check: StillWanted): void {
    this.stillWanted.set(templateKey, check);
  }

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
    const template = await this.loadTemplate(params.organizationId, params.templateKey, params.channel);
    return this.createOnce(params.dedupeKey, messageData(params, template, isSuppressed));
  }

  /**
   * Many messages at once, each keyed for deduplication: one read for those
   * already queued, one for suppressions, each template once, one insert.
   * A send of four hundred households ran four queries per guest through
   * `enqueue` — one to three seconds (B91). Returned by dedupe key.
   */
  async enqueueMany(list: (EnqueueParams & { dedupeKey: string })[]): Promise<Map<string, DueMessage>> {
    const byKey = new Map<string, DueMessage>();
    if (list.length === 0) return byKey;
    const keys = list.map((params) => params.dedupeKey);
    for (const message of await this.prisma.message.findMany({ where: { dedupeKey: { in: keys } } })) byKey.set(message.dedupeKey!, message);

    const todo = list.filter((params) => !byKey.has(params.dedupeKey));
    const data = await this.renderAll(todo);
    if (data.length > 0) {
      await this.prisma.message.createMany({ data, skipDuplicates: true });
      // Read back rather than trusting the insert's return: a concurrent send
      // may have inserted some keys first, and theirs are the messages.
      for (const message of await this.prisma.message.findMany({ where: { dedupeKey: { in: todo.map((params) => params.dedupeKey) } } })) {
        byKey.set(message.dedupeKey!, message);
      }
    }
    return byKey;
  }

  private async renderAll(list: EnqueueParams[]): Promise<Prisma.MessageCreateManyInput[]> {
    const templates = new Map<string, Awaited<ReturnType<CommunicationsService['loadTemplate']>>>();
    const suppressedByOrganization = new Map<string | null, Set<string>>();
    for (const organizationId of new Set(list.map((params) => params.organizationId))) {
      const theirs = list.filter((params) => params.organizationId === organizationId);
      suppressedByOrganization.set(organizationId, await this.suppressions.suppressedAmong(organizationId, theirs.map((params) => ({ channel: params.channel, address: params.toAddress }))));
    }
    const data: Prisma.MessageCreateManyInput[] = [];
    for (const params of list) {
      const templateKey = `${params.organizationId}|${params.templateKey}|${params.channel}`;
      if (!templates.has(templateKey)) templates.set(templateKey, await this.loadTemplate(params.organizationId, params.templateKey, params.channel));
      const isSuppressed = suppressedByOrganization.get(params.organizationId)!.has(`${params.channel}|${normalizeAddress(params.channel, params.toAddress)}`);
      data.push(messageData(params, templates.get(templateKey)!, isSuppressed));
    }
    return data;
  }

  /**
   * Inserts the message, or returns the one a concurrent caller inserted
   * under the same dedupe key. Two sends at once both passed the read above,
   * and the loser's unique violation became a 409 that also abandoned every
   * guest after it in the loop (B87).
   */
  private async createOnce(dedupeKey: string | undefined, data: Prisma.MessageUncheckedCreateInput) {
    try {
      return await this.prisma.message.create({ data });
    } catch (error) {
      if (!dedupeKey || !isUniqueViolation(error)) throw error;
      return this.prisma.message.findUniqueOrThrow({ where: { dedupeKey } });
    }
  }

  /**
   * Sends everything due. Claims each message by moving it to SENDING first,
   * conditioned on it still being QUEUED, so two dispatchers running at once
   * cannot both send the same message.
   *
   * Each message is on its own: one that throws is put back in the queue and
   * the rest of the batch goes on. It used to abort the batch and leave that
   * message in SENDING for good.
   */
  async dispatchDue(
    limit = 50,
  ): Promise<{ sent: number; failed: number; suppressed: number; retrying: number }> {
    await this.recoverStranded();

    // Batches until the run's budget is spent, a few sends at a time. One
    // batch of fifty, one by one, capped the outbox at 3,000 an hour however
    // fast the mail server was, and a large send delayed everything behind it.
    const tally = { sent: 0, failed: 0, suppressed: 0, retrying: 0 };
    const deadline = Date.now() + DISPATCH_BUDGET_MS;
    const blockedChannels = new Set<MessageChannel>();
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN && Date.now() < deadline; batch += 1) {
      const due = await this.prisma.message.findMany({
        where: { status: MessageStatus.QUEUED, scheduledFor: { lte: new Date() }, channel: { notIn: [...blockedChannels] } },
        orderBy: [{ priority: 'desc' }, { scheduledFor: 'asc' }],
        take: limit,
      });
      if (due.length === 0) break;
      const retryAt = await this.dispatchBatch(due, tally);
      if (!retryAt) continue;
      if (retryAt.getTime() >= deadline) blockedChannels.add(MessageChannel.EMAIL);
      else await pause(Math.max(0, retryAt.getTime() - Date.now()));
    }
    return tally;
  }

  private async dispatchBatch(
    due: DueMessage[],
    tally: { sent: number; failed: number; suppressed: number; retrying: number },
  ): Promise<Date | null> {
    const concurrency = Number(process.env.EMAIL_SEND_CONCURRENCY ?? SENDS_AT_ONCE);
    for (let start = 0; start < due.length; start += concurrency) {
      const outcomes = await Promise.all(
        due.slice(start, start + concurrency).map((message) => this.dispatchSafely(message)),
      );
      for (const outcome of outcomes) if (typeof outcome === 'string' && outcome !== 'TAKEN') tally[TALLY_KEY[outcome]] += 1;
      const waiting = outcomes.find((outcome) => outcome instanceof EmailQuotaWaitError);
      if (waiting) return waiting.retryAt;
    }
    return null;
  }

  private async dispatchSafely(message: DueMessage): Promise<DispatchOutcome | EmailQuotaWaitError> {
    // Budget infrastructure failures must reach the sweep monitor. No claim
    // or delivery attempt happens until a durable allowance is available.
    if (message.channel === MessageChannel.EMAIL) {
      const retryAt = await this.emailQuota.reserve();
      if (retryAt) return new EmailQuotaWaitError(retryAt);
    }
    try { return await this.dispatchOne(message); }
    catch (error) {
      if (error instanceof SentButUnrecordedError) return this.leaveSent(error);
      return this.requeueAfterError(message.id, error);
    }
  }

  private async dispatchOne(message: DueMessage): Promise<DispatchOutcome> {
    const attempt = await this.claim(message.id);
    if (attempt === null) return 'TAKEN';

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
      return 'SUPPRESSED';
    }
    if (!(await this.isStillWanted(message))) {
      await this.prisma.message.update({
        where: { id: message.id },
        data: { status: MessageStatus.CANCELLED, failureReason: 'No longer applied when it was due to be sent' },
      });
      return 'TAKEN';
    }

    return this.deliver({ ...message, attempts: attempt });
  }

  private async isStillWanted(message: DueMessage): Promise<boolean> {
    const check = message.templateKey ? this.stillWanted.get(message.templateKey) : undefined;
    return check ? check(message) : true;
  }

  /**
   * Returns messages a crash or a deploy left in SENDING.
   *
   * At-least-once: if the process died after the provider accepted a message
   * and before it was recorded, that message goes out twice. A duplicate is
   * the better failure — the alternative was a guest who was never invited
   * and never retried, because SENDING counts as "on its way".
   */
  private async recoverStranded(now = new Date()): Promise<void> {
    const stranded = {
      status: MessageStatus.SENDING,
      updatedAt: { lt: new Date(now.getTime() - STRANDED_AFTER_MS) },
    };

    await this.prisma.message.updateMany({
      where: { ...stranded, attempts: { gte: MAX_DELIVERY_ATTEMPTS } },
      data: { status: MessageStatus.FAILED, failureReason: 'Interrupted while sending, with no attempts left' },
    });
    const recovered = await this.prisma.message.updateMany({
      where: stranded,
      data: { status: MessageStatus.QUEUED, scheduledFor: now, failureReason: 'Interrupted while sending' },
    });
    if (recovered.count > 0) {
      this.logger.warn(`returned ${recovered.count} message(s) interrupted while sending to the queue`);
    }
  }

  /** Out, but the record says otherwise. Loud, and never re-queued. */
  private leaveSent(error: SentButUnrecordedError): DispatchOutcome {
    this.logger.error(error.message);
    return 'SENT';
  }

  /** One message failed in a way nobody classified; it waits and tries again. */
  private async requeueAfterError(messageId: string, error: unknown): Promise<DispatchOutcome> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`dispatching message ${messageId} failed: ${message}`);

    const row = await this.prisma.message.findUnique({ where: { id: messageId }, select: { attempts: true } });
    await this.prisma.message.updateMany({
      where: { id: messageId, status: MessageStatus.SENDING },
      data: {
        status: MessageStatus.QUEUED,
        failureReason: message,
        scheduledFor: nextAttemptAt(row?.attempts ?? 1, new Date()),
      },
    });
    return 'RETRYING';
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

    let result: DeliveryResult;
    try {
      result = await transport.send({
        messageId: message.id,
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
    } catch (error) {
      return this.handleFailure(message, error);
    }

    // Outside the try above: once the provider has it, nothing that goes
    // wrong here is a delivery failure, and retrying would send it again.
    await this.recordSent(message.id, result);
    return 'SENT';
  }

  /**
   * Records that the provider accepted a message.
   *
   * Tried a few times, because the message is already out and a database blip
   * should not leave it looking unsent. If it still cannot be written, the
   * row stays SENDING rather than going back to the queue: the stranded-send
   * sweep will pick it up much later, at worst once — not up to five times on
   * the retry schedule.
   */
  private async recordSent(messageId: string, result: DeliveryResult): Promise<void> {
    const data = {
      status: result.isDelivered ? MessageStatus.DELIVERED : MessageStatus.SENT,
      providerRef: result.providerRef ?? null,
      failureReason: null,
      sentAt: new Date(),
      deliveredAt: result.isDelivered ? new Date() : null,
    };

    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // A callback may have already recorded delivery or a permanent
          // failure while SMTP acknowledgement was still returning.
          await tx.message.updateMany({ where: { id: messageId, status: MessageStatus.SENDING }, data });
          await tx.message.updateMany({ where: { id: messageId, sentAt: null }, data: { sentAt: data.sentAt, providerRef: data.providerRef } });
        });
        return;
      } catch (error) {
        if (attempt >= RECORD_SENT_ATTEMPTS) throw new SentButUnrecordedError(messageId, error);
        await pause(RECORD_SENT_BACKOFF_MS * attempt);
      }
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

/** A message as it is stored: rendered now, so what was sent stays knowable after the copy changes. */
function messageData(
  params: EnqueueParams,
  template: { subject: Prisma.JsonValue; body: Prisma.JsonValue; providerTemplate: string | null; providerParams: string[] },
  isSuppressed: boolean,
): Prisma.MessageUncheckedCreateInput {
  const subject = resolveTranslation<string>(template.subject, params.locale, 'hy');
  const body = resolveTranslation<string>(template.body, params.locale, 'hy');
  if (body === null) throw new NotFoundException(`Template "${params.templateKey}" has no body for any locale`);

  return {
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
    priority: priorityFor(params.templateKey),
    dedupeKey: params.dedupeKey ?? null,
    // Resolved here, not at dispatch, for the same reason the body is.
    providerTemplate: template.providerTemplate,
    providerParams: template.providerTemplate ? positionalParams(template.providerParams, params.variables) : [],
    // Recorded rather than dropped: a host asking why a guest never got
    // their invitation deserves the answer "they opted out", and a message
    // that silently never existed cannot give it.
    ...queueState(isSuppressed),
  };
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

/** How long one dispatch run keeps sending, inside its one-minute schedule. */
const DISPATCH_BUDGET_MS = 40_000;
/** A ceiling regardless of speed, so a run always ends. */
const MAX_BATCHES_PER_RUN = 40;
/** Sends in flight at once: enough to overlap mail-server round trips, few enough to stay polite. */
const SENDS_AT_ONCE = 5;

/** How many times to try recording a send the provider has accepted. */
const RECORD_SENT_ATTEMPTS = 3;
const RECORD_SENT_BACKOFF_MS = 200;

/** The provider accepted the message; writing that down failed. */
class SentButUnrecordedError extends Error {
  constructor(messageId: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`message ${messageId} was sent, but recording it failed: ${reason}. Left as SENDING, not re-queued`);
  }
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
