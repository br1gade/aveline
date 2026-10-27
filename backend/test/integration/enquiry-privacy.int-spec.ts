import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertTestDatabaseUrl } from '../../src/common/test-database-url';
import { EnquiryJournal } from '../../src/modules/sales/enquiry-journal';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnquiriesService } from '../../src/modules/sales/enquiries.service';
import { EnquiryPrivacyService } from '../../src/modules/sales/enquiry-privacy.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma, TEST_DATABASE_URL } from '../setup/test-database';

describe('verified enquiry privacy and durable replay', () => {
  const prisma = testPrisma();
  let enquiries: EnquiriesService;
  let privacy: EnquiryPrivacyService;
  let directory: string;
  beforeEach(async () => {
    await resetTestDatabase();
    directory = await mkdtemp(join(tmpdir(), 'intake-journal-'));
    await new EnquiryJournal(directory, 'j'.repeat(32)).initialize();
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
    const url = assertTestDatabaseUrl(TEST_DATABASE_URL);
    url.search = '';
    const dump = join(directory, 'before-redaction.dump');
    await promisify(execFile)('pg_dump', ['--format=custom', '--no-owner', '--file', dump, url.toString()]);
    await prisma.$transaction((tx) => privacy.eraseInTransaction(tx, { subject: { email: null, verifiedContactIds: [result.enquiry.contact!.id] }, now: new Date() }));
    await privacy.checkpoint();
    await prisma.$disconnect();
    await promisify(execFile)('pg_restore', ['--clean', '--if-exists', '--no-owner', '--single-transaction', '--dbname', url.toString(), dump]);
    expect((await prisma.enquiryContact.findUniqueOrThrow({ where: { id: result.enquiry.contact!.id } })).name).toBe('Anna');
    await privacy.replayJournal();
    await privacy.replayJournal();
    expect((await prisma.enquiryContact.findUniqueOrThrow({ where: { id: result.enquiry.contact!.id } })).name).toBeNull();
    expect((await prisma.enquiryNote.findFirstOrThrow()).body).toBeNull();
    expect(await prisma.enquiryContactAddress.count()).toBe(0);
    expect(await prisma.enquiryCommand.count({ where: { requestFingerprint: { not: null } } })).toBe(0);
    expect(await prisma.enquiryErasureTombstone.count()).toBe(1);
    expect(await prisma.enquiryPrivacyRedaction.count({ where: { checkpointedAt: null } })).toBe(0);
  });
  it('keeps a request pending behind a full older checkpoint batch and recovery finalizes only its acknowledgement', async () => {
    const { staff, result } = await createCase();
    const request = await privacy.createRequest(staff.id, { kind: 'ERASURE', contactIds: [result.enquiry.contact!.id] });
    await prisma.dataSubjectRequest.update({ where: { id: request.id }, data: { status: 'IN_PROGRESS' } });
    await privacy.bindSubjects(staff.id, request.id, { contactIds: [result.enquiry.contact!.id], verificationNote: 'Verified evidence reference' });
    await prisma.enquiryPrivacyRedaction.createMany({ data: Array.from({ length: 100 }, (_, index) => ({ enquiryId: `older-case-${index}`, contactId: `older-contact-${index}`, reason: 'RETENTION' as const, privacyRevision: 1, redactedAt: new Date('2026-01-01') })) });
    await prisma.$transaction((tx) => privacy.eraseInTransaction(tx, { subject: { email: null, verifiedContactIds: [result.enquiry.contact!.id] }, now: new Date(), requestId: request.id }));
    await prisma.dataSubjectRequest.update({ where: { id: request.id }, data: { erasureAppliedAt: new Date(), erasureCheckpointId: request.id, erasureResult: { enquiriesCleared: 1 } } });
    expect(await privacy.checkpoint()).toBe(100);
    expect(await privacy.finalizeCheckpointedRequests()).toBe(0);
    expect((await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('IN_PROGRESS');
    expect(await privacy.checkpoint()).toBe(1);
    expect(await privacy.finalizeCheckpointedRequests()).toBe(1);
  });

});
