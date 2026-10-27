import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../../src/app.module';
import { EnquiriesService } from '../../src/modules/sales/enquiries.service';
import { EnquiryConversionService } from '../../src/modules/sales/enquiry-conversion.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('explicit atomic draft enquiry conversion', () => {
  const prisma = testPrisma();
  let module: TestingModule;
  let enquiries: EnquiriesService;
  let conversion: EnquiryConversionService;
  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    const config = module.get(ConfigService);
    for (const [key, value] of Object.entries({ SALES_INTAKE_ENABLED: 'true', SALES_INTAKE_SUPPORT_ENABLED: 'true', SALES_ENQUIRY_CONVERSION_ENABLED: 'true', SALES_INTENT_HMAC_KEY_ID: 'test', SALES_INTENT_HMAC_KEYS: JSON.stringify({ test: 'x'.repeat(32) }) })) config.set(key, value);
    enquiries = module.get(EnquiriesService);
    conversion = module.get(EnquiryConversionService);
  });
  beforeEach(async () => {
    await resetTestDatabase();
    await prisma.designTemplate.create({ data: { key: 'classic', name: 'Classic', allowedFonts: ['Inter'], supportedBlocks: ['HERO', 'RSVP'] } });
    await prisma.messageTemplate.create({ data: { key: 'organization.invite', channel: 'EMAIL', subject: { en: '{{organizationName}}' }, body: { en: '{{link}}' } } });
  });
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
});
