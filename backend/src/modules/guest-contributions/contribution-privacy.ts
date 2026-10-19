import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrivateStorageService } from '../../infra/storage/private/private-storage';
import { attendeeSubject } from '../ticketing/attendee-privacy';

function subjectGuests(email: string): Prisma.GuestWhereInput {
  return { OR: [{ email: { equals: email, mode: 'insensitive' } }, { ticket: { attendee: attendeeSubject(email) } }] };
}
function subjectAcknowledgements(email: string): Prisma.GuestAcknowledgementWhereInput {
  return { OR: [{ signer: subjectGuests(email) }, { subject: subjectGuests(email) }] };
}
function subjectMedia(email: string): Prisma.GuestMediaWhereInput {
  return { processingStatus: { not: 'REMOVED' }, OR: [{ uploader: subjectGuests(email) }, { acknowledgements: { some: subjectAcknowledgements(email) } }] };
}
export async function exportContributions(tx: Prisma.TransactionClient, email: string, requestId: string) {
  const [acknowledgements, media] = await Promise.all([
    tx.guestAcknowledgement.findMany({ where: subjectAcknowledgements(email), select: { id: true, questionId: true, statementVersionId: true,
      subjectGuestId: true, signerGuestId: true, signerName: true, method: true, isRepresentative: true, locale: true, statement: true, createdAt: true } }),
    tx.guestMedia.findMany({ where: subjectMedia(email), select: { id: true, kind: true, processingStatus: true, moderationStatus: true, caption: true, createdAt: true } }),
  ]);
  return { acknowledgements, media: media.map((item) => ({ ...item, fileDownloadPath: `/api/v1/privacy/requests/${requestId}/guest-media/${item.id}/file` })) };
}

export async function eraseContributions(tx: Prisma.TransactionClient, guestIds: string[], now: Date) {
  if (!guestIds.length) return { acknowledgementsErased: 0, privateMediaQueuedForDeletion: 0 };
  // Delete references first: a represented person's record must not retain an erased signer's identity.
  await tx.$executeRaw`DELETE FROM rsvp_answers WHERE value ->> 'acknowledgementId' IN
    (SELECT id FROM guest_acknowledgements WHERE "subjectGuestId" IN (${Prisma.join(guestIds)}) OR "signerGuestId" IN (${Prisma.join(guestIds)}))`;
  const records = await tx.guestAcknowledgement.deleteMany({ where: { OR: [{ subjectGuestId: { in: guestIds } }, { signerGuestId: { in: guestIds } }] } });
  const media = await tx.guestMedia.updateMany({ where: { uploaderGuestId: { in: guestIds }, processingStatus: { not: 'REMOVED' } },
    data: { processingStatus: 'REMOVED', removedAt: now, cleanupAfter: now, caption: null, uploaderGuestId: null, moderatedBy: null } });
  return { acknowledgementsErased: records.count, privateMediaQueuedForDeletion: media.count };
}

@Injectable()
export class ContributionPrivacyFiles {
  constructor(private readonly prisma: PrismaService, private readonly storage: PrivateStorageService) {}
  async read(requestId: string, mediaId: string) {
    const check = async () => {
      const request = await this.prisma.dataSubjectRequest.findUnique({ where: { id: requestId }, select: { kind: true, status: true, subjectEmail: true } });
      if (!request || request.kind !== 'EXPORT' || !['IN_PROGRESS', 'COMPLETED'].includes(request.status)) throw new BadRequestException('Verify and start an export request before downloading subject files');
      const media = await this.prisma.guestMedia.findFirst({ where: { ...subjectMedia(request.subjectEmail), id: mediaId } });
      if (!media) throw new NotFoundException('No file belonging to this subject');
      return media;
    };
    const media = await check(); const buffer = await this.storage.get(media.sourceKey);
    await check();
    return { buffer, mimeType: 'application/octet-stream' };
  }
}
