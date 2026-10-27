import { ConfigService } from '@nestjs/config';
import { PlatformRole } from '@prisma/client';
import { EnquiriesService } from '../../src/modules/sales/enquiries.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('staff enquiry transactions', () => {
  const prisma = testPrisma();
  let service: EnquiriesService;
  beforeEach(async () => {
    await resetTestDatabase();
    service = new EnquiriesService(prisma as PrismaService, new ConfigService({ SALES_INTAKE_ENABLED: 'true', SALES_INTAKE_SUPPORT_ENABLED: 'true', SALES_INTENT_HMAC_KEY_ID: 'test', SALES_INTENT_HMAC_KEYS: JSON.stringify({ test: 'x'.repeat(32) }) }));
  });
  afterAll(disconnectTestDatabase);
  async function staff(platformRole: PlatformRole) {
    return prisma.user.create({ data: { name: 'Operator', email: `${crypto.randomUUID()}@example.am`, platformRole } });
  }
  it('revokes detail and old command replay immediately after reassignment', async () => {
    const [admin, support, other] = await Promise.all([staff('ADMIN'), staff('SUPPORT'), staff('SUPPORT')]);
    const created = await service.create(support.id, 'create-case-key', { contact: { name: 'Anna', phone: '+37499123456' } });
    await service.assign(admin.id, created.enquiry.id, { key: 'reassign-case-key', dto: { expectedRevision: 1, assignedUserId: other.id } });
    await expect(service.detail(support.id, created.enquiry.id)).rejects.toThrow('No such enquiry');
    await expect(service.create(support.id, 'create-case-key', { contact: { name: 'Anna', phone: '+37499123456' } })).rejects.toThrow('No such enquiry');
    expect((await service.detail(other.id, created.enquiry.id)).assignedUserId).toBe(other.id);
    expect(await prisma.enquiryCommand.count()).toBe(2);
  });
  it('serializes concurrent create retries without merging separate contacts', async () => {
    const support = await staff('SUPPORT');
    const dto = { contact: { name: 'Anna', email: 'ANNA@example.am' } };
    const [first, retry] = await Promise.all([service.create(support.id, 'same-create-key', dto), service.create(support.id, 'same-create-key', dto)]);
    expect(first.enquiry.id).toBe(retry.enquiry.id);
    await service.create(support.id, 'other-create-key', dto);
    expect(await prisma.salesEnquiry.count()).toBe(2);
    expect(await prisma.enquiryContactAddress.count()).toBe(2);
  });
  it('rolls back stale note with its activity and receipt', async () => {
    const support = await staff('SUPPORT');
    const created = await service.create(support.id, 'create-case-key', { contact: { name: 'Anna', phone: '+37499123456' } });
    await service.addNote(support.id, created.enquiry.id, { key: 'first-note-key', dto: { expectedRevision: 1, body: 'Only note' } });
    await expect(service.addNote(support.id, created.enquiry.id, { key: 'stale-note-key', dto: { expectedRevision: 1, body: 'Never stored' } })).rejects.toThrow('ENQUIRY_CHANGED');
    expect(await prisma.enquiryNote.count()).toBe(1);
    expect(await prisma.enquiryActivity.count()).toBe(2);
    expect(await prisma.enquiryCommand.count()).toBe(2);
  });
  it('maps opposing same-key commands on different roots to a safe idempotency conflict', async () => {
    const admin = await staff('ADMIN');
    const cases = await Promise.all(['create-first-key', 'create-other-key'].map((key) => service.create(admin.id, key, { contact: { name: 'Anna', phone: '+37499123456' } })));
    const results = await Promise.allSettled(cases.map((entry) => service.addNote(admin.id, entry.enquiry.id, { key: 'same-note-command', dto: { expectedRevision: 1, body: 'Only one command' } })));
    expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((entry) => entry.status === 'rejected') as PromiseRejectedResult;
    expect(String(rejected.reason)).toContain('IDEMPOTENCY_CONFLICT');
    expect(await prisma.enquiryNote.count()).toBe(1);
  });

});
