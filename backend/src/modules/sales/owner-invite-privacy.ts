import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lockIntake } from './enquiry-lock';

/** Acceptance takes the privacy fence before owner/org/invite/User locks. */
export async function fenceOwnerInviteAcceptance(tx: Prisma.TransactionClient, invitationId: string): Promise<void> {
  await lockIntake(tx);
  const delivery = await tx.ownerInviteDelivery.findUnique({ where: { organizationInviteId: invitationId }, select: { state: true, sourceContactId: true, enquiry: { select: { clearanceReason: true } } } });
  if (delivery?.state === 'CANCELLED' || (delivery?.sourceContactId && delivery.enquiry?.clearanceReason === 'VERIFIED_ERASURE')) throw new BadRequestException('This invitation is no longer available');
}
