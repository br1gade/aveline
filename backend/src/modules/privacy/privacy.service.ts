import { EnquiryPrivacyService } from '../sales/enquiry-privacy.service';
import { EnquiryPrivacySubject } from '../sales/enquiry-privacy';
import { reconcileInactiveOwnerReviews } from '../organizations/organization-reviews.service';
import { exportContributions } from '../guest-contributions/contribution-privacy';
import { attendeeSubject, exportAttendees } from '../ticketing/attendee-privacy';
import { BadRequestException, ConflictException, Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import {
  DataSubjectRequestKind,
  DataSubjectRequestStatus,
  MessageChannel,
  Prisma,
} from '@prisma/client';
import { Sentry } from '../../infra/observability/sentry';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { AuditService } from '../../infra/audit/audit.service';
import { AnalyticsService } from '../../infra/analytics/analytics.service';
import { addressFingerprint } from '../communications/address-form';
import { eraseSubject, sameAddress } from './erasure';
import { statusChangeProblem } from './request-status';
import {
  CreateDataSubjectRequestDto,
  UpdateDataSubjectRequestDto,
} from './dto/privacy.dto';

/** GDPR Article 12: one month from receipt. */
const RESPONSE_WINDOW_DAYS = 30;

/** How much warning is useful: a week is enough to verify an identity and act. */
const WARNING_WINDOW_DAYS = 7;

const OPEN_STATUSES: DataSubjectRequestStatus[] = [
  DataSubjectRequestStatus.RECEIVED,
  DataSubjectRequestStatus.VERIFYING,
  DataSubjectRequestStatus.IN_PROGRESS,
];

const ERASURE_TIMEOUT_MS = 60_000;

/** Repeat submissions add their notes, up to this much in all. */
const NOTES_LIMIT = 20_000;

function completedBy(userId: string) {
  return { status: DataSubjectRequestStatus.COMPLETED, completedAt: new Date(), handledByUserId: userId };
}

@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  @Inject(EnquiryPrivacyService)
  private readonly enquiryPrivacy?: EnquiryPrivacyService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * Records a request from the public.
   *
   * The response never says whether the address is known to us. "We hold
   * nothing about you" is itself information about that address, and anyone
   * can post an arbitrary email here.
   *
   * An open request for the same address and kind is kept rather than
   * duplicated: twenty copies of one erasure request is twenty clocks to
   * answer and one person to answer them. The answer does not show it,
   * though. Returning the open request's reference, status and deadline told
   * whoever typed the address that someone else had already asked, when, and
   * how far staff had got; so every submission gets the same fresh receipt,
   * and anything new in its notes is added to the open request.
   */
  async submit(dto: CreateDataSubjectRequestDto) {
    const subjectEmail = dto.subjectEmail.trim().toLowerCase();
    const dueAt = new Date(Date.now() + RESPONSE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const open = await this.prisma.dataSubjectRequest.findFirst({
      where: { subjectEmail, kind: dto.kind, status: { in: OPEN_STATUSES } },
      select: { id: true, notes: true },
    });

    const request = open
      ? await this.addNotes(open, dto.notes)
      : await this.prisma.dataSubjectRequest.create({
          data: { kind: dto.kind, subjectEmail, notes: dto.notes ?? null, dueAt },
          select: { id: true },
        });

    this.logger.log(`data-subject request ${request.id} (${dto.kind}) recorded`);

    return {
      kind: dto.kind,
      status: DataSubjectRequestStatus.RECEIVED,
      dueAt,
      // Said to everyone, whether or not we hold anything.
      message:
        'Your request has been recorded. We will verify your identity and respond within one month.',
    };
  }

  private async addNotes(open: { id: string; notes: string | null }, notes: string | undefined) {
    if (!notes || (open.notes?.length ?? 0) + notes.length > NOTES_LIMIT) return open;
    return this.prisma.dataSubjectRequest.update({
      where: { id: open.id },
      data: { notes: open.notes ? `${open.notes}\n\n${notes}` : notes },
      select: { id: true },
    });
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
    const request = await this.require(requestId);
    if (dto.status) {
      const problem = statusChangeProblem(request.kind, request.status, dto.status);
      if (problem) throw new BadRequestException(problem);
    }

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

    const subject = this.enquiryPrivacy ? await this.enquiryPrivacy.resolveSubject(requestId) : { email: request.subjectEmail, verifiedContactIds: [] };
    const completion = { requestId, userId };
    const result =
      request.kind === DataSubjectRequestKind.EXPORT
        ? await this.assembleExport(subject, request.id)
        : await this.erase(subject, completion);

    if (request.kind === DataSubjectRequestKind.EXPORT) {
      await this.prisma.dataSubjectRequest.updateMany({ where: { id: requestId }, data: completedBy(userId) });
    }
    return { reference: requestId, kind: request.kind, ...result };
  }

  /**
   * Everything held against one address, as JSON.
   *
   * Assembled on demand rather than stored: a copy of someone's data sitting
   * in object storage waiting to be collected is a second place it can leak
   * from.
   */
  private async assembleExport(subject: EnquiryPrivacySubject, requestId: string) {
    const legacy = subject.email ? await this.assembleEmailExport(subject.email, requestId) : {
      subjectEmail: null, assembledAt: new Date().toISOString(), account: null, guestRecords: [],
      contributions: [], ticketAttendees: [], ticketOrders: [], messagesSent: [], suppressions: [],
    };
    const enquiries = this.enquiryPrivacy ? await this.enquiryPrivacy.exportSubject(subject) : [];
    return { ...legacy, enquiries };
  }

  private async assembleEmailExport(subjectEmail: string, requestId: string) {
    const [user, guests, ticketOrders, messages, suppressions, ticketAttendees, contributions] = await Promise.all([
      this.prisma.user.findFirst({
        where: { email: sameAddress(subjectEmail) },
        select: { email: true, name: true, createdAt: true, lastLoginAt: true },
      }),
      this.prisma.guest.findMany({
        where: { OR: [{ email: sameAddress(subjectEmail) }, { ticket: { attendee: attendeeSubject(subjectEmail) } }] },
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
          rsvp: { include: { answers: { select: { value: true, question: { select: { prompt: true } } } } } },
          attendanceResponses: { select: { revision: true, venueId: true, status: true, respondedAt: true, policy: { select: { mode: true } } } },
          channels: { select: { channel: true, address: true, optedInAt: true } },
          checkIn: { select: { arrivedAt: true } },
        },
      }),
      this.prisma.ticketOrder.findMany({
        where: { buyerEmail: sameAddress(subjectEmail) },
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
        where: { toAddress: sameAddress(subjectEmail) },
        select: { channel: true, templateKey: true, status: true, sentAt: true, subject: true },
        take: 500,
      }),
      this.suppressionsOf(subjectEmail),
      exportAttendees(this.prisma, subjectEmail),
      exportContributions(this.prisma, subjectEmail, requestId),
    ]);

    return {
      subjectEmail,
      assembledAt: new Date().toISOString(),
      account: user,
      guestRecords: guests,
      contributions,
      ticketAttendees,
      ticketOrders: ticketOrders.map((order) => ({ ...order, totalMinor: order.totalMinor.toString() })),
      messagesSent: messages,
      suppressions,
    };
  }

  /** Their do-not-contact records, including those an earlier erasure left hashed. */
  private suppressionsOf(subjectEmail: string) {
    return this.prisma.suppression.findMany({
      where: {
        OR: [
          { address: sameAddress(subjectEmail) },
          { address: addressFingerprint(MessageChannel.EMAIL, subjectEmail) },
        ],
      },
      select: { channel: true, reason: true, createdAt: true },
    });
  }

  /**
   * Erases the personal data held against an address — see `erasure.ts` for
   * what goes and what stays.
   *
   * A longer timeout than Prisma's five seconds: it matches addresses
   * case-insensitively across messages and orders, which on a large platform
   * is a scan, and running out of time rolls the whole erasure back. Files and
   * Mongo are cleared only once Postgres has committed, so a rollback never
   * leaves a guest whose signature is already gone.
   */
  private async erase(subject: EnquiryPrivacySubject, completion: { requestId: string; userId: string }) {
    const applied = await this.applyErasure(subject, completion);
    const request = await this.prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: completion.requestId } });
    if (!request.erasureAppliedAt) return applied.counts;
    try { if (this.enquiryPrivacy) await this.enquiryPrivacy.checkpoint(); }
    catch { this.logger.error('Intake erasure applied; protected journal checkpoint recovery is pending'); return { ...applied.counts, recoveryPending: true }; }
    const outstanding = await this.prisma.enquiryPrivacyRedaction.count({ where: { contactId: { in: subject.verifiedContactIds }, checkpointedAt: null } });
    if (outstanding) return { ...applied.counts, recoveryPending: true };
    await this.prisma.dataSubjectRequest.updateMany({ where: { id: completion.requestId, status: 'IN_PROGRESS', erasureAppliedAt: { not: null } }, data: completedBy(completion.userId) });
    return applied.counts;
  }

  private async applyErasure(subject: EnquiryPrivacySubject, completion: { requestId: string; userId: string }) {
    const applied = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM data_subject_requests WHERE id=${completion.requestId} FOR UPDATE`;
      const request = await tx.dataSubjectRequest.findUniqueOrThrow({ where: { id: completion.requestId } });
      if (request.status !== 'IN_PROGRESS') throw new ConflictException('This request is being carried out by someone else, or already was');
      if (request.erasureAppliedAt) return { counts: request.erasureResult as Record<string, number>, afterwards: null };
      const erased = subject.email
        ? await eraseSubject(tx, subject.email, new Date(), subject)
        : { counts: await this.enquiryPrivacy!.eraseInTransaction(tx, { subject, now: new Date(), requestId: request.id }), afterwards: null };
      const pending = await tx.enquiryPrivacyRedaction.count({ where: { contactId: { in: subject.verifiedContactIds }, checkpointedAt: null } });
      const hasIntakeRedactions = erased.counts.enquiriesCleared > 0 || pending > 0;
      await tx.dataSubjectRequest.update({ where: { id: request.id }, data: hasIntakeRedactions
        ? { erasureAppliedAt: new Date(), erasureCheckpointId: request.id, erasureResult: erased.counts, handledByUserId: completion.userId }
        : completedBy(completion.userId) });
      return erased;
    }, { timeout: ERASURE_TIMEOUT_MS });
    if (applied.afterwards?.userId) await reconcileInactiveOwnerReviews(this.prisma, applied.afterwards.userId);
    if (applied.afterwards && subject.email) await Promise.all([
      Promise.allSettled(applied.afterwards.fileUrls.map((url) => this.storage.removeByUrl(url))),
      this.audit.forgetPerson({ email: subject.email, userId: applied.afterwards.userId }),
      this.analytics.forgetGuests(applied.afterwards.guestIds),
    ]);
    return applied;
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
