import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnquiryJournal } from '../../src/modules/sales/enquiry-journal';
import { PrivacyService } from '../../src/modules/privacy/privacy.service';
import { assertTestDatabaseUrl } from '../../src/common/test-database-url';
import { AccountService } from '../../src/infra/auth/account.service';
import { EnquiryPrivacyService } from '../../src/modules/sales/enquiry-privacy.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../../src/app.module';
import { EnquiriesService } from '../../src/modules/sales/enquiries.service';
import { EnquiryConversionService } from '../../src/modules/sales/enquiry-conversion.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma, TEST_DATABASE_URL } from '../setup/test-database';

describe('explicit atomic draft enquiry conversion', () => {
  const prisma = testPrisma();
  let module: TestingModule;
  let enquiries: EnquiriesService;
  let conversion: EnquiryConversionService;
  let directory: string;
  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    const config = module.get(ConfigService);
    for (const [key, value] of Object.entries({ SALES_INTAKE_ENABLED: 'true', SALES_INTAKE_SUPPORT_ENABLED: 'true', SALES_ENQUIRY_CONVERSION_ENABLED: 'true', SALES_INTENT_HMAC_KEY_ID: 'test', SALES_INTENT_HMAC_KEYS: JSON.stringify({ test: 'x'.repeat(32) }) })) config.set(key, value);
    enquiries = module.get(EnquiriesService);
    conversion = module.get(EnquiryConversionService);
  });
  beforeEach(async () => {
    await resetTestDatabase();
    directory = await mkdtemp(join(tmpdir(), 'intake-owner-journal-'));
    await new EnquiryJournal(directory, 'j'.repeat(32)).initialize();
    module.get(ConfigService).set('SALES_PRIVACY_JOURNAL_DIR', directory);
    module.get(ConfigService).set('SALES_PRIVACY_JOURNAL_KEY', 'j'.repeat(32));
    await prisma.designTemplate.create({ data: { key: 'classic', name: 'Classic', allowedFonts: ['Inter'], supportedBlocks: ['HERO', 'RSVP'] } });
    await prisma.messageTemplate.create({ data: { key: 'organization.invite', channel: 'EMAIL', subject: { en: '{{organizationName}}' }, body: { en: '{{link}}' } } });
  });
  afterEach(async () => rm(directory, { recursive: true, force: true }));
  afterAll(async () => { if (module) await module.close(); await disconnectTestDatabase(); });
  async function createCase(key: string) {
    const staff = await prisma.user.create({ data: { email: `${key}@example.am`, name: 'Staff', platformRole: 'SUPPORT' } });
    const result = await enquiries.create(staff.id, `${key}-create`, { contact: { name: 'Anna', email: 'anna@example.am' } });
    return { staff, result };
  }
  it('commits one draft setup and one rendered owner message under competing conversion keys', async () => {
    const { staff, result } = await createCase('first');
    const dto = { expectedRevision: 1, organization: { create: { name: 'Anna family', ownerEmail: 'anna@example.am', ownerEmailSource: 'PRIMARY_CONTACT' as const } }, event: { create: { type: 'WEDDING' as const, title: 'Anna and Davit', startsAt: '2027-06-12T15:00:00Z' } } };
    const [first, retry] = await Promise.all([conversion.convert(staff.id, result.enquiry.id, { key: 'first-conversion', dto }), conversion.convert(staff.id, result.enquiry.id, { key: 'other-conversion', dto })]);
    expect(first.enquiry.organizationId).toBe(retry.enquiry.organizationId);
    expect(first.enquiry.eventId).toBe(retry.enquiry.eventId);
    expect(await prisma.organization.count()).toBe(1);
    expect(await prisma.event.count()).toBe(1);
    expect(await prisma.invitation.count()).toBe(1);
    expect(await prisma.message.count()).toBe(1);
    expect(await prisma.organizationInvite.count()).toBe(1);
    expect(await prisma.organizationMembership.count()).toBe(0);
    expect(await prisma.eventMembership.count()).toBe(0);
    expect((await prisma.ownerInviteDelivery.findFirstOrThrow()).sourceContactId).toBe(result.enquiry.contact!.id);
  });
  it('rolls organization and event back when the owner message template is missing', async () => {
    const { staff, result } = await createCase('rollback');
    await prisma.messageTemplate.deleteMany();
    await expect(conversion.convert(staff.id, result.enquiry.id, { key: 'rollback-conversion', dto: { expectedRevision: 1, organization: { create: { name: 'Anna family', ownerEmail: 'anna@example.am' } }, event: { create: { type: 'WEDDING', title: 'Anna and Davit', startsAt: '2027-06-12T15:00:00Z' } } } })).rejects.toThrow();
    expect(await prisma.organization.count()).toBe(0);
    expect(await prisma.event.count()).toBe(0);
    expect(await prisma.enquiryConversion.count()).toBe(0);
    expect((await prisma.salesEnquiry.findUniqueOrThrow({ where: { id: result.enquiry.id } })).revision).toBe(1);
  });
  it('permits explicit organization-only linkage then a single draft event without another invite', async () => {
    const { staff, result } = await createCase('later');
    const linked = await conversion.convert(staff.id, result.enquiry.id, { key: 'org-only-conversion', dto: { expectedRevision: 1, organization: { create: { name: 'Anna family', ownerEmail: 'anna@example.am' } } } });
    expect(linked.enquiry.eventId).toBeNull();
    await conversion.convert(staff.id, result.enquiry.id, { key: 'add-event-conversion', dto: { expectedRevision: 2, organization: { existingId: linked.enquiry.organizationId! }, event: { create: { type: 'WEDDING', title: 'Anna and Davit', startsAt: '2027-06-12T15:00:00Z' } } } });
    expect(await prisma.message.count()).toBe(1);
    expect(await prisma.enquiryConversion.count()).toBe(1);
  });
  it('requires separate accepted-owner identity verification beyond a phone-only contact binding', async () => {
    const { staff, result } = await createCase('owner-review');
    await conversion.convert(staff.id, result.enquiry.id, { key: 'owner-review-conversion', dto: { expectedRevision: 1, organization: { create: { name: 'Anna family', ownerEmail: 'anna@example.am', ownerEmailSource: 'PRIMARY_CONTACT' } } } });
    const message = await prisma.message.findFirstOrThrow();
    const token = new URL(message.body).searchParams.get('token')!;
    await module.get(AccountService).acceptInvite({ token, name: 'Anna', password: 'a-long-owner-password' });
    const admin = await prisma.user.create({ data: { email: 'privacy@example.am', name: 'Privacy', platformRole: 'ADMIN' } });
    const privacy = module.get(EnquiryPrivacyService);
    const request = await privacy.createRequest(admin.id, { kind: 'ERASURE', contactIds: [result.enquiry.contact!.id] });
    await prisma.dataSubjectRequest.update({ where: { id: request.id }, data: { status: 'IN_PROGRESS' } });
    await privacy.bindSubjects(admin.id, request.id, { contactIds: [result.enquiry.contact!.id], verificationNote: 'Phone identity verified' });
    await expect(privacy.resolveSubject(request.id)).rejects.toThrow('verifiedOwnerUserId');
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'anna@example.am' } })).isActive).toBe(true);
  });

  it('erases only an additionally verified accepted account and preserves that closure after old-backup replay', async () => {
    const { staff, result } = await createCase('owner-erasure');
    await conversion.convert(staff.id, result.enquiry.id, { key: 'owner-erasure-conversion', dto: { expectedRevision: 1, organization: { create: { name: 'Anna family', ownerEmail: 'anna@example.am', ownerEmailSource: 'PRIMARY_CONTACT' } } } });
    const token = new URL((await prisma.message.findFirstOrThrow()).body).searchParams.get('token')!;
    await module.get(AccountService).acceptInvite({ token, name: 'Anna', password: 'a-long-owner-password' });
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'anna@example.am' } });
    await prisma.session.create({ data: { userId: owner.id, tokenHash: 'owner-session-hash', expiresAt: new Date(Date.now() + 86400000) } });
    const admin = await prisma.user.create({ data: { email: 'verifier@example.am', name: 'Privacy', platformRole: 'ADMIN' } });
    const privacy = module.get(EnquiryPrivacyService);
    const request = await privacy.createRequest(admin.id, { kind: 'ERASURE', contactIds: [result.enquiry.contact!.id] });
    await prisma.dataSubjectRequest.update({ where: { id: request.id }, data: { status: 'IN_PROGRESS' } });
    const verified = await privacy.bindSubjects(admin.id, request.id, { contactIds: [result.enquiry.contact!.id], verificationNote: 'Contact evidence 42', verifiedOwnerUserId: owner.id, ownerVerificationNote: 'Separate account identity evidence 43' });
    expect(verified.subjectEmail).toBe(owner.email);
    const url = assertTestDatabaseUrl(TEST_DATABASE_URL);
    url.search = '';
    const dump = join(directory, 'before-owner-erasure.dump');
    await promisify(execFile)('pg_dump', ['--format=custom', '--no-owner', '--file', dump, url.toString()]);
    await module.get(PrivacyService).fulfil(request.id, admin.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).isActive).toBe(false);
    expect((await prisma.enquiryPrivacyRedaction.findFirstOrThrow()).verifiedOwnerUserId).toBe(owner.id);
    await prisma.$disconnect();
    await promisify(execFile)('pg_restore', ['--clean', '--if-exists', '--no-owner', '--single-transaction', '--dbname', url.toString(), dump]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).isActive).toBe(true);
    await privacy.replayJournal();
    await privacy.replayJournal();
    expect(await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).toMatchObject({ isActive: false, passwordHash: null, name: 'Removed' });
    expect((await prisma.session.findFirstOrThrow({ where: { userId: owner.id } })).revokedAt).not.toBeNull();
    expect((await prisma.enquiryContact.findUniqueOrThrow({ where: { id: result.enquiry.contact!.id } })).email).toBeNull();
  });
  it('keeps an independently supplied accepted owner untouched by contact-only phone erasure', async () => {
    const { staff, result } = await createCase('independent-owner');
    await conversion.convert(staff.id, result.enquiry.id, { key: 'independent-conversion', dto: { expectedRevision: 1, organization: { create: { name: 'Family', ownerEmail: 'anna@example.am', ownerEmailSource: 'INDEPENDENT' } } } });
    const message = await prisma.message.findFirstOrThrow();
    const token = new URL(message.body).searchParams.get('token')!;
    await module.get(AccountService).acceptInvite({ token, name: 'Independent owner', password: 'a-long-owner-password' });
    const admin = await prisma.user.create({ data: { email: 'reviewer@example.am', name: 'Privacy', platformRole: 'ADMIN' } });
    const privacy = module.get(EnquiryPrivacyService);
    const request = await privacy.createRequest(admin.id, { kind: 'ERASURE', contactIds: [result.enquiry.contact!.id] });
    await prisma.dataSubjectRequest.update({ where: { id: request.id }, data: { status: 'IN_PROGRESS' } });
    const bound = await privacy.bindSubjects(admin.id, request.id, { contactIds: [result.enquiry.contact!.id], verificationNote: 'Only the prospect identity was verified' });
    expect(bound.ownerAccountCandidates).toEqual([]);
    await module.get(PrivacyService).fulfil(request.id, admin.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'anna@example.am' } })).isActive).toBe(true);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).body).toBe(message.body);
    expect(await prisma.organizationInvite.count()).toBe(1);
  });

  it('replays the current case after the selected template retires and created event publishes', async () => {
    const { staff, result } = await createCase('retired-replay');
    const dto = { expectedRevision: 1, organization: { create: { name: 'Family', ownerEmail: 'anna@example.am' } }, event: { create: { type: 'WEDDING' as const, title: 'Anna and Davit', startsAt: '2027-06-12T15:00:00Z', templateKey: 'classic' } } };
    const converted = await conversion.convert(staff.id, result.enquiry.id, { key: 'retired-template-replay', dto });
    await prisma.designTemplate.update({ where: { key: 'classic' }, data: { isActive: false } });
    await prisma.event.update({ where: { id: converted.enquiry.eventId! }, data: { status: 'PUBLISHED' } });
    await enquiries.stage(staff.id, result.enquiry.id, { key: 'after-conversion-stage', dto: { expectedRevision: 2, stage: 'CONTACTED' } });
    const replay = await conversion.convert(staff.id, result.enquiry.id, { key: 'retired-template-replay', dto });
    expect(replay.commandId).toBe(converted.commandId);
    expect(replay.appliedRevision).toBe(2);
    expect(replay.enquiry.revision).toBe(3);
    expect(await prisma.message.count()).toBe(1);
    expect(await prisma.event.count()).toBe(1);
  });
  it('replays an existing-event conversion after that event leaves DRAFT', async () => {
    const { staff, result } = await createCase('published-replay');
    const organization = await prisma.organization.create({ data: { name: 'Existing family' } });
    const event = await prisma.event.create({ data: { organizationId: organization.id, type: 'WEDDING', title: 'Existing event', hostsLabel: 'Family', startsAt: new Date('2027-06-12T15:00:00Z') } });
    const dto = { expectedRevision: 1, organization: { existingId: organization.id }, event: { existingId: event.id } };
    const converted = await conversion.convert(staff.id, result.enquiry.id, { key: 'published-event-replay', dto });
    await prisma.event.update({ where: { id: event.id }, data: { status: 'PUBLISHED' } });
    const replay = await conversion.convert(staff.id, result.enquiry.id, { key: 'published-event-replay', dto });
    expect(replay.commandId).toBe(converted.commandId);
    expect(await prisma.enquiryCommand.count()).toBe(2);
  });
  it('keeps an invalidated conversion receipt spent even when its resources are unavailable', async () => {
    const { staff, result } = await createCase('erased-replay');
    const dto = { expectedRevision: 1, organization: { create: { name: 'Family', ownerEmail: 'anna@example.am' } }, event: { create: { type: 'WEDDING' as const, title: 'Anna and Davit', startsAt: '2027-06-12T15:00:00Z', templateKey: 'classic' } } };
    await conversion.convert(staff.id, result.enquiry.id, { key: 'erased-conversion-replay', dto });
    const privacy = module.get(EnquiryPrivacyService);
    await prisma.$transaction((tx) => privacy.eraseInTransaction(tx, { subject: { email: null, verifiedContactIds: [result.enquiry.contact!.id] }, now: new Date() }));
    await prisma.designTemplate.update({ where: { key: 'classic' }, data: { isActive: false } });
    await expect(conversion.convert(staff.id, result.enquiry.id, { key: 'erased-conversion-replay', dto })).rejects.toThrow('SUBJECT_ERASED');
    expect(await prisma.enquiryConversion.count()).toBe(1);
  });
  it('refuses a former assignee conversion replay before unavailable-resource preparation', async () => {
    const { staff, result } = await createCase('transferred-replay');
    const dto = { expectedRevision: 1, organization: { create: { name: 'Family', ownerEmail: 'anna@example.am' } }, event: { create: { type: 'WEDDING' as const, title: 'Anna and Davit', startsAt: '2027-06-12T15:00:00Z', templateKey: 'classic' } } };
    await conversion.convert(staff.id, result.enquiry.id, { key: 'transferred-conversion-replay', dto });
    const admin = await prisma.user.create({ data: { email: 'transfer-admin@example.am', name: 'Admin', platformRole: 'ADMIN' } });
    const other = await prisma.user.create({ data: { email: 'next-support@example.am', name: 'Operator', platformRole: 'SUPPORT' } });
    await enquiries.assign(admin.id, result.enquiry.id, { key: 'transfer-converted-case', dto: { expectedRevision: 2, assignedUserId: other.id } });
    await prisma.designTemplate.update({ where: { key: 'classic' }, data: { isActive: false } });
    await expect(conversion.convert(staff.id, result.enquiry.id, { key: 'transferred-conversion-replay', dto })).rejects.toThrow('No such enquiry');
  });

});
