import { findSubjectCandidates } from './enquiry-subject-candidates';
import { eraseSubject } from '../privacy/erasure';
import { EnquiryOwnerVerification, reviewedEnquiryOwner, resolveVerifiedEnquiryOwner } from './enquiry-owner-verification';
import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSubjectRequestKind, Prisma, MessageChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { addressFingerprint } from '../communications/address-form';
import { lockStaff } from './enquiry-access';
import { EnquiryJournal, ReplayedRedactionReceipt } from './enquiry-journal';
import { lockIntake } from './enquiry-lock';
import { EnquiryPrivacySubject, eraseEnquirySubjects, redactDerivedInvites, rememberVerifiedLinkedErasure } from './enquiry-privacy';

@Injectable()
export class EnquiryPrivacyService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get<string>('SALES_INTAKE_ENABLED') === 'true') await this.journal().append([], 0);
  }

  private journal(): EnquiryJournal {
    return new EnquiryJournal(this.config.get<string>('SALES_PRIVACY_JOURNAL_DIR') ?? '', this.config.get<string>('SALES_PRIVACY_JOURNAL_KEY') ?? '');
  }

  createRequest(userId: string, input: { kind: DataSubjectRequestKind; contactIds: string[]; notes?: string }) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertAdmin(tx, userId);
      await this.assertContacts(tx, input.contactIds);
      return tx.dataSubjectRequest.create({ data: { kind: input.kind, subjectEmail: null, subjectSource: 'STAFF_ENQUIRY', notes: input.notes, dueAt: new Date(Date.now() + 30 * 86400000), enquirySubjects: { createMany: { data: input.contactIds.map((contactId) => ({ contactId })) } } } });
    });
  }

  bindSubjects(userId: string, requestId: string, input: { contactIds: string[]; verificationNote: string; append?: boolean } & EnquiryOwnerVerification) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM data_subject_requests WHERE id=${requestId} FOR UPDATE`;
      const request = await tx.dataSubjectRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (request.status !== 'IN_PROGRESS' || request.erasureAppliedAt) throw new BadRequestException('Request must be verified IN_PROGRESS before binding enquiry subjects');
      await this.assertAdmin(tx, userId);
      await this.assertContacts(tx, input.contactIds);
      if (input.append && !request.enquirySubjectsVerifiedAt) throw new BadRequestException('append requires an existing verified subject binding');
      if (!input.append) await tx.dataSubjectRequestEnquirySubject.deleteMany({ where: { requestId } });
      await tx.dataSubjectRequestEnquirySubject.createMany({ data: input.contactIds.map((contactId) => ({ requestId, contactId })), skipDuplicates: true });
      const bound = await tx.dataSubjectRequestEnquirySubject.findMany({ where: { requestId }, select: { contactId: true } });
      const { candidates, ...owner } = await reviewedEnquiryOwner(tx, { request, contactIds: bound.map((row) => row.contactId), verification: input });
      const updated = await tx.dataSubjectRequest.update({ where: { id: requestId }, data: { ...owner, enquirySubjectsVerifiedAt: new Date(), handledByUserId: userId, notes: [input.verificationNote, input.ownerVerificationNote].filter(Boolean).join('\n\n') } });
      return { ...updated, ownerAccountCandidates: candidates };
    });
  }

  candidates(input: { email?: string; phone?: string; limit?: number; cursor?: string }) {
    const channel = input.email ? MessageChannel.EMAIL : MessageChannel.SMS;
    const address = input.email ?? input.phone;
    if (!address || Boolean(input.email) === Boolean(input.phone)) throw new BadRequestException('exactly one email or phone is required');
    return findSubjectCandidates(this.prisma, { ...input, kind: input.email ? 'EMAIL' : 'PHONE', fingerprint: addressFingerprint(channel, address) });
  }

  async resolveSubject(requestId: string, tx: Prisma.TransactionClient = this.prisma): Promise<EnquiryPrivacySubject> {
    const request = await tx.dataSubjectRequest.findUniqueOrThrow({ where: { id: requestId }, include: { enquirySubjects: { select: { contactId: true } } } });
    if (request.enquirySubjects.length && !request.enquirySubjectsVerifiedAt) throw new BadRequestException('Enquiry subjects must be verified');
    if (!request.subjectEmail && (!request.enquirySubjectsVerifiedAt || !request.enquirySubjects.length)) throw new BadRequestException('Phone-only enquiry subjects must be verified');
    if (request.subjectEmail && !request.enquirySubjectsVerifiedAt) {
      const candidates = await findSubjectCandidates(tx, { kind: 'EMAIL', fingerprint: addressFingerprint(MessageChannel.EMAIL, request.subjectEmail), limit: 1 });
      if (candidates.items.length) throw new BadRequestException('Enquiry subjects must be verified, including historical address matches');
    }
    return resolveVerifiedEnquiryOwner(tx, request, request.enquirySubjects.map((subject) => subject.contactId));
  }

  async resolveForErasure(tx: Prisma.TransactionClient, requestId: string): Promise<EnquiryPrivacySubject> {
    await tx.$executeRaw`INSERT INTO export_privacy_fences (id,revision) VALUES ('exports',0) ON CONFLICT DO NOTHING`;
    await tx.$queryRaw`SELECT id FROM export_privacy_fences WHERE id='exports' FOR UPDATE`;
    await lockIntake(tx, true);
    const request = await tx.dataSubjectRequest.findUniqueOrThrow({ where: { id: requestId }, include: { enquirySubjects: { select: { contactId: true } } } });
    return resolveVerifiedEnquiryOwner(tx, request, request.enquirySubjects.map((subject) => subject.contactId));
  }

  exportSubject(subject: EnquiryPrivacySubject, tx?: Prisma.TransactionClient) {
    const project = async (transaction: Prisma.TransactionClient) => {
      await lockIntake(transaction);
      return transaction.salesEnquiry.findMany({ where: { contact: { id: { in: subject.verifiedContactIds } } }, include: { contact: true, notes: true, activities: true, consultations: true, conversion: true } });
    };
    return tx ? project(tx) : this.prisma.$transaction(project);
  }

  eraseInTransaction(tx: Prisma.TransactionClient, input: { subject: EnquiryPrivacySubject; now: Date; requestId?: string }) {
    return eraseEnquirySubjects(tx, input);
  }

  async checkpoint(): Promise<number> {
    const [pending, acknowledged] = await Promise.all([
      this.prisma.enquiryPrivacyRedaction.findMany({ where: { checkpointedAt: null }, orderBy: [{ redactedAt: 'asc' }, { id: 'asc' }], take: 100 }),
      this.prisma.enquiryPrivacyRedaction.aggregate({ _max: { checkpointSequence: true } }),
    ]);
    if (!pending.length) return 0;
    const receipts = pending.map((receipt) => ({ id: receipt.id, enquiryId: receipt.enquiryId, contactId: receipt.contactId, reason: receipt.reason, privacyRevision: receipt.privacyRevision, redactedAt: receipt.redactedAt.toISOString(), ...(receipt.verifiedOwnerUserId ? { verifiedOwnerUserId: receipt.verifiedOwnerUserId } : {}) }));
    const results = await this.journal().append(receipts, Number(acknowledged._max.checkpointSequence ?? 0));
    await this.prisma.$transaction(async (tx) => {
      // A batch is at most 100 receipts; each acknowledgement remains tied to its stable journal sequence.
      for (const result of results) await tx.enquiryPrivacyRedaction.updateMany({ where: { id: result.id, checkpointedAt: null }, data: { checkpointSequence: BigInt(result.sequence), checkpointedAt: new Date() } });
    });
    return results.length;
  }

  async finalizeCheckpointedRequests(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const requests = await tx.dataSubjectRequest.findMany({ where: { kind: 'ERASURE', status: 'IN_PROGRESS', erasureAppliedAt: { not: null } }, select: { id: true, enquirySubjects: { select: { contactId: true } } }, take: 100, orderBy: { requestedAt: 'asc' } });
      const contactIds = requests.flatMap((request) => request.enquirySubjects.map((subject) => subject.contactId));
      const pending = await tx.enquiryPrivacyRedaction.findMany({ where: { contactId: { in: contactIds }, checkpointedAt: null }, select: { contactId: true } });
      const pendingIds = new Set(pending.map((receipt) => receipt.contactId));
      const completedIds = requests.filter((request) => request.enquirySubjects.length && request.enquirySubjects.every((subject) => !pendingIds.has(subject.contactId))).map((request) => request.id);
      const result = await tx.dataSubjectRequest.updateMany({ where: { id: { in: completedIds }, status: 'IN_PROGRESS', erasureAppliedAt: { not: null } }, data: { status: 'COMPLETED', completedAt: new Date() } });
      return result.count;
    });
  }

  async replayJournal(): Promise<number> {
    const receipts = await this.journal().readVerified();
    for (let offset = 0; offset < receipts.length; offset += 100) {
      await this.prisma.$transaction((tx) => replayRedactions(tx, receipts.slice(offset, offset + 100)));
    }
    return receipts.length;
  }

  private async assertAdmin(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const actor = await lockStaff(tx, userId);
    if (actor.platformRole !== 'ADMIN') throw new BadRequestException('Privacy verification is ADMIN-only');
  }

  private async assertContacts(tx: Prisma.TransactionClient, contactIds: string[]): Promise<void> {
    if (!contactIds.length || contactIds.length > 100 || new Set(contactIds).size !== contactIds.length) throw new BadRequestException('contactIds must contain 1–100 distinct subjects');
    const count = await tx.enquiryContact.count({ where: { id: { in: contactIds } } });
    if (count !== contactIds.length) throw new BadRequestException('contactIds contains an unknown subject');
  }
}

async function replayRedactions(tx: Prisma.TransactionClient, receipts: ReplayedRedactionReceipt[]): Promise<void> {
  await tx.$executeRaw`INSERT INTO export_privacy_fences (id,revision) VALUES ('exports',0) ON CONFLICT DO NOTHING`;
  await tx.$queryRaw`SELECT id FROM export_privacy_fences WHERE id='exports' FOR UPDATE`;
  await lockIntake(tx, true);
  const ids = receipts.map((receipt) => receipt.enquiryId).sort();
  await tx.$queryRaw`SELECT id FROM sales_enquiries WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  await replayVerifiedOwners(tx, receipts);
  const contactIds = receipts.map((receipt) => receipt.contactId);
  const now = new Date();
  await redactDerivedInvites(tx, receipts.filter((receipt) => receipt.reason === 'VERIFIED_ERASURE').map((receipt) => receipt.contactId), now);
  await rememberVerifiedLinkedErasure(tx, receipts.filter((receipt) => receipt.reason === 'VERIFIED_ERASURE').map((receipt) => receipt.contactId));
  await tx.enquiryContact.updateMany({ where: { id: { in: contactIds } }, data: { name: null, email: null, phone: null, redactedAt: now } });
  await tx.enquiryNote.updateMany({ where: { enquiryId: { in: ids } }, data: { body: null, redactedAt: now } });
  await tx.enquiryCommand.updateMany({ where: { enquiryId: { in: ids } }, data: { requestFingerprint: null, invalidatedAt: now } });
  await tx.enquiryContactAddress.deleteMany({ where: { contactId: { in: contactIds } } });
  await tx.enquiryPrivacyRedaction.createMany({ data: receipts.map((receipt) => ({ id: receipt.id, enquiryId: receipt.enquiryId, contactId: receipt.contactId, reason: receipt.reason, privacyRevision: receipt.privacyRevision, redactedAt: new Date(receipt.redactedAt), checkpointSequence: BigInt(receipt.sequence), checkpointedAt: now, verifiedOwnerUserId: receipt.verifiedOwnerUserId })), skipDuplicates: true });
  await tx.$executeRaw`UPDATE enquiry_privacy_redactions r SET "checkpointSequence"=v.sequence,"checkpointedAt"=${now} FROM (VALUES ${Prisma.join(receipts.map((receipt) => Prisma.sql`(${receipt.id},${BigInt(receipt.sequence)}::bigint)`))}) AS v(id,sequence) WHERE r.id=v.id`;
  await tx.enquiryErasureTombstone.createMany({ data: receipts.map((receipt) => ({ enquiryId: receipt.enquiryId, contactId: receipt.contactId, privacyRevision: receipt.privacyRevision })), skipDuplicates: true });
  await tx.$executeRaw`UPDATE sales_enquiries s SET "closureNote"=NULL,"personalDataClearedAt"=COALESCE(s."personalDataClearedAt",r."redactedAt"),"privacyRevision"=GREATEST(s."privacyRevision",r.revision),"clearanceReason"=CASE WHEN s."clearanceReason"='VERIFIED_ERASURE' OR r."wasErased" THEN 'VERIFIED_ERASURE' ELSE 'RETENTION' END::"EnquiryClearanceReason" FROM (SELECT id,min("redactedAt") AS "redactedAt",max(revision) AS revision,bool_or(reason='VERIFIED_ERASURE') AS "wasErased" FROM (VALUES ${Prisma.join(receipts.map((receipt) => Prisma.sql`(${receipt.enquiryId},${new Date(receipt.redactedAt)}::timestamp,${receipt.privacyRevision}::integer,${receipt.reason})`))}) AS history(id,"redactedAt",revision,reason) GROUP BY id) AS r WHERE s.id=r.id`;
}

async function replayVerifiedOwners(tx: Prisma.TransactionClient, receipts: ReplayedRedactionReceipt[]): Promise<void> {
  const ids = [...new Set(receipts.flatMap((receipt) => receipt.reason === 'VERIFIED_ERASURE' && receipt.verifiedOwnerUserId ? [receipt.verifiedOwnerUserId] : []))];
  const owners = await tx.user.findMany({ where: { id: { in: ids }, NOT: { email: { endsWith: '@erased.invalid' } } }, select: { id: true, email: true } });
  // A signed receipt names only an explicitly verified account ID. At most 100
  // identities occur in a replay batch; no unverified address discovers owners.
  for (const owner of owners) await eraseSubject(tx, owner.email, new Date(), { email: owner.email, verifiedContactIds: [], verifiedOwnerUserId: owner.id });
}
