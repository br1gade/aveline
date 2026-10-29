import { BadRequestException } from '@nestjs/common';
import { DataSubjectRequest, Prisma } from '@prisma/client';
import { EnquiryPrivacySubject } from './enquiry-privacy';

export interface EnquiryOwnerVerification {
  verifiedOwnerUserId?: string;
  ownerVerificationNote?: string;
}

type OwnerDatabase = Pick<Prisma.TransactionClient, 'ownerInviteDelivery' | 'organizationInvite' | 'user'>;

/** A copied contact address is only a candidate, never accepted-account identity proof. */
export async function enquiryOwnerCandidates(tx: OwnerDatabase, contactIds: string[]) {
  const deliveries = await tx.ownerInviteDelivery.findMany({ where: { sourceContactId: { in: contactIds } }, select: { organizationInviteId: true } });
  const invitations = await tx.organizationInvite.findMany({ where: { id: { in: deliveries.map((delivery) => delivery.organizationInviteId) }, acceptedAt: { not: null }, acceptedByUserId: { not: null }, role: 'OWNER' }, select: { acceptedByUserId: true } });
  return tx.user.findMany({ where: { id: { in: invitations.flatMap((invite) => invite.acceptedByUserId ? [invite.acceptedByUserId] : []) }, NOT: { email: { endsWith: '@erased.invalid' } } }, select: { id: true, email: true } });
}

export async function reviewedEnquiryOwner(tx: OwnerDatabase, input: { request: DataSubjectRequest; contactIds: string[]; verification: EnquiryOwnerVerification }) {
  const candidates = await enquiryOwnerCandidates(tx, input.contactIds);
  const { verifiedOwnerUserId, ownerVerificationNote } = input.verification;
  const untouchedEmail = input.request.subjectSource === 'EMAIL' ? input.request.subjectEmail : null;
  if (!verifiedOwnerUserId) {
    if (ownerVerificationNote) throw new BadRequestException('verifiedOwnerUserId: required with ownerVerificationNote');
    return { subjectEmail: untouchedEmail, verifiedOwnerUserId: null, ownerAccountVerifiedAt: null, candidates };
  }
  if (input.request.subjectSource !== 'STAFF_ENQUIRY') throw new BadRequestException('verifiedOwnerUserId: supported only on a staff enquiry request');
  if (!ownerVerificationNote?.trim()) throw new BadRequestException('ownerVerificationNote: required for separate accepted-owner verification');
  if (candidates.length !== 1 || candidates[0].id !== verifiedOwnerUserId) throw new BadRequestException('verifiedOwnerUserId must identify the exact accepted owner; split distinct owner subjects into separate reviewed requests');
  return { subjectEmail: candidates[0].email, verifiedOwnerUserId, ownerAccountVerifiedAt: new Date(), candidates };
}

export async function resolveVerifiedEnquiryOwner(tx: OwnerDatabase, request: DataSubjectRequest, contactIds: string[]): Promise<EnquiryPrivacySubject> {
  const subject = { email: request.subjectEmail, verifiedContactIds: contactIds, verifiedOwnerUserId: request.verifiedOwnerUserId ?? undefined };
  if (!requiresOwnerReview(request)) return subject;
  const candidates = await enquiryOwnerCandidates(tx, contactIds);
  if (!candidates.length && !request.verifiedOwnerUserId) return subject;
  if (!request.verifiedOwnerUserId || !request.ownerAccountVerifiedAt) throw new BadRequestException('verifiedOwnerUserId: separate account identity evidence is required before fulfilling this accepted-owner erasure');
  const user = await tx.user.findUnique({ where: { id: request.verifiedOwnerUserId }, select: { email: true } });
  if (!user || user.email.endsWith('@erased.invalid')) return { ...subject, email: null };
  assertOwnerScope(request, candidates, user.email);
  return subject;
}

function requiresOwnerReview(request: DataSubjectRequest): boolean {
  return request.subjectSource === 'STAFF_ENQUIRY' && !request.erasureAppliedAt && (request.kind === 'ERASURE' || Boolean(request.verifiedOwnerUserId));
}

function assertOwnerScope(request: DataSubjectRequest, candidates: { id: string }[], email: string): void {
  if (candidates.length !== 1 || candidates[0].id !== request.verifiedOwnerUserId || email !== request.subjectEmail) throw new BadRequestException('verifiedOwnerUserId: scope changed; verify the current accepted owner again');
}
