import { ConfigService } from '@nestjs/config';
import { EnquiriesService } from '../../src/modules/sales/enquiries.service';
import { EnquiryRetentionService } from '../../src/modules/sales/enquiry-retention.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('latest closure retention', () => {
  const prisma = testPrisma();
  let enquiries: EnquiriesService;
  let retention: EnquiryRetentionService;
  beforeEach(async () => {
    await resetTestDatabase();
    const config = new ConfigService({ SALES_INTAKE_ENABLED: 'true', SALES_INTENT_HMAC_KEY_ID: 'test', SALES_INTENT_HMAC_KEYS: JSON.stringify({ test: 'x'.repeat(32) }) });
    enquiries = new EnquiriesService(prisma as PrismaService, config);
    retention = new EnquiryRetentionService(prisma as PrismaService, config);
  });
  afterAll(disconnectTestDatabase);
  it('pauses on reopening and permanently clears only the latest due closed case', async () => {
    const staff = await prisma.user.create({ data: { email: 'admin@example.am', name: 'Admin', platformRole: 'ADMIN' } });
    const created = await enquiries.create(staff.id, 'create-case-key', { contact: { name: 'Anna', phone: '+37499123456' } });
    await enquiries.stage(staff.id, created.enquiry.id, { key: 'close-case-key', dto: { expectedRevision: 1, stage: 'CLOSED', closureReason: 'OTHER', closureNote: 'Private closure' } });
    const closed = await prisma.salesEnquiry.findUniqueOrThrow({ where: { id: created.enquiry.id } });
    await enquiries.stage(staff.id, created.enquiry.id, { key: 'reopen-case-key', dto: { expectedRevision: 2, stage: 'CONTACTED' } });
    expect((await retention.clearDue(closed.cleanupDueAt!)).cleared).toBe(0);
    await enquiries.stage(staff.id, created.enquiry.id, { key: 'close-again-key', dto: { expectedRevision: 3, stage: 'CLOSED', closureReason: 'OTHER' } });
    const latest = await prisma.salesEnquiry.findUniqueOrThrow({ where: { id: created.enquiry.id } });
    const results = await Promise.all([retention.clearDue(latest.cleanupDueAt!), retention.clearDue(latest.cleanupDueAt!)]);
    expect(results.reduce((sum, result) => sum + result.cleared, 0)).toBe(1);
    await enquiries.stage(staff.id, created.enquiry.id, { key: 'reopen-cleared-key', dto: { expectedRevision: 4, stage: 'NEW' } });
    await expect(enquiries.update(staff.id, created.enquiry.id, { key: 'refill-case-key', dto: { expectedRevision: 5, contact: { name: 'Refill' } } })).rejects.toThrow('SUBJECT_ERASED');
    expect(await prisma.suppression.count()).toBe(0);
    expect(await prisma.enquiryPrivacyRedaction.count()).toBe(1);
  });
});
