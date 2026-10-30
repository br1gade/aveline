import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PrivacyService } from '../../src/modules/privacy/privacy.service';
import { EnquiriesService } from '../../src/modules/sales/enquiries.service';
import { EnquiryPrivacyService } from '../../src/modules/sales/enquiry-privacy.service';
import { EnquiryJournal } from '../../src/modules/sales/enquiry-journal';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StorageService } from '../../src/infra/storage/storage.service';
import { AuditService } from '../../src/infra/audit/audit.service';
import { AnalyticsService } from '../../src/infra/analytics/analytics.service';
import { seedEvent } from '../fixtures/event.fixture';
import { testPrisma, resetTestDatabase, disconnectTestDatabase } from '../setup/test-database';

describe('verified privacy scope at execution', () => {
  const prisma = testPrisma();
  let directory: string;
  let privacy: EnquiryPrivacyService;
  let enquiries: EnquiriesService;
  let service: PrivacyService;
  const storage = { removeByUrl: jest.fn().mockResolvedValue(undefined) };
  const audit = { forgetPerson: jest.fn().mockResolvedValue(undefined) };
  const analytics = { forgetGuests: jest.fn().mockResolvedValue(undefined) };
  beforeEach(async () => {
    await resetTestDatabase();
    jest.clearAllMocks();
    directory = await mkdtemp(join(tmpdir(), 'privacy-scope-'));
    await new EnquiryJournal(directory, 'j'.repeat(32)).initialize();
    const config = new ConfigService({ SALES_INTAKE_ENABLED: 'true', SALES_INTENT_HMAC_KEY_ID: 'test', SALES_INTENT_HMAC_KEYS: JSON.stringify({ test: 'x'.repeat(32) }), SALES_PRIVACY_JOURNAL_DIR: directory, SALES_PRIVACY_JOURNAL_KEY: 'j'.repeat(32) });
    enquiries = new EnquiriesService(prisma as PrismaService, config);
    privacy = new EnquiryPrivacyService(prisma as PrismaService, config);
    service = new PrivacyService(prisma as PrismaService, storage as unknown as StorageService, audit as unknown as AuditService, analytics as unknown as AnalyticsService);
    Object.defineProperty(service, 'enquiryPrivacy', { value: privacy });
  });
  afterEach(async () => { jest.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });
  afterAll(disconnectTestDatabase);

  async function createCase() {
    const staff = await prisma.user.create({ data: { name: 'Privacy', email: `${crypto.randomUUID()}@example.am`, platformRole: 'ADMIN' } });
    const result = await enquiries.create(staff.id, 'scope-create-case', { contact: { name: 'Prospect', phone: '+37499123456' } });
    return { staff, result };
  }
  async function createRequest(input: { userId: string; contactId: string; kind: 'ERASURE' | 'EXPORT' }) {
    const request = await privacy.createRequest(input.userId, { kind: input.kind, contactIds: [input.contactId] });
    await prisma.dataSubjectRequest.update({ where: { id: request.id }, data: { status: 'IN_PROGRESS' } });
    await privacy.bindSubjects(input.userId, request.id, { contactIds: [input.contactId], verificationNote: 'Reviewed contact scope' });
    return request;
  }
  async function addAcceptedOwner(contactId: string) {
    const owner = await prisma.user.create({ data: { email: 'verified-owner@example.am', name: 'Owner', passwordHash: 'synthetic-owner-password-hash' } });
    const organization = await prisma.organization.create({ data: { name: 'Owner organization' } });
    await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: owner.id, role: 'OWNER' } });
    const invite = await prisma.organizationInvite.create({ data: { organizationId: organization.id, email: owner.email, role: 'OWNER', tokenHash: crypto.randomUUID(), expiresAt: new Date(Date.now() + 86400000), acceptedAt: new Date(), acceptedByUserId: owner.id } });
    const contact = await prisma.enquiryContact.findUniqueOrThrow({ where: { id: contactId } });
    const root = await prisma.salesEnquiry.findUniqueOrThrow({ where: { id: contact.enquiryId } });
    await enquiries.update(root.createdByUserId, root.id, { key: 'record-primary-owner-email', dto: { expectedRevision: root.revision, contact: { email: owner.email } } });
    await prisma.ownerInviteDelivery.create({ data: { organizationInviteId: invite.id, enquiryId: contact.enquiryId, sourceContactId: contactId, privacyRevision: 0 } });
    return owner;
  }

  it('cleans external files, audit and analytics for the authoritative newly verified owner', async () => {
    const first = await createCase();
    const second = await createCase();
    const owner = await addAcceptedOwner(second.result.enquiry.contact!.id);
    const event = await seedEvent(prisma);
    const guest = await prisma.guest.findFirstOrThrow({ where: { eventId: event.eventId } });
    await prisma.guest.update({ where: { id: guest.id }, data: { email: owner.email } });
    const signature = await prisma.mediaAsset.create({ data: { eventId: event.eventId, kind: 'SIGNATURE', url: 'https://files.test/authoritative-owner.png', mimeType: 'image/png', sizeBytes: 1 } });
    await prisma.rsvp.update({ where: { guestId: guest.id }, data: { signatureAssetId: signature.id } });
    const request = await createRequest({ userId: first.staff.id, contactId: first.result.enquiry.contact!.id, kind: 'ERASURE' });
    const resolve = privacy.resolveSubject.bind(privacy);
    jest.spyOn(privacy, 'resolveSubject').mockImplementationOnce(async (requestId) => {
      const earlier = await resolve(requestId);
      await privacy.bindSubjects(first.staff.id, requestId, { contactIds: [second.result.enquiry.contact!.id], verificationNote: 'Reviewed replacement scope', verifiedOwnerUserId: owner.id, ownerVerificationNote: 'Separate owner identity evidence' });
      return earlier;
    });
    await service.fulfil(request.id, first.staff.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).isActive).toBe(false);
    expect(storage.removeByUrl).toHaveBeenCalledWith(signature.url);
    expect(audit.forgetPerson).toHaveBeenCalledWith({ email: owner.email, userId: owner.id });
    expect(analytics.forgetGuests).toHaveBeenCalledWith([guest.id]);
  });

  it('keeps completion pending for a newly appended contact outside the first journal batch', async () => {
    const first = await createCase();
    const second = await createCase();
    const request = await createRequest({ userId: first.staff.id, contactId: first.result.enquiry.contact!.id, kind: 'ERASURE' });
    await prisma.enquiryPrivacyRedaction.createMany({ data: Array.from({ length: 99 }, (_, index) => ({ enquiryId: `older-${index}`, contactId: `older-${index}`, reason: 'RETENTION' as const, privacyRevision: 1, redactedAt: new Date('2026-01-01') })) });
    const resolve = privacy.resolveSubject.bind(privacy);
    jest.spyOn(privacy, 'resolveSubject').mockImplementationOnce(async (requestId) => {
      const earlier = await resolve(requestId);
      await privacy.bindSubjects(first.staff.id, requestId, { contactIds: [second.result.enquiry.contact!.id], verificationNote: 'Reviewed additional subject', append: true });
      return earlier;
    });
    const checkpoint = privacy.checkpoint.bind(privacy);
    jest.spyOn(privacy, 'checkpoint').mockImplementationOnce(async () => {
      // Place A before B deterministically: the real first batch acknowledges A and 99 older receipts.
      await prisma.enquiryPrivacyRedaction.updateMany({ where: { contactId: first.result.enquiry.contact!.id }, data: { redactedAt: new Date('2026-01-02') } });
      return checkpoint();
    });
    const result = await service.fulfil(request.id, first.staff.id);
    expect(result).toHaveProperty('recoveryPending', true);
    expect((await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('IN_PROGRESS');
    expect(await prisma.enquiryPrivacyRedaction.count({ where: { contactId: second.result.enquiry.contact!.id, checkpointedAt: null } })).toBe(1);
    await expect(privacy.bindSubjects(first.staff.id, request.id, { contactIds: [first.result.enquiry.contact!.id], verificationNote: 'Stale attempt to replace applied scope' })).rejects.toThrow('before binding');
    await service.fulfil(request.id, first.staff.id);
    expect((await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('COMPLETED');
  });

  it('locks an export scope through projection and completion so a later rebind cannot relabel it', async () => {
    const first = await createCase();
    const second = await createCase();
    const request = await createRequest({ userId: first.staff.id, contactId: first.result.enquiry.contact!.id, kind: 'EXPORT' });
    let signalCaptured!: () => void;
    let release!: () => void;
    const captured = new Promise<void>((resolve) => { signalCaptured = resolve; });
    const proceed = new Promise<void>((resolve) => { release = resolve; });
    const exportSubject = privacy.exportSubject.bind(privacy);
    jest.spyOn(privacy, 'exportSubject').mockImplementationOnce(async (subject, tx) => {
      const projected = await exportSubject(subject, tx);
      signalCaptured();
      await proceed;
      return projected;
    });
    const fulfil = service.fulfil(request.id, first.staff.id);
    try {
      await captured;
      await expect(prisma.$transaction((tx) => tx.$queryRaw`SELECT id FROM data_subject_requests WHERE id=${request.id} FOR UPDATE NOWAIT`)).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } });
    } finally { release(); await fulfil; }
    await expect(privacy.bindSubjects(first.staff.id, request.id, { contactIds: [second.result.enquiry.contact!.id], verificationNote: 'A different later scope' })).rejects.toThrow('before binding');
    expect(await prisma.dataSubjectRequestEnquirySubject.findMany({ where: { requestId: request.id } })).toEqual([{ requestId: request.id, contactId: first.result.enquiry.contact!.id }]);
  });
});
