import { ConflictException } from '@nestjs/common';
import { EnquiryAddressKind, MessageChannel, Prisma } from '@prisma/client';
import { addressFingerprint } from '../communications/address-form';
import { Contact } from './enquiry-rules';

export function contactAddresses(contactId: string, contact: Pick<Contact, 'email' | 'phone'>) {
  return [
    ...(contact.email ? [{ contactId, kind: EnquiryAddressKind.EMAIL, fingerprint: addressFingerprint(MessageChannel.EMAIL, contact.email) }] : []),
    ...(contact.phone ? [{ contactId, kind: EnquiryAddressKind.PHONE, fingerprint: addressFingerprint(MessageChannel.SMS, contact.phone) }] : []),
  ];
}

export async function rememberAddresses(tx: Prisma.TransactionClient, contactId: string, contact: Contact): Promise<void> {
  await tx.enquiryContactAddress.createMany({ data: contactAddresses(contactId, contact), skipDuplicates: true });
  const count = await tx.enquiryContactAddress.count({ where: { contactId } });
  if (count > 64) throw new ConflictException('contact requires ADMIN privacy review before further address changes');
}
