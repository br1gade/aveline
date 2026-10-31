import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnquiriesService } from '../../../src/modules/sales/enquiries.service';
import { EnquiryJournal } from '../../../src/modules/sales/enquiry-journal';
import { EnquiryPrivacyService } from '../../../src/modules/sales/enquiry-privacy.service';
import { EnquiryRetentionService } from '../../../src/modules/sales/enquiry-retention.service';
import { PrivacyService } from '../../../src/modules/privacy/privacy.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { DAY_MS, privacyService } from '../../fixtures/areas/privacy.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const JOURNAL_KEY = 'j'.repeat(32);

function intakeConfig(directory: string, extra: Record<string, string> = {}) {
  return new ConfigService({
    SALES_INTAKE_ENABLED: 'true', SALES_INTENT_HMAC_KEY_ID: 'test', SALES_INTENT_HMAC_KEYS: JSON.stringify({ test: 'x'.repeat(32) }),
    SALES_PRIVACY_JOURNAL_DIR: directory, SALES_PRIVACY_JOURNAL_KEY: JOURNAL_KEY, ...extra,
  });
}

describe('Intake privacy recovery and retention (integration coverage)', () => {
  let prisma: PrismaClient;
  let directory: string;

  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(async () => {
    await resetTestDatabase();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    directory = await mkdtemp(join(tmpdir(), 'privacy-intake-coverage-'));
    await new EnquiryJournal(directory, JOURNAL_KEY).initialize();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  afterAll(() => disconnectTestDatabase());

  const staffMember = () => prisma.user.create({
    data: { name: 'Privacy', email: `${randomUUID()}@example.am`, platformRole: 'ADMIN' },
  });

  /**
   * docs/API.md, "Staff enquiry privacy substrate": recoveryPending:true means
   * the redaction committed but the protected journal has not acknowledged
   * it; the request stays IN_PROGRESS and a retry resumes the checkpoint.
   */
  describe('an erasure whose journal checkpoint fails', () => {
    let privacy: EnquiryPrivacyService;
    let service: PrivacyService;

    beforeEach(() => {
      privacy = new EnquiryPrivacyService(prisma as unknown as PrismaService, intakeConfig(directory));
      ({ service } = privacyService(prisma));
      Object.defineProperty(service, 'enquiryPrivacy', { value: privacy });
    });

    const verifiedErasure = async () => {
      const staff = await staffMember();
      const enquiries = new EnquiriesService(prisma as unknown as PrismaService, intakeConfig(directory));
      const created = await enquiries.create(staff.id, `case-${randomUUID()}`, { contact: { name: 'Prospect', phone: '+37499123456' } });
      const contactId = created.enquiry.contact!.id;
      const request = await privacy.createRequest(staff.id, { kind: 'ERASURE', contactIds: [contactId] });
      await prisma.dataSubjectRequest.update({ where: { id: request.id }, data: { status: 'IN_PROGRESS' } });
      await privacy.bindSubjects(staff.id, request.id, { contactIds: [contactId], verificationNote: 'Reviewed contact scope' });
      return { staff, contactId, requestId: request.id };
    };

    it('reports recovery pending with the redaction already applied and the request still open', async () => {
      const { staff, contactId, requestId } = await verifiedErasure();
      jest.spyOn(privacy, 'checkpoint').mockRejectedValueOnce(new Error('disk'));

      const result = await service.fulfil(requestId, staff.id);

      expect(result).toMatchObject({ recoveryPending: true, enquiriesCleared: 1 });
      const request = await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(request.status).toBe('IN_PROGRESS');
      expect(request.erasureAppliedAt).toBeInstanceOf(Date);
      expect(await prisma.enquiryContact.findUniqueOrThrow({ where: { id: contactId } })).toMatchObject({ name: null, phone: null });
    });

    it('completes on retry from the applied marker without redacting a second time', async () => {
      const { staff, contactId, requestId } = await verifiedErasure();
      jest.spyOn(privacy, 'checkpoint').mockRejectedValueOnce(new Error('disk'));
      await service.fulfil(requestId, staff.id);
      const applied = await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: requestId } });

      const retried = await service.fulfil(requestId, staff.id);

      expect(retried).not.toHaveProperty('recoveryPending');
      expect(retried).toMatchObject({ enquiriesCleared: 1 });
      const request = await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(request.status).toBe('COMPLETED');
      expect(request.erasureAppliedAt).toEqual(applied.erasureAppliedAt);
      expect(await prisma.enquiryPrivacyRedaction.count({ where: { contactId } })).toBe(1);
      expect(await prisma.enquiryPrivacyRedaction.count({ where: { contactId, checkpointedAt: null } })).toBe(0);
    });
  });

  describe('closed-enquiry retention', () => {
    /** Closed cases whose six months have run out, as rows rather than a hundred API calls. */
    const closedDueCases = async (count: number, now: Date) => {
      const staff = await staffMember();
      const ids = Array.from({ length: count }, (_, index) => `retention-${String(index).padStart(3, '0')}`);
      await prisma.salesEnquiry.createMany({
        data: ids.map((id) => ({
          id, createdByUserId: staff.id, stage: 'CLOSED' as const, closedAt: new Date(now.getTime() - 200 * DAY_MS),
          closureReason: 'OTHER' as const, cleanupDueAt: new Date(now.getTime() - DAY_MS),
        })),
      });
      await prisma.enquiryContact.createMany({ data: ids.map((enquiryId) => ({ enquiryId, name: 'Prospect', phone: '+37499123456' })) });
      return ids;
    };

    it('reports what is due without clearing it during a dry run', async () => {
      const now = new Date();
      await closedDueCases(1, now);
      const retention = new EnquiryRetentionService(prisma as unknown as PrismaService, intakeConfig(directory, { SALES_ENQUIRY_RETENTION_DRY_RUN: 'true' }));

      expect(await retention.clearDue(now)).toEqual({ due: 1, cleared: 0 });

      expect(await prisma.enquiryContact.count({ where: { name: 'Prospect', redactedAt: null } })).toBe(1);
      expect(await prisma.enquiryPrivacyRedaction.count()).toBe(0);
    });

    it('clears more than one batch of due cases in a single sweep and leaves nothing overdue', async () => {
      const now = new Date();
      await closedDueCases(101, now);
      const retention = new EnquiryRetentionService(prisma as unknown as PrismaService, intakeConfig(directory));

      const result = await retention.sweep(now);

      expect(result).toMatchObject({ cleared: 101, overdue: 0, uncheckpointed: 101 });
      expect(await prisma.enquiryContact.count({ where: { redactedAt: null } })).toBe(0);
      expect(await prisma.suppression.count()).toBe(0);
    });
  });
});
