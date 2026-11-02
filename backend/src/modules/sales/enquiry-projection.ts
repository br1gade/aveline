import { Prisma } from '@prisma/client';

export const ENQUIRY_SELECT = {
  id: true, revision: true, stage: true, assignedUserId: true,
  organizationId: true, eventId: true, eventType: true, approximateLocalDate: true,
  approximateTimezone: true, estimatedGuestCount: true, preferredLocale: true, source: true,
  closedAt: true, closureReason: true, closureNote: true, cleanupDueAt: true,
  personalDataClearedAt: true, clearanceReason: true, privacyRevision: true,
  createdAt: true, updatedAt: true,
  contact: { select: { id: true, name: true, email: true, phone: true, redactedAt: true, revision: true } },
  conversion: { select: { id: true, organizationId: true, eventId: true, ownerInviteId: true } },
} satisfies Prisma.SalesEnquirySelect;

export function projectEnquiry(tx: Prisma.TransactionClient, id: string) {
  return tx.salesEnquiry.findUniqueOrThrow({ where: { id }, select: ENQUIRY_SELECT });
}
