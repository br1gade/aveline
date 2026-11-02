import {
  DataSubjectRequestKind,
  DataSubjectRequestStatus,
  MessageChannel,
  PrismaClient,
  QuestionType,
  RsvpStatus,
} from '@prisma/client';
import { PrivacyService } from '../../../src/modules/privacy/privacy.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { StorageService } from '../../../src/infra/storage/storage.service';
import { AuditService } from '../../../src/infra/audit/audit.service';
import { AnalyticsService } from '../../../src/infra/analytics/analytics.service';
import { seedEvent } from '../event.fixture';

export const DAY_MS = 86_400_000;

/** What lives outside Postgres, recorded rather than reached. */
export interface AfterCommit {
  removedFiles: string[];
  forgottenPeople: { email: string; userId: string | null }[];
  forgottenGuests: string[][];
}

export function privacyService(prisma: PrismaClient): { service: PrivacyService; afterCommit: AfterCommit } {
  const afterCommit: AfterCommit = { removedFiles: [], forgottenPeople: [], forgottenGuests: [] };
  const service = new PrivacyService(
    prisma as unknown as PrismaService,
    { removeByUrl: (url: string) => Promise.resolve(void afterCommit.removedFiles.push(url)) } as unknown as StorageService,
    { forgetPerson: (person: { email: string; userId: string | null }) => Promise.resolve(void afterCommit.forgottenPeople.push(person)) } as unknown as AuditService,
    { forgetGuests: (ids: string[]) => Promise.resolve(void afterCommit.forgottenGuests.push(ids)) } as unknown as AnalyticsService,
  );
  return { service, afterCommit };
}

export function clearAfterCommit(afterCommit: AfterCommit): void {
  afterCommit.removedFiles.length = 0;
  afterCommit.forgottenPeople.length = 0;
  afterCommit.forgottenGuests.length = 0;
}

export function verifiedRequest(prisma: PrismaClient, kind: DataSubjectRequestKind, subjectEmail: string) {
  return prisma.dataSubjectRequest.create({
    data: { kind, subjectEmail, status: DataSubjectRequestStatus.IN_PROGRESS, dueAt: new Date(Date.now() + DAY_MS) },
  });
}

/**
 * One guest who answered, connected a chat, was written to, holds an account
 * and bought a paid ticket — the address written with mixed capitals in some
 * rows, as real data is.
 */
export async function seedSubject(prisma: PrismaClient, address: string) {
  const { eventId, slug } = await seedEvent(prisma);
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug } });
  const guest = await prisma.guest.findFirstOrThrow({ where: { eventId } });
  await prisma.guest.update({
    where: { id: guest.id },
    data: { email: address.toUpperCase(), phone: '+37491000000', firstName: 'Ani', lastName: 'Hakobyan' },
  });
  const question = await prisma.rsvpQuestion.create({
    data: { invitationId: invitation.id, type: QuestionType.TEXT, prompt: { en: 'Anything else?' } },
  });
  await prisma.rsvp.update({
    where: { guestId: guest.id },
    data: { status: RsvpStatus.ATTENDING, dietary: ['vegan'], answers: { create: [{ questionId: question.id, value: 'Near the door' }] } },
  });
  await prisma.guestChannel.create({
    data: { guestId: guest.id, channel: MessageChannel.TELEGRAM, address: '987654321', optedInAt: new Date() },
  });
  const user = await prisma.user.create({ data: { email: address, name: 'Ani Hakobyan', passwordHash: 'x' } });
  const type = await prisma.ticketType.create({ data: { eventId, priceMinor: 25_000n, quantityTotal: 10 } });
  const order = await prisma.ticketOrder.create({
    data: {
      eventId, buyerName: 'Ani Hakobyan', buyerEmail: address, totalMinor: 25_000n, status: 'PAID',
      idempotencyKey: `order-${eventId}`, accessToken: `access-${eventId}`, requestFingerprint: 'fingerprint',
    },
  });
  return { eventId, organizationId: event.organizationId, guestId: guest.id, householdId: guest.householdId, userId: user.id, orderId: order.id, ticketTypeId: type.id };
}
