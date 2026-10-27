import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSubjectRequestKind, Prisma, MessageChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { addressFingerprint } from '../communications/address-form';
import { lockStaff } from './enquiry-access';
import { EnquiryJournal, ReplayedRedactionReceipt } from './enquiry-journal';
import { lockIntake } from './enquiry-lock';
import { EnquiryPrivacySubject, eraseEnquirySubjects, redactDerivedInvites } from './enquiry-privacy';

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

  bindSubjects(userId: string, requestId: string, input: { contactIds: string[]; verificationNote: string }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM data_subject_requests WHERE id=${requestId} FOR UPDATE`;
      const request = await tx.dataSubjectRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (request.status !== 'IN_PROGRESS' || request.erasureAppliedAt) throw new BadRequestException('Request must be verified IN_PROGRESS before binding enquiry subjects');
      await this.assertAdmin(tx, userId);
      await this.assertContacts(tx, input.contactIds);
      await tx.dataSubjectRequestEnquirySubject.deleteMany({ where: { requestId } });
      await tx.dataSubjectRequestEnquirySubject.createMany({ data: input.contactIds.map((contactId) => ({ requestId, contactId })) });
      return tx.dataSubjectRequest.update({ where: { id: requestId }, data: { enquirySubjectsVerifiedAt: new Date(), handledByUserId: userId, notes: input.verificationNote } });
    });
  }

  async candidates(input: { email?: string; phone?: string }) {
    const channel = input.email ? MessageChannel.EMAIL : MessageChannel.SMS;
    const address = input.email ?? input.phone;
    if (!address) throw new BadRequestException('email or phone is required');
    const candidates = await this.prisma.enquiryContact.findMany({ where: { addresses: { some: { kind: input.email ? 'EMAIL' : 'PHONE', fingerprint: addressFingerprint(channel, address) } } }, select: { id: true, enquiryId: true, name: true, email: true, phone: true, redactedAt: true }, take: 101 });
    if (candidates.length > 100) throw new BadRequestException('More than 100 subject candidates require manual privacy review');
    return candidates;
  }

  async resolveSubject(requestId: string): Promise<EnquiryPrivacySubject> {
    const request = await this.prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: requestId }, include: { enquirySubjects: { select: { contactId: true } } } });
    if (request.enquirySubjects.length && !request.enquirySubjectsVerifiedAt) throw new BadRequestException('Enquiry subjects must be verified');
    if (!request.subjectEmail && (!request.enquirySubjectsVerifiedAt || !request.enquirySubjects.length)) throw new BadRequestException('Phone-only enquiry subjects must be verified');
    if (request.subjectEmail && !request.enquirySubjectsVerifiedAt) {
      const candidates = await this.candidates({ email: request.subjectEmail });
      if (candidates.length) throw new BadRequestException('Enquiry subjects must be verified, including historical address matches');
    }
    return { email: request.subjectEmail, verifiedContactIds: request.enquirySubjects.map((subject) => subject.contactId) };
  }

  exportSubject(subject: EnquiryPrivacySubject) {
    return this.prisma.$transaction(async (tx) => {
      await lockIntake(tx);
      return tx.salesEnquiry.findMany({ where: { contact: { id: { in: subject.verifiedContactIds } } }, include: { contact: true, notes: true, activities: true, consultations: true, conversion: true } });
    });
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
    const receipts = pending.map((receipt) => ({ id: receipt.id, enquiryId: receipt.enquiryId, contactId: receipt.contactId, reason: receipt.reason, privacyRevision: receipt.privacyRevision, redactedAt: receipt.redactedAt.toISOString() }));
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
  await lockIntake(tx, true);
  const ids = receipts.map((receipt) => receipt.enquiryId).sort();
  await tx.$queryRaw`SELECT id FROM sales_enquiries WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  const contactIds = receipts.map((receipt) => receipt.contactId);
  const now = new Date();
  await redactDerivedInvites(tx, receipts.filter((receipt) => receipt.reason === 'VERIFIED_ERASURE').map((receipt) => receipt.contactId), now);
  await tx.enquiryContact.updateMany({ where: { id: { in: contactIds } }, data: { name: null, email: null, phone: null, redactedAt: now } });
  await tx.enquiryNote.updateMany({ where: { enquiryId: { in: ids } }, data: { body: null, redactedAt: now } });
  await tx.enquiryCommand.updateMany({ where: { enquiryId: { in: ids } }, data: { requestFingerprint: null, invalidatedAt: now } });
  await tx.enquiryContactAddress.deleteMany({ where: { contactId: { in: contactIds } } });
  await tx.enquiryPrivacyRedaction.createMany({ data: receipts.map((receipt) => ({ id: receipt.id, enquiryId: receipt.enquiryId, contactId: receipt.contactId, reason: receipt.reason, privacyRevision: receipt.privacyRevision, redactedAt: new Date(receipt.redactedAt), checkpointSequence: BigInt(receipt.sequence), checkpointedAt: now })), skipDuplicates: true });
  await tx.$executeRaw`UPDATE enquiry_privacy_redactions r SET "checkpointSequence"=v.sequence,"checkpointedAt"=${now} FROM (VALUES ${Prisma.join(receipts.map((receipt) => Prisma.sql`(${receipt.id},${BigInt(receipt.sequence)}::bigint)`))}) AS v(id,sequence) WHERE r.id=v.id`;
  await tx.enquiryErasureTombstone.createMany({ data: receipts.map((receipt) => ({ enquiryId: receipt.enquiryId, contactId: receipt.contactId, privacyRevision: receipt.privacyRevision })), skipDuplicates: true });
  await tx.$executeRaw`UPDATE sales_enquiries s SET "closureNote"=NULL,"personalDataClearedAt"=COALESCE(s."personalDataClearedAt",r."redactedAt"),"privacyRevision"=GREATEST(s."privacyRevision",r.revision),"clearanceReason"=r.reason::"EnquiryClearanceReason" FROM (VALUES ${Prisma.join(receipts.map((receipt) => Prisma.sql`(${receipt.enquiryId},${new Date(receipt.redactedAt)}::timestamp,${receipt.privacyRevision}::integer,${receipt.reason})`))}) AS r(id,"redactedAt",revision,reason) WHERE s.id=r.id`;
}
