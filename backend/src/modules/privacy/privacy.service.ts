import { randomUUID } from 'node:crypto';
import { lockExportPrivacy } from '../exports/export-privacy';
import { lockIntake } from '../sales/enquiry-lock';
import { EnquiryPrivacyService } from '../sales/enquiry-privacy.service';
import { EnquiryPrivacySubject } from '../sales/enquiry-privacy';
import { exportTemplateAuthorship } from '../design/templates/template-privacy';
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
import { recordPublicSubmission } from './public-submissions';
import { PaginationQuery, resolvePaging, toPage } from '../../common/dto/pagination.dto';
import {
  CreateDataSubjectRequestDto,
  UpdateDataSubjectRequestDto,
} from './dto/privacy.dto';

/** GDPR Article 12: one month from receipt. */
const RESPONSE_WINDOW_DAYS = 30;

/** How much warning is useful: a week is enough to verify an identity and act. */
const WARNING_WINDOW_DAYS = 7;

const ERASURE_TIMEOUT_MS = 60_000;

function completedBy(userId: string) {
  return { status: DataSubjectRequestStatus.COMPLETED, completedAt: new Date(), handledByUserId: userId };
}

function deliveryReceipt(request: { id: string; completedAt: Date | null; exportGenerationId: string | null }) {
  return { reference: request.id, status: DataSubjectRequestStatus.COMPLETED, generationId: request.exportGenerationId, completedAt: request.completedAt };
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
   * and every submission is stored separately as unverified public input.
   */
  async submit(dto: CreateDataSubjectRequestDto) {
    const dueAt = new Date(Date.now() + RESPONSE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const request = await recordPublicSubmission(this.prisma, dto, dueAt);

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

  async submissions(requestId: string, query: PaginationQuery) {
    await this.require(requestId);
    const paging = resolvePaging(query);
    return this.prisma.$transaction(async (tx) => {
      const where = { requestId };
      const [rows, total] = await Promise.all([
        tx.privacyRequestSubmission.findMany({ where, ...paging, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, notes: true, createdAt: true } }),
        tx.privacyRequestSubmission.count({ where }),
      ]);
      return toPage(rows.map((row) => ({ ...row, source: 'UNVERIFIED_PUBLIC' as const })), total, paging);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
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
    return this.prisma.$transaction(async (tx) => {
      // Read under the same row lock as fulfilment so staff see any committed erasure.
      await lockPrivacyRequest(tx, requestId);
      const request = await this.require(requestId, tx);
      if (dto.status === DataSubjectRequestStatus.REJECTED && request.erasureAppliedAt) {
        throw new BadRequestException('status: an applied erasure cannot be rejected');
      }
      if (dto.status) {
        const problem = statusChangeProblem(request.kind, request.status, dto.status);
        if (problem) throw new BadRequestException(problem);
      }

      return tx.dataSubjectRequest.update({
        where: { id: requestId },
        data: {
          status: dto.status ?? undefined,
          notes: dto.notes ?? undefined,
          handledByUserId: userId,
          completedAt: dto.status !== request.status &&
            (dto.status === DataSubjectRequestStatus.COMPLETED || dto.status === DataSubjectRequestStatus.REJECTED)
            ? new Date() : undefined,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
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

    const completion = { requestId, userId };
    const result = request.kind === DataSubjectRequestKind.EXPORT
      ? await this.fulfilExport(completion)
      : await this.erase(this.enquiryPrivacy ? await this.enquiryPrivacy.resolveSubject(requestId) : { email: request.subjectEmail, verifiedContactIds: [] }, completion);

    return { reference: requestId, kind: request.kind, ...result };
  }

  private fulfilExport(completion: { requestId: string; userId: string }) {
    return this.prisma.$transaction(async (tx) => {
      await lockPrivacyRequest(tx, completion.requestId);
      const request = await tx.dataSubjectRequest.findUniqueOrThrow({ where: { id: completion.requestId } });
      if (request.status !== 'IN_PROGRESS' || request.kind !== 'EXPORT') throw new ConflictException('This export request changed or was already carried out');
      await lockExportPrivacy(tx);
      await lockIntake(tx);
      const subject = this.enquiryPrivacy ? await this.enquiryPrivacy.resolveSubject(request.id, tx) : { email: request.subjectEmail, verifiedContactIds: [] };
      const result = await this.assembleExport(subject, request.id, tx);
      const generationId = randomUUID();
      await tx.dataSubjectRequest.update({ where: { id: request.id }, data: {
        exportGenerationId: generationId, exportGeneratedAt: new Date(), exportGeneratedByUserId: completion.userId,
      } });
      return { ...result, generationId };
    }, { timeout: ERASURE_TIMEOUT_MS });
  }

  async confirmExportDelivery(requestId: string, userId: string, generationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockPrivacyRequest(tx, requestId);
      const request = await this.require(requestId, tx);
      if (request.kind !== 'EXPORT' || request.exportGenerationId !== generationId) {
        throw new ConflictException('Only the latest export generation can be confirmed');
      }
      if (request.status === 'COMPLETED') return deliveryReceipt(request);
      if (request.status !== 'IN_PROGRESS') throw new ConflictException('This export request is closed');

      return deliveryReceipt(await tx.dataSubjectRequest.update({ where: { id: requestId }, data: {
        ...completedBy(userId), exportDeliveredByUserId: userId,
      } }));
    });
  }

  /**
   * Everything held against one address, as JSON.
   *
   * Assembled on demand rather than stored: a copy of someone's data sitting
   * in object storage waiting to be collected is a second place it can leak
   * from.
   */
  private async assembleExport(subject: EnquiryPrivacySubject, requestId: string, tx: Prisma.TransactionClient) {
    const legacy = subject.email ? await this.assembleEmailExport(subject.email, requestId, tx) : {
      subjectEmail: null, assembledAt: new Date().toISOString(), account: null, guestRecords: [],
      contributions: [], templateAuthorship: null, ticketAttendees: [], ticketOrders: [], messagesSent: [], suppressions: [],
    };
    const enquiries = this.enquiryPrivacy ? await this.enquiryPrivacy.exportSubject(subject, tx) : [];
    return { ...legacy, enquiries };
  }

  private async assembleEmailExport(subjectEmail: string, requestId: string, tx: Prisma.TransactionClient) {
    const [user, guests, ticketOrders, messages, suppressions, ticketAttendees, contributions, templateAuthorship] = await Promise.all([
      tx.user.findFirst({
        where: { email: sameAddress(subjectEmail) },
        select: { email: true, name: true, createdAt: true, lastLoginAt: true },
      }),
      tx.guest.findMany({
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
      tx.ticketOrder.findMany({
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
      tx.message.findMany({
        where: { toAddress: sameAddress(subjectEmail) },
        select: { channel: true, templateKey: true, status: true, sentAt: true, subject: true },
        take: 500,
      }),
      this.suppressionsOf(subjectEmail, tx),
      exportAttendees(tx, subjectEmail),
      exportContributions(tx, subjectEmail, requestId),
      exportTemplateAuthorship(tx, subjectEmail),
    ]);

    return {
      subjectEmail,
      assembledAt: new Date().toISOString(),
      account: user,
      guestRecords: guests,
      contributions, templateAuthorship,
      ticketAttendees,
      ticketOrders: ticketOrders.map((order) => ({ ...order, totalMinor: order.totalMinor.toString() })),
      messagesSent: messages,
      suppressions,
    };
  }

  /** Their do-not-contact records, including those an earlier erasure left hashed. */
  private suppressionsOf(subjectEmail: string, tx: Prisma.TransactionClient) {
    return tx.suppression.findMany({
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
    const outstanding = await this.prisma.enquiryPrivacyRedaction.count({ where: { contactId: { in: applied.subject.verifiedContactIds }, checkpointedAt: null } });
    if (outstanding) return { ...applied.counts, recoveryPending: true };
    await this.prisma.dataSubjectRequest.updateMany({ where: { id: completion.requestId, status: 'IN_PROGRESS', erasureAppliedAt: { not: null } }, data: completedBy(completion.userId) });
    return applied.counts;
  }

  private async applyErasure(subject: EnquiryPrivacySubject, completion: { requestId: string; userId: string }) {
    const applied = await this.prisma.$transaction(async (tx) => {
      await lockPrivacyRequest(tx, completion.requestId);
      const request = await tx.dataSubjectRequest.findUniqueOrThrow({ where: { id: completion.requestId } });
      if (request.status !== 'IN_PROGRESS') throw new ConflictException('This request is being carried out by someone else, or already was');
      const verified = this.enquiryPrivacy ? await this.enquiryPrivacy.resolveForErasure(tx, request.id) : { ...subject, email: request.subjectEmail };
      if (request.erasureAppliedAt) return { counts: request.erasureResult as Record<string, number>, afterwards: null, subject: verified };
      const erased = verified.email
        ? await eraseSubject(tx, verified.email, new Date(), verified)
        : { counts: await this.enquiryPrivacy!.eraseInTransaction(tx, { subject: verified, now: new Date(), requestId: request.id }), afterwards: null };
      const pending = await tx.enquiryPrivacyRedaction.count({ where: { contactId: { in: verified.verifiedContactIds }, checkpointedAt: null } });
      const hasIntakeRedactions = erased.counts.enquiriesCleared > 0 || pending > 0;
      await tx.dataSubjectRequest.update({ where: { id: request.id }, data: hasIntakeRedactions
        ? { erasureAppliedAt: new Date(), erasureCheckpointId: request.id, erasureResult: erased.counts, handledByUserId: completion.userId }
        : completedBy(completion.userId) });
      return { ...erased, subject: verified };
    }, { timeout: ERASURE_TIMEOUT_MS });
    if (applied.afterwards?.userId) await reconcileInactiveOwnerReviews(this.prisma, applied.afterwards.userId);
    if (applied.afterwards) await Promise.all([
      Promise.allSettled(applied.afterwards.fileUrls.map((url) => this.storage.removeByUrl(url))),
      ...(applied.subject.email ? [this.audit.forgetPerson({ email: applied.subject.email, userId: applied.afterwards.userId })] : []),
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

  private async require(requestId: string, db: Pick<Prisma.TransactionClient, 'dataSubjectRequest'> = this.prisma) {
    const request = await db.dataSubjectRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('No such request');
    return request;
  }
}

async function lockPrivacyRequest(tx: Prisma.TransactionClient, requestId: string) {
  await tx.$queryRaw`SELECT id FROM data_subject_requests WHERE id = ${requestId} FOR UPDATE`;
}

export type DataSubjectRequestRow = Prisma.DataSubjectRequestGetPayload<object>;
