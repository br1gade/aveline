import { MessageChannel, MessageStatus, Prisma, SuppressionReason } from '@prisma/client';
import { lockIntake } from './enquiry-lock';
import { contactAddresses } from './enquiry-addresses';

export interface EnquiryPrivacySubject { email: string | null; verifiedContactIds: string[] }
export interface ClearanceInput { contactIds: string[]; now: Date; reason: 'RETENTION' | 'VERIFIED_ERASURE'; requestId?: string }

export async function redactEnquiries(tx: Prisma.TransactionClient, input: ClearanceInput) {
  const contacts = await tx.enquiryContact.findMany({ where: { id: { in: input.contactIds } }, select: { id: true, enquiryId: true, email: true, phone: true, enquiry: { select: { organizationId: true, privacyRevision: true, personalDataClearedAt: true } } } });
  const active = contacts.filter((contact) => !contact.enquiry.personalDataClearedAt);
  const ids = active.map((contact) => contact.enquiryId).sort();
  if (!ids.length) return { enquiriesCleared: 0, enquiryNotesRedacted: 0 };
  await tx.$queryRaw`SELECT id FROM sales_enquiries WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  if (input.reason === 'VERIFIED_ERASURE') await redactDerivedInvites(tx, active.map((contact) => contact.id), input.now);
  await tx.enquiryContact.updateMany({ where: { enquiryId: { in: ids } }, data: { name: null, email: null, phone: null, redactedAt: input.now, revision: { increment: 1 } } });
  const notes = await tx.enquiryNote.updateMany({ where: { enquiryId: { in: ids }, redactedAt: null }, data: { body: null, redactedAt: input.now } });
  await tx.enquiryContactAddress.deleteMany({ where: { contactId: { in: active.map((contact) => contact.id) } } });
  await tx.enquiryCommand.updateMany({ where: { enquiryId: { in: ids } }, data: { requestFingerprint: null, invalidatedAt: input.now } });
  await tx.salesEnquiry.updateMany({ where: { id: { in: ids } }, data: { closureNote: null, personalDataClearedAt: input.now, clearanceReason: input.reason, privacyRevision: { increment: 1 } } });
  const receipts = active.map((contact) => ({ enquiryId: contact.enquiryId, contactId: contact.id, privacyRevision: contact.enquiry.privacyRevision + 1, reason: input.reason, redactedAt: input.now }));
  await tx.enquiryPrivacyRedaction.createMany({ data: receipts });
  await tx.enquiryErasureTombstone.createMany({ data: receipts.map(({ reason: _reason, redactedAt: _redactedAt, ...receipt }) => ({ ...receipt, sourceRequestId: input.requestId, createdAt: input.now })), skipDuplicates: true });
  if (input.reason === 'VERIFIED_ERASURE') await rememberLinkedErasure(tx, active);
  return { enquiriesCleared: ids.length, enquiryNotesRedacted: notes.count };
}

async function rememberLinkedErasure(tx: Prisma.TransactionClient, contacts: { id: string; email: string | null; phone: string | null; enquiry: { organizationId: string | null } }[]): Promise<void> {
  const rows = contacts.flatMap((contact) => contact.enquiry.organizationId ? contactAddresses(contact.id, contact).flatMap((address) => {
    const channels = address.kind === 'EMAIL' ? [MessageChannel.EMAIL] : [MessageChannel.SMS, MessageChannel.WHATSAPP];
    return channels.map((channel) => ({ organizationId: contact.enquiry.organizationId!, channel, address: address.fingerprint, reason: SuppressionReason.ERASED }));
  }) : []);
  if (rows.length) await tx.suppression.createMany({ data: rows, skipDuplicates: true });
}

export async function eraseEnquirySubjects(tx: Prisma.TransactionClient, input: { subject: EnquiryPrivacySubject; now: Date; requestId?: string }) {
  await lockIntake(tx, true);
  return redactEnquiries(tx, { contactIds: input.subject.verifiedContactIds, now: input.now, reason: 'VERIFIED_ERASURE', requestId: input.requestId });
}

export async function redactDerivedInvites(tx: Prisma.TransactionClient, contactIds: string[], now: Date): Promise<void> {
  const deliveries = await tx.ownerInviteDelivery.findMany({ where: { sourceContactId: { in: contactIds } }, select: { id: true, organizationInviteId: true, messageId: true } });
  if (!deliveries.length) return;
  await tx.message.updateMany({ where: { id: { in: deliveries.flatMap((delivery) => delivery.messageId ? [delivery.messageId] : []) } }, data: { subject: null, body: '[erased]', toAddress: '[erased]', providerParams: [], status: MessageStatus.FAILED, failureReason: 'Recipient data erased' } });
  await tx.organizationInvite.deleteMany({ where: { id: { in: deliveries.map((delivery) => delivery.organizationInviteId) } } });
  await tx.ownerInviteDelivery.updateMany({ where: { id: { in: deliveries.map((delivery) => delivery.id) } }, data: { state: 'CANCELLED', updatedAt: now } });
}
