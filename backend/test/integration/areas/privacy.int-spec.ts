import { ConflictException } from '@nestjs/common';
import {
  DataSubjectRequestKind,
  DataSubjectRequestStatus,
  DevicePlatform,
  MessageChannel,
  MessageStatus,
  PrismaClient,
  SuppressionReason,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrivacyService } from '../../../src/modules/privacy/privacy.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { SuppressionService } from '../../../src/modules/communications/suppression.service';
import { addressFingerprint } from '../../../src/modules/communications/address-form';
import { resolveArrangement } from '../../../src/modules/seating/seating-arrangements';
import {
  AfterCommit,
  DAY_MS,
  clearAfterCommit,
  privacyService,
  seedSubject,
  verifiedRequest,
} from '../../fixtures/areas/privacy.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { attendeeRoster, ticketEvent, ticketServices } from '../../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const ADDRESS = 'ani@example.am';

describe('Data-subject requests (integration coverage)', () => {
  let prisma: PrismaClient;
  let service: PrivacyService;
  let afterCommit: AfterCommit;

  beforeAll(() => {
    prisma = testPrisma();
    ({ service, afterCommit } = privacyService(prisma));
  });
  beforeEach(async () => {
    clearAfterCommit(afterCommit);
    await resetTestDatabase();
  });
  afterAll(() => disconnectTestDatabase());

  const fulfil = async (kind: DataSubjectRequestKind, email = ADDRESS) =>
    service.fulfil((await verifiedRequest(prisma, kind, email)).id, 'staff-user');

  describe('the staff queue', () => {
    it('lists at most 200 requests', async () => {
      const now = Date.now();
      await prisma.dataSubjectRequest.createMany({
        data: Array.from({ length: 201 }, (_, index) => ({
          kind: DataSubjectRequestKind.EXPORT, subjectEmail: `person-${index}@test.local`, dueAt: new Date(now + DAY_MS + index * 60_000),
        })),
      });

      const listed = await service.list(DataSubjectRequestStatus.RECEIVED);

      expect(listed).toHaveLength(200);
      // The one cut is the one due last.
      expect(listed.map((row) => row.subjectEmail)).not.toContain('person-200@test.local');
    });
  });

  describe('an export', () => {
    it('carries the account, guest records, paid orders as strings, messages and suppressions', async () => {
      const { eventId, guestId, organizationId } = await seedSubject(prisma, ADDRESS);
      await prisma.message.create({
        data: { eventId, guestId, channel: MessageChannel.EMAIL, templateKey: 'invitation.send', toAddress: 'Ani@Example.AM', subject: 'You are invited', body: 'Dear Ani' },
      });
      await new SuppressionService(prisma as unknown as PrismaService).suppress({
        organizationId, channel: MessageChannel.EMAIL, address: ADDRESS, reason: 'UNSUBSCRIBED',
      });

      const exported = await fulfil(DataSubjectRequestKind.EXPORT) as unknown as Record<string, unknown[] & Record<string, unknown>>;

      expect(exported.account).toMatchObject({ email: ADDRESS, name: 'Ani Hakobyan' });
      expect(exported.ticketOrders).toEqual([expect.objectContaining({ totalMinor: '25000', status: 'PAID', buyerEmail: ADDRESS })]);
      expect(exported.messagesSent).toEqual([expect.objectContaining({ channel: 'EMAIL', templateKey: 'invitation.send', subject: 'You are invited' })]);
      expect(exported.suppressions).toEqual([expect.objectContaining({ channel: 'EMAIL', reason: 'UNSUBSCRIBED' })]);
      expect(exported.guestRecords).toHaveLength(1);
      expect(exported.guestRecords[0]).toMatchObject({
        firstName: 'Ani',
        rsvp: { status: 'ATTENDING', dietary: ['vegan'], answers: [{ value: 'Near the door', question: { prompt: { en: 'Anything else?' } } }] },
        channels: [{ channel: 'TELEGRAM', address: '987654321' }],
      });
    });

    // An erasure leaves their do-not-contact records hashed; an export must still show them.
    it('still lists the do-not-contact records an earlier erasure left hashed', async () => {
      await seedSubject(prisma, ADDRESS);
      await new SuppressionService(prisma as unknown as PrismaService).suppress({
        organizationId: null, channel: MessageChannel.EMAIL, address: ADDRESS, reason: 'COMPLAINT',
      });
      await fulfil(DataSubjectRequestKind.ERASURE);

      const exported = await fulfil(DataSubjectRequestKind.EXPORT) as unknown as { suppressions: { reason: string }[]; account: unknown; guestRecords: unknown[] };

      expect(exported.suppressions.map((row) => row.reason).sort()).toEqual(['COMPLAINT', 'ERASED']);
      expect(exported.account).toBeNull();
      expect(exported.guestRecords).toEqual([]);
    });

    it('is carried out once when fulfilled twice at once, and marks the request completed', async () => {
      await seedSubject(prisma, ADDRESS);
      const request = await verifiedRequest(prisma, DataSubjectRequestKind.EXPORT, ADDRESS);

      const results = await Promise.allSettled([service.fulfil(request.id, 'one'), service.fulfil(request.id, 'two')]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const refused = results.find((result) => result.status === 'rejected');
      expect(refused?.reason).toBeInstanceOf(ConflictException);
      const row = await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(row.status).toBe(DataSubjectRequestStatus.COMPLETED);
      expect(row.completedAt).toBeInstanceOf(Date);
      expect(['one', 'two']).toContain(row.handledByUserId);
    });

    // A copy waiting to be collected is a second place it can leak from.
    it('stores no copy of what it returned', async () => {
      const { eventId } = await seedSubject(prisma, ADDRESS);

      await fulfil(DataSubjectRequestKind.EXPORT);

      expect(await prisma.mediaAsset.count({ where: { eventId } })).toBe(0);
      expect(await prisma.exportSnapshot.count()).toBe(0);
      const row = await prisma.dataSubjectRequest.findFirstOrThrow({ where: { kind: DataSubjectRequestKind.EXPORT } });
      expect(row.resultAssetId).toBeNull();
    });
  });

  describe('an erasure', () => {
    it('fails the messages still queued for them so none is sent, and leaves sent ones as sent', async () => {
      const { eventId, guestId } = await seedSubject(prisma, ADDRESS);
      const [queued, sent] = await Promise.all([
        prisma.message.create({ data: { eventId, guestId, channel: MessageChannel.EMAIL, toAddress: ADDRESS, body: 'Reminder' } }),
        prisma.message.create({ data: { eventId, guestId, channel: MessageChannel.EMAIL, toAddress: ADDRESS, body: 'Invitation', status: MessageStatus.SENT, sentAt: new Date() } }),
      ]);

      await fulfil(DataSubjectRequestKind.ERASURE);

      expect(await prisma.message.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({
        status: MessageStatus.FAILED, failureReason: 'Recipient’s data was erased', toAddress: '[erased]', body: '[erased]',
      });
      expect(await prisma.message.findUniqueOrThrow({ where: { id: sent.id } })).toMatchObject({
        status: MessageStatus.SENT, toAddress: '[erased]', body: '[erased]',
      });
    });

    it('invalidates the account’s tokens, devices and access tokens issued before it', async () => {
      const { userId } = await seedSubject(prisma, ADDRESS);
      await prisma.verificationToken.create({
        data: { userId, purpose: 'PASSWORD_RESET', tokenHash: randomUUID(), expiresAt: new Date(Date.now() + DAY_MS) },
      });
      await prisma.deviceToken.create({ data: { userId, platform: DevicePlatform.IOS, token: `device-${userId}` } });
      const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

      await fulfil(DataSubjectRequestKind.ERASURE);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(after.sessionGeneration).toBe(before.sessionGeneration + 1);
      expect(after.deletedAt).toBeInstanceOf(Date);
      expect(await prisma.verificationToken.count({ where: { userId } })).toBe(0);
      expect(await prisma.deviceToken.count({ where: { userId } })).toBe(0);
    });

    it('fails the seating and export jobs their account still had queued or running, and leaves finished ones', async () => {
      const { eventId, userId } = await seedSubject(prisma, ADDRESS);
      // An arrangement has one active job at a time, so the running one is another event's. The
      // exports are of that event too: one of the subject's own event is revoked as SUBJECT_ERASED.
      const other = await seedEvent(prisma);
      const leaseUntil = new Date(Date.now() + 60_000);
      const job = async (status: 'QUEUED' | 'RUNNING' | 'COMPLETED', jobEventId: string) => {
        const arrangement = await prisma.$transaction((tx) => resolveArrangement(tx, jobEventId));
        return prisma.seatingJob.create({
          data: { eventId: jobEventId, arrangementId: arrangement.id, requestedByUserId: userId, idempotencyKey: randomUUID(), status, leaseOwner: 'worker', leaseUntil },
        });
      };
      const [queued, running, completed] = [await job('QUEUED', eventId), await job('RUNNING', other.eventId), await job('COMPLETED', eventId)];
      const snapshot = (status: 'RUNNING' | 'COMPLETED') => prisma.exportSnapshot.create({
        data: { eventId: other.eventId, requestedByUserId: userId, idempotencyKey: randomUUID(), kind: 'GUEST_LIST', locale: 'en', includesContacts: false, status, leaseOwner: 'worker', leaseUntil },
      });
      const [runningExport, completedExport] = [await snapshot('RUNNING'), await snapshot('COMPLETED')];

      await fulfil(DataSubjectRequestKind.ERASURE);

      for (const id of [queued.id, running.id]) {
        expect(await prisma.seatingJob.findUniqueOrThrow({ where: { id } })).toMatchObject({
          status: 'FAILED', failureReason: 'ACCESS_REVOKED', leaseOwner: null, leaseUntil: null,
        });
      }
      expect(await prisma.seatingJob.findUniqueOrThrow({ where: { id: completed.id } })).toMatchObject({ status: 'COMPLETED', failureReason: null });
      expect(await prisma.exportSnapshot.findUniqueOrThrow({ where: { id: runningExport.id } })).toMatchObject({
        status: 'FAILED', failureReason: 'ACCESS_REVOKED', leaseOwner: null, revokedAt: expect.any(Date) as Date,
      });
      expect(await prisma.exportSnapshot.findUniqueOrThrow({ where: { id: completedExport.id } })).toMatchObject({ status: 'COMPLETED', failureReason: null });
    });

    // D21: an older unsubscribe a host could lift becomes ERASED, which it cannot.
    it('promotes an older hashed unsubscribe in their organization to ERASED', async () => {
      const { organizationId } = await seedSubject(prisma, ADDRESS);
      const older = await prisma.suppression.create({
        data: { organizationId, channel: MessageChannel.EMAIL, address: addressFingerprint(MessageChannel.EMAIL, ADDRESS), reason: SuppressionReason.UNSUBSCRIBED },
      });

      await fulfil(DataSubjectRequestKind.ERASURE);

      expect((await prisma.suppression.findUniqueOrThrow({ where: { id: older.id } })).reason).toBe(SuppressionReason.ERASED);
    });

    it('keeps a paid order’s amount and status while the buyer goes', async () => {
      const { orderId } = await seedSubject(prisma, ADDRESS);

      await fulfil(DataSubjectRequestKind.ERASURE);

      expect(await prisma.ticketOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
        totalMinor: 25_000n, status: 'PAID', buyerName: 'Removed', buyerPhone: null, requestFingerprint: null,
      });
    });

    /**
     * Files, the audit trail and analytics are cleared only once Postgres has
     * committed: a rollback must never leave a guest whose signature is gone.
     */
    it('touches no file, audit or analytics record when the erasure transaction rolls back', async () => {
      const { eventId, guestId } = await seedSubject(prisma, ADDRESS);
      const signature = await prisma.mediaAsset.create({
        data: { eventId, kind: 'SIGNATURE', url: 'https://files.test/signature.png', mimeType: 'image/png', sizeBytes: 10 },
      });
      await prisma.rsvp.update({ where: { guestId }, data: { signatureAssetId: signature.id } });
      const request = await verifiedRequest(prisma, DataSubjectRequestKind.ERASURE, ADDRESS);
      // The transaction's last write — completing the request — fails.
      await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION privacy_coverage_fault() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'injected fault'; END $$ LANGUAGE plpgsql`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER privacy_coverage_fault BEFORE UPDATE ON data_subject_requests
        FOR EACH ROW WHEN (NEW.status = 'COMPLETED') EXECUTE FUNCTION privacy_coverage_fault()`);
      try {
        await expect(service.fulfil(request.id, 'staff-user')).rejects.toThrow(/injected fault/);
      } finally {
        await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS privacy_coverage_fault ON data_subject_requests');
        await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS privacy_coverage_fault()');
      }

      expect(afterCommit).toEqual({ removedFiles: [], forgottenPeople: [], forgottenGuests: [] });
      expect((await prisma.guest.findUniqueOrThrow({ where: { id: guestId } })).email).toBe(ADDRESS.toUpperCase());
      expect(await prisma.mediaAsset.count({ where: { id: signature.id } })).toBe(1);
      expect((await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(DataSubjectRequestStatus.IN_PROGRESS);
    });
  });

  describe('a ticket buyer who was never a guest', () => {
    const BUYER = 'buyer@test.local';
    const checkout = async () => {
      const event = await ticketEvent(prisma);
      await prisma.ticketType.update({ where: { id: event.ticketTypeId }, data: { priceMinor: 25_000n } });
      const { ticketing, fulfilment } = ticketServices(prisma);
      const dto = {
        buyerName: 'Buyer Person', buyerEmail: BUYER, idempotencyKey: randomUUID(), provider: 'FAKE' as const,
        items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: attendeeRoster(event.ticketTypeId, 1),
      };
      const order = await ticketing.createOrder(event.slug, dto);
      await fulfilment.markPaid(order.orderId);
      const organizationId = (await prisma.event.findUniqueOrThrow({ where: { id: event.eventId } })).organizationId;
      return { event, ticketing, dto, order, organizationId };
    };

    it('is blocked from the organization that sold to them, and from no other', async () => {
      const { organizationId } = await checkout();
      const elsewhere = await ticketEvent(prisma);
      const otherOrganization = (await prisma.event.findUniqueOrThrow({ where: { id: elsewhere.eventId } })).organizationId;

      await fulfil(DataSubjectRequestKind.ERASURE, BUYER);

      const suppressions = new SuppressionService(prisma as unknown as PrismaService);
      expect(await suppressions.isSuppressed(MessageChannel.EMAIL, BUYER, organizationId)).toBe(true);
      expect(await suppressions.isSuppressed(MessageChannel.EMAIL, BUYER, otherOrganization)).toBe(false);
    });

    it('cannot rebind the erased order by replaying its checkout key, while its access link still shows it', async () => {
      const { event, ticketing, dto, order } = await checkout();

      await fulfil(DataSubjectRequestKind.ERASURE, BUYER);

      await expect(ticketing.createOrder(event.slug, dto)).rejects.toThrow(ConflictException);
      expect(await prisma.ticketOrder.count()).toBe(1);
      const retained = await ticketing.findByAccessToken(order.accessToken);
      expect(retained).toMatchObject({ orderId: order.orderId, status: 'PAID', totalMinor: '25000' });
      expect(JSON.stringify(retained)).not.toMatch(/buyer@test\.local|Buyer Person/);
      expect((await prisma.ticketOrder.findUniqueOrThrow({ where: { id: order.orderId } })).buyerName).toBe('Removed');
    });
  });
});
