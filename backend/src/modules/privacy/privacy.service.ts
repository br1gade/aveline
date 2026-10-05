import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DataSubjectRequestKind,
  DataSubjectRequestStatus,
  MessageChannel,
  Prisma,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { Sentry } from '../../infra/observability/sentry';
import { PrismaService } from '../../prisma/prisma.service';
import { ERASED_RSVP_FIELDS, anonymisedGuestFields } from './anonymisation';
import {
  CreateDataSubjectRequestDto,
  UpdateDataSubjectRequestDto,
} from './dto/privacy.dto';

/** GDPR Article 12: one month from receipt. */
const RESPONSE_WINDOW_DAYS = 30;

/** How much warning is useful: a week is enough to verify an identity and act. */
const WARNING_WINDOW_DAYS = 7;

@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a request from the public.
   *
   * The response never says whether the address is known to us. "We hold
   * nothing about you" is itself information about that address, and anyone
   * can post an arbitrary email here.
   *
   * An open request for the same address and kind is returned rather than
   * duplicated: twenty copies of one erasure request is twenty clocks to
   * answer and one person to answer them.
   */
  async submit(dto: CreateDataSubjectRequestDto) {
    const subjectEmail = dto.subjectEmail.trim().toLowerCase();

    const open = await this.prisma.dataSubjectRequest.findFirst({
      where: {
        subjectEmail,
        kind: dto.kind,
        status: {
          in: [
            DataSubjectRequestStatus.RECEIVED,
            DataSubjectRequestStatus.VERIFYING,
            DataSubjectRequestStatus.IN_PROGRESS,
          ],
        },
      },
    });

    const request =
      open ??
      (await this.prisma.dataSubjectRequest.create({
        data: {
          kind: dto.kind,
          subjectEmail,
          notes: dto.notes ?? null,
          dueAt: new Date(Date.now() + RESPONSE_WINDOW_DAYS * 24 * 60 * 60 * 1000),
        },
      }));

    this.logger.log(`data-subject request ${request.id} (${request.kind}) recorded`);

    return {
      reference: request.id,
      kind: request.kind,
      status: request.status,
      dueAt: request.dueAt,
      // Said to everyone, whether or not we hold anything.
      message:
        'Your request has been recorded. We will verify your identity and respond within one month.',
    };
  }

  async list(status?: DataSubjectRequestStatus) {
    return this.prisma.dataSubjectRequest.findMany({
      where: { status },
      // Soonest due first: this list is a deadline queue, not a feed.
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      take: 200,
    });
  }

  async update(requestId: string, userId: string, dto: UpdateDataSubjectRequestDto) {
    await this.require(requestId);

    return this.prisma.dataSubjectRequest.update({
      where: { id: requestId },
      data: {
        status: dto.status ?? undefined,
        notes: dto.notes ?? undefined,
        handledByUserId: userId,
        completedAt:
          dto.status === DataSubjectRequestStatus.COMPLETED ||
          dto.status === DataSubjectRequestStatus.REJECTED
            ? new Date()
            : undefined,
      },
    });
  }

  /**
   * Carries out a verified request.
   *
   * Only from IN_PROGRESS, which a human has to set after establishing who the
   * requester is. Acting on an unverified request is itself a breach — it
   * would let anyone erase or exfiltrate a stranger's data by typing their
   * address into a public form.
   */
  async fulfil(requestId: string, userId: string) {
    const request = await this.require(requestId);

    if (request.status !== DataSubjectRequestStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `A request must be IN_PROGRESS to be carried out; this one is ${request.status}. ` +
          'Verify the requester’s identity first.',
      );
    }

    // Checked before anything acts. Falling through to the erasure branch and
    // raising afterwards would erase the data of someone who asked for a
    // correction.
    if (request.kind === DataSubjectRequestKind.RECTIFICATION) {
      throw new BadRequestException(
        'A rectification is applied by editing the record directly; close this request once it is done',
      );
    }

    const result =
      request.kind === DataSubjectRequestKind.EXPORT
        ? await this.assembleExport(request.subjectEmail)
        : await this.erase(request.subjectEmail);

    await this.prisma.dataSubjectRequest.update({
      where: { id: requestId },
      data: {
        status: DataSubjectRequestStatus.COMPLETED,
        completedAt: new Date(),
        handledByUserId: userId,
      },
    });

    return { reference: requestId, kind: request.kind, ...result };
  }

  /**
   * Everything held against one address, as JSON.
   *
   * Assembled on demand rather than stored: a copy of someone's data sitting
   * in object storage waiting to be collected is a second place it can leak
   * from.
   */
  private async assembleExport(subjectEmail: string) {
    const [user, guests, ticketOrders, messages, suppressions] = await Promise.all([
      this.prisma.user.findUnique({
        where: { email: subjectEmail },
        select: { email: true, name: true, createdAt: true, lastLoginAt: true },
      }),
      this.prisma.guest.findMany({
        where: { email: subjectEmail },
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          locale: true,
          attribution: true,
          consentAt: true,
          consentSource: true,
          event: { select: { title: true, startsAt: true } },
          household: { select: { name: true } },
          rsvp: true,
          checkIn: { select: { arrivedAt: true } },
        },
      }),
      this.prisma.ticketOrder.findMany({
        where: { buyerEmail: subjectEmail },
        select: {
          buyerName: true,
          buyerEmail: true,
          buyerPhone: true,
          totalMinor: true,
          currency: true,
          status: true,
          createdAt: true,
          event: { select: { title: true } },
        },
      }),
      this.prisma.message.findMany({
        where: { toAddress: subjectEmail },
        select: { channel: true, templateKey: true, status: true, sentAt: true, subject: true },
        take: 500,
      }),
      this.prisma.suppression.findMany({
        where: { address: subjectEmail },
        select: { channel: true, reason: true, createdAt: true },
      }),
    ]);

    return {
      subjectEmail,
      assembledAt: new Date().toISOString(),
      account: user,
      guestRecords: guests,
      ticketOrders: ticketOrders.map((order) => ({
        ...order,
        totalMinor: order.totalMinor.toString(),
      })),
      messagesSent: messages,
      suppressions,
    };
  }

  /**
   * Erases the personal data held against an address.
   *
   * What survives is deliberate: the household, the seat and the response
   * status stay, so a headcount the caterer was already paid for does not
   * change. A paid ticket order keeps its amount — a financial record has its
   * own retention obligation that Article 17 does not override — but loses the
   * buyer's name and contact details.
   */
  private async erase(subjectEmail: string) {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const guests = await tx.guest.findMany({
        where: { email: subjectEmail, anonymizedAt: null },
        select: { id: true },
      });

      for (const guest of guests) {
        await tx.guest.update({
          where: { id: guest.id },
          data: anonymisedGuestFields(randomBytes(16).toString('hex'), now),
        });
        await tx.rsvp.updateMany({ where: { guestId: guest.id }, data: ERASED_RSVP_FIELDS });
      }

      const orders = await tx.ticketOrder.updateMany({
        where: { buyerEmail: subjectEmail },
        data: {
          buyerName: 'Removed',
          buyerEmail: `erased-${randomBytes(8).toString('hex')}@erased.invalid`,
          buyerPhone: null,
        },
      });

      // The content of past messages is personal data; that one was sent is a
      // record of processing we are obliged to be able to show.
      const messages = await tx.message.updateMany({
        where: { toAddress: subjectEmail },
        data: { subject: null, body: '[erased]' },
      });

      // Suppression rows hold the address itself, so they go too. The address
      // is no longer ours to keep, not even to remember not to write to it.
      const removedSuppressions = await tx.suppression.deleteMany({
        where: { address: subjectEmail, channel: MessageChannel.EMAIL },
      });

      return {
        guestsAnonymised: guests.length,
        ticketOrdersAnonymised: orders.count,
        messagesRedacted: messages.count,
        suppressionsRemoved: removedSuppressions.count,
      };
    });
  }

  /**
   * Requests whose one-month clock is running down.
   *
   * GDPR Article 12 gives a month from receipt, and the penalty for missing it
   * falls on us, not on whoever forgot. The schema has carried the deadline
   * and an index on it since the privacy work; nothing read them, so the clock
   * was stored and never watched — which is the same as not having one.
   *
   * Returns the overdue separately from the merely close, because they need
   * different responses: one is a breach to disclose, the other is a day's work
   * to schedule.
   */
  async dueSoon(now = new Date(), withinDays = WARNING_WINDOW_DAYS) {
    const horizon = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

    const open = await this.prisma.dataSubjectRequest.findMany({
      where: {
        status: {
          in: [
            DataSubjectRequestStatus.RECEIVED,
            DataSubjectRequestStatus.VERIFYING,
            DataSubjectRequestStatus.IN_PROGRESS,
          ],
        },
        dueAt: { lte: horizon },
      },
      orderBy: { dueAt: 'asc' },
      select: { id: true, kind: true, status: true, subjectEmail: true, dueAt: true },
    });

    const overdue = open.filter((request) => request.dueAt <= now);
    return { overdue, dueSoon: open.filter((request) => request.dueAt > now) };
  }

  /**
   * The sweep's report, logged and raised so a missed deadline is noticed.
   *
   * Deliberately loud rather than a dashboard nobody opens: an overdue
   * data-subject request is a regulatory exposure, and the failure mode is
   * that everyone assumed someone else was watching.
   */
  async reportDueRequests(now = new Date()): Promise<{ overdue: number; dueSoon: number }> {
    const { overdue, dueSoon } = await this.dueSoon(now);

    if (overdue.length > 0) {
      this.logger.error(
        `${overdue.length} data-subject request(s) are past their one-month deadline: ` +
          overdue.map((request) => `${request.id} (${request.kind})`).join(', '),
      );
      // Raised, not only logged: a log line nobody reads is how a deadline
      // gets missed in the first place.
      Sentry.captureMessage(
        `${overdue.length} data-subject request(s) past the GDPR deadline`,
        'error',
      );
    }

    if (dueSoon.length > 0) {
      this.logger.warn(`${dueSoon.length} data-subject request(s) due within ${WARNING_WINDOW_DAYS} days`);
    }

    return { overdue: overdue.length, dueSoon: dueSoon.length };
  }

  private async require(requestId: string) {
    const request = await this.prisma.dataSubjectRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('No such request');
    return request;
  }
}

export type DataSubjectRequestRow = Prisma.DataSubjectRequestGetPayload<object>;
