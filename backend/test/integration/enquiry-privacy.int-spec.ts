import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnquiriesService } from '../../src/modules/sales/enquiries.service';
import { EnquiryPrivacyService } from '../../src/modules/sales/enquiry-privacy.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('verified enquiry privacy and durable replay', () => {
  const prisma = testPrisma();
  let enquiries: EnquiriesService;
  let privacy: EnquiryPrivacyService;
  let directory: string;
  beforeEach(async () => {
    await resetTestDatabase();
    directory = await mkdtemp(join(tmpdir(), 'intake-journal-'));
    const config = new ConfigService({ SALES_INTAKE_ENABLED: 'true', SALES_INTAKE_SUPPORT_ENABLED: 'true', SALES_INTENT_HMAC_KEY_ID: 'test', SALES_INTENT_HMAC_KEYS: JSON.stringify({ test: 'x'.repeat(32) }), SALES_PRIVACY_JOURNAL_DIR: directory, SALES_PRIVACY_JOURNAL_KEY: 'j'.repeat(32) });
    enquiries = new EnquiriesService(prisma as PrismaService, config);
    privacy = new EnquiryPrivacyService(prisma as PrismaService, config);
  });
  afterEach(async () => rm(directory, { recursive: true, force: true }));
  afterAll(disconnectTestDatabase);
  async function createCase() {
    const staff = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@example.am`, name: 'Operator', platformRole: 'ADMIN' } });
    const result = await enquiries.create(staff.id, 'create-case-key', { contact: { name: 'Anna', phone: '+37499123456' } });
    await enquiries.addNote(staff.id, result.enquiry.id, { key: 'personal-note-key', dto: { expectedRevision: 1, body: 'Private consultation facts' } });
    return { staff, result };
  }
  it('requires reviewed phone-only binding and clears all identifying copies with spent receipts', async () => {
    const { staff, result } = await createCase();
    const request = await privacy.createRequest(staff.id, { kind: 'ERASURE', contactIds: [result.enquiry.contact!.id] });
    await expect(privacy.resolveSubject(request.id)).rejects.toThrow('verified');
    await prisma.dataSubjectRequest.update({ where: { id: request.id }, data: { status: 'IN_PROGRESS' } });
    await privacy.bindSubjects(staff.id, request.id, { contactIds: [result.enquiry.contact!.id], verificationNote: 'Identity reviewed under case evidence reference 42' });
    const subject = await privacy.resolveSubject(request.id);
    await prisma.$transaction((tx) => privacy.eraseInTransaction(tx, { subject, now: new Date(), requestId: request.id }));
    expect((await prisma.enquiryContact.findUniqueOrThrow({ where: { id: result.enquiry.contact!.id } })).phone).toBeNull();
    expect((await prisma.enquiryNote.findFirstOrThrow()).body).toBeNull();
    expect(await prisma.enquiryContactAddress.count()).toBe(0);
    expect(await prisma.enquiryErasureTombstone.count()).toBe(1);
    expect(await prisma.enquiryCommand.count({ where: { requestFingerprint: { not: null } } })).toBe(0);
    await expect(enquiries.create(staff.id, 'create-case-key', { contact: { name: 'Anna', phone: '+37499123456' } })).rejects.toThrow('SUBJECT_ERASED');
    await privacy.checkpoint();
    expect(await prisma.enquiryPrivacyRedaction.count({ where: { checkpointedAt: null } })).toBe(0);
  });
  it('restores older contact copies then replays the newer signed journal idempotently', async () => {
    const { result } = await createCase();
    await prisma.$transaction((tx) => privacy.eraseInTransaction(tx, { subject: { email: null, verifiedContactIds: [result.enquiry.contact!.id] }, now: new Date() }));
    await privacy.checkpoint();
    await prisma.$executeRaw`UPDATE enquiry_contacts SET name='Restored private',phone='+37499123456',"redactedAt"=NULL WHERE id=${result.enquiry.contact!.id}`;
    await prisma.$executeRaw`UPDATE sales_enquiries SET "personalDataClearedAt"=NULL WHERE id=${result.enquiry.id}`;
    await privacy.replayJournal();
    await privacy.replayJournal();
    expect((await prisma.enquiryContact.findUniqueOrThrow({ where: { id: result.enquiry.contact!.id } })).name).toBeNull();
  });
});
