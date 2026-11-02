import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../../../src/app.module';
import { EnquiriesService } from '../../../src/modules/sales/enquiries.service';
import { EnquiryConversionService } from '../../../src/modules/sales/enquiry-conversion.service';
import { EnquiryJournal } from '../../../src/modules/sales/enquiry-journal';
import { ConvertEnquiryDto } from '../../../src/modules/sales/dto/enquiry-conversion.dto';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * docs/API.md, "Staff enquiries and consultation appointments" (conversion):
 * the target is validated before anything is written, an existing link cannot
 * be swapped, and the owner's existing organization or pending invitation is
 * reused rather than duplicated.
 */
const FLAGS = { SALES_INTAKE_ENABLED: 'true', SALES_INTAKE_SUPPORT_ENABLED: 'true', SALES_ENQUIRY_CONVERSION_ENABLED: 'true', SALES_INTENT_HMAC_KEY_ID: 'test', SALES_INTENT_HMAC_KEYS: JSON.stringify({ test: 'x'.repeat(32) }) };
const NEW_EVENT = { type: 'WEDDING' as const, title: 'Anna and Davit', startsAt: '2027-06-12T15:00:00Z' };

describe('enquiry conversion targets (integration coverage)', () => {
  const prisma = testPrisma();
  let module: TestingModule;
  let enquiries: EnquiriesService;
  let conversion: EnquiryConversionService;
  let directory: string;
  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    const config = module.get(ConfigService);
    for (const [key, value] of Object.entries(FLAGS)) config.set(key, value);
    enquiries = module.get(EnquiriesService);
    conversion = module.get(EnquiryConversionService);
  });
  beforeEach(async () => {
    await resetTestDatabase();
    directory = await mkdtemp(join(tmpdir(), 'post-pilot-conversion-'));
    await new EnquiryJournal(directory, 'j'.repeat(32)).initialize();
    module.get(ConfigService).set('SALES_PRIVACY_JOURNAL_DIR', directory);
    module.get(ConfigService).set('SALES_PRIVACY_JOURNAL_KEY', 'j'.repeat(32));
    await prisma.messageTemplate.create({ data: { key: 'organization.invite', channel: 'EMAIL', subject: { en: '{{organizationName}}' }, body: { en: '{{link}}' } } });
  });
  afterEach(async () => rm(directory, { recursive: true, force: true }));
  afterAll(async () => { if (module) await module.close(); await disconnectTestDatabase(); });

  async function createCase() {
    const staff = await prisma.user.create({ data: { email: `${randomUUID()}@example.am`, name: 'Staff', platformRole: 'SUPPORT' } });
    const created = await enquiries.create(staff.id, `create-${randomUUID()}`, { contact: { name: 'Anna', email: 'anna@example.am' } });
    return { staffId: staff.id, enquiryId: created.enquiry.id };
  }
  const convert = (state: { staffId: string; enquiryId: string }, input: { key: string; dto: ConvertEnquiryDto; organizationSelector?: string }) =>
    Promise.resolve().then(() => conversion.convert(state.staffId, state.enquiryId, input));
  const organization = (name = 'Existing family') => prisma.organization.create({ data: { name } });
  const draftEvent = (organizationId: string, status: 'DRAFT' | 'PUBLISHED' = 'DRAFT') =>
    prisma.event.create({ data: { organizationId, type: 'WEDDING', title: 'Existing event', hostsLabel: 'Family', startsAt: new Date('2027-06-12T15:00:00Z'), status } });
  async function snapshot(enquiryId: string) {
    const [organizations, events, conversions, invites, messages, root] = await Promise.all([prisma.organization.count(), prisma.event.count(), prisma.enquiryConversion.findMany(),
      prisma.organizationInvite.count(), prisma.message.count(), prisma.salesEnquiry.findUniqueOrThrow({ where: { id: enquiryId }, select: { revision: true, organizationId: true, eventId: true } })]);
    return { organizations, events, conversions, invites, messages, root };
  }

  describe('target shape', () => {
    it.each([
      { label: 'both organization.existingId and organization.create', message: 'organization: requires exactly one existingId or create',
        dto: (orgId: string) => ({ organization: { existingId: orgId, create: { name: 'Family', ownerEmail: 'anna@example.am' } } }) },
      { label: 'neither organization form', message: 'organization: requires exactly one existingId or create', dto: () => ({ organization: {} }) },
      { label: 'both event.existingId and event.create', message: 'event: requires exactly one existingId or create',
        dto: (orgId: string, eventId: string) => ({ organization: { existingId: orgId }, event: { existingId: eventId, create: NEW_EVENT } }) },
      { label: 'event.existingId with organization.create', message: 'event.existingId: requires organization.existingId',
        dto: (_orgId: string, eventId: string) => ({ organization: { create: { name: 'Family', ownerEmail: 'anna@example.am' } }, event: { existingId: eventId } }) },
    ])('refuses $label with 400 before writing', async ({ dto, message }) => {
      const state = await createCase();
      const existing = await organization();
      const event = await draftEvent(existing.id);
      const before = await snapshot(state.enquiryId);
      await expect(convert(state, { key: 'bad-shape-conversion', dto: { expectedRevision: 1, ...dto(existing.id, event.id) } })).rejects.toMatchObject({ status: 400, message });
      expect(await snapshot(state.enquiryId)).toEqual(before);
    });

    it('refuses an existing event that has left DRAFT', async () => {
      const state = await createCase();
      const existing = await organization();
      const published = await draftEvent(existing.id, 'PUBLISHED');
      const before = await snapshot(state.enquiryId);
      const result = convert(state, { key: 'published-event-conversion', dto: { expectedRevision: 1, organization: { existingId: existing.id }, event: { existingId: published.id } } });
      await expect(result).rejects.toMatchObject({ status: 400, message: 'event.existingId must be a DRAFT event in the selected organization' });
      expect(await snapshot(state.enquiryId)).toEqual(before);
    });

    it('refuses a DRAFT event that belongs to a different organization', async () => {
      const state = await createCase();
      const [selected, foreign] = await Promise.all([organization('Selected'), organization('Foreign')]);
      const foreignEvent = await draftEvent(foreign.id);
      const before = await snapshot(state.enquiryId);
      const result = convert(state, { key: 'foreign-event-conversion', dto: { expectedRevision: 1, organization: { existingId: selected.id }, event: { existingId: foreignEvent.id } } });
      await expect(result).rejects.toMatchObject({ status: 400, message: 'event.existingId must be a DRAFT event in the selected organization' });
      expect(await snapshot(state.enquiryId)).toEqual(before);
    });

    it('links an existing DRAFT event in the selected organization without changing its fields', async () => {
      const state = await createCase();
      const existing = await organization();
      const event = await draftEvent(existing.id);
      await convert(state, { key: 'existing-event-conversion', dto: { expectedRevision: 1, organization: { existingId: existing.id }, event: { existingId: event.id } } });
      expect(await prisma.enquiryConversion.findFirstOrThrow()).toMatchObject({ organizationId: existing.id, eventId: event.id, ownerInviteId: null });
      expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toEqual(event);
    });

    it('refuses a PRIMARY_CONTACT owner email that differs from the contact and rolls the new organization back', async () => {
      const state = await createCase();
      const before = await snapshot(state.enquiryId);
      const result = convert(state, { key: 'mismatched-owner-conversion', dto: { expectedRevision: 1, organization: { create: { name: 'Family', ownerEmail: 'someone-else@example.am', ownerEmailSource: 'PRIMARY_CONTACT' } } } });
      await expect(result).rejects.toMatchObject({ status: 400, message: 'organization.create.ownerEmail must match the explicitly selected primary contact' });
      expect(await snapshot(state.enquiryId)).toEqual(before);
    });
  });

  describe('existing links', () => {
    async function fullyConverted() {
      const state = await createCase();
      const dto = { expectedRevision: 1, organization: { create: { name: 'Anna family', ownerEmail: 'anna@example.am' } }, event: { create: NEW_EVENT } };
      const converted = await convert(state, { key: 'full-conversion', dto });
      return { state, organizationId: converted.enquiry.organizationId!, eventId: converted.enquiry.eventId! };
    }

    it('refuses switching a converted case to a different organization', async () => {
      const { state } = await fullyConverted();
      const other = await organization('Other');
      const before = await snapshot(state.enquiryId);
      await expect(convert(state, { key: 'switch-organization', dto: { expectedRevision: 2, organization: { existingId: other.id } } })).rejects.toMatchObject({ status: 409, message: 'ENQUIRY_CHANGED' });
      expect(await snapshot(state.enquiryId)).toEqual(before);
    });

    it('refuses replacing the linked event with a differently described new event', async () => {
      const { state, organizationId } = await fullyConverted();
      const before = await snapshot(state.enquiryId);
      const result = convert(state, { key: 'replace-event-create', dto: { expectedRevision: 2, organization: { existingId: organizationId }, event: { create: { ...NEW_EVENT, title: 'Another party' } } } });
      await expect(result).rejects.toMatchObject({ status: 409, message: 'ENQUIRY_CHANGED' });
      expect(await snapshot(state.enquiryId)).toEqual(before);
    });

    it('refuses replacing the linked event with another existing DRAFT event', async () => {
      const { state, organizationId, eventId } = await fullyConverted();
      const second = await draftEvent(organizationId);
      const result = convert(state, { key: 'replace-event-existing', dto: { expectedRevision: 2, organization: { existingId: organizationId }, event: { existingId: second.id } } });
      await expect(result).rejects.toMatchObject({ status: 409, message: 'ENQUIRY_CHANGED' });
      expect((await prisma.enquiryConversion.findFirstOrThrow()).eventId).toBe(eventId);
    });

    it('refuses adding an event under a different organization than the organization-only link', async () => {
      const state = await createCase();
      const linked = await convert(state, { key: 'org-only-conversion', dto: { expectedRevision: 1, organization: { create: { name: 'Anna family', ownerEmail: 'anna@example.am' } } } });
      const other = await organization('Other');
      const before = await snapshot(state.enquiryId);
      const result = convert(state, { key: 'add-event-elsewhere', dto: { expectedRevision: 2, organization: { existingId: other.id }, event: { create: NEW_EVENT } } });
      await expect(result).rejects.toMatchObject({ status: 409, message: 'ENQUIRY_CHANGED' });
      expect(await snapshot(state.enquiryId)).toEqual(before);
      expect(before.root.organizationId).toBe(linked.enquiry.organizationId);
    });
  });

  describe('organization selection', () => {
    const owner = (email = 'anna@example.am') => prisma.user.create({ data: { email, name: 'Anna' } });
    const pendingInvite = (organizationId: string, expiresAt: Date) =>
      prisma.organizationInvite.create({ data: { organizationId, email: 'anna@example.am', role: 'OWNER', tokenHash: randomUUID(), expiresAt } });
    const setup = { name: 'Anna family', ownerEmail: 'anna@example.am' };

    it('refuses a selected organization header that disagrees with the body and writes nothing', async () => {
      const state = await createCase();
      const [target, selected] = await Promise.all([organization('Target'), organization('Selected')]);
      const before = await snapshot(state.enquiryId);
      const result = convert(state, { key: 'mismatched-selector', organizationSelector: selected.id, dto: { expectedRevision: 1, organization: { existingId: target.id } } });
      await expect(result).rejects.toMatchObject({ status: 409, response: { message: 'organization selector does not match conversion target' } });
      expect(await snapshot(state.enquiryId)).toEqual(before);
    });

    it('requires explicit selection when the owner is a member of one organization and invited to own another', async () => {
      const state = await createCase();
      const person = await owner();
      const [first, second] = await Promise.all([organization('First'), organization('Second')]);
      // One account holds at most one membership, so ambiguity comes from a membership plus a live owner invitation.
      await prisma.organizationMembership.create({ data: { organizationId: first.id, userId: person.id, role: 'OWNER' } });
      await pendingInvite(second.id, new Date(Date.now() + 86_400_000));
      const before = await snapshot(state.enquiryId);
      await expect(convert(state, { key: 'ambiguous-owner', dto: { expectedRevision: 1, organization: { create: setup } } })).rejects.toMatchObject({ status: 409, response: { message: 'organizationId: select an organization for this action' } });
      expect(await snapshot(state.enquiryId)).toEqual(before);
    });

    it('requires explicit selection when the owner has only an expired pending owner invitation', async () => {
      const state = await createCase();
      const stale = await organization('Stale setup');
      await pendingInvite(stale.id, new Date(Date.now() - 60_000));
      const before = await snapshot(state.enquiryId);
      await expect(convert(state, { key: 'expired-pending-owner', dto: { expectedRevision: 1, organization: { create: setup } } })).rejects.toMatchObject({ status: 409, response: { message: 'organizationId: select an organization for this action' } });
      expect(await snapshot(state.enquiryId)).toEqual(before);
    });

    it('reuses the one organization the owner already belongs to, without a new invitation or message', async () => {
      const state = await createCase();
      const person = await owner();
      const existing = await organization('Existing family');
      await prisma.organizationMembership.create({ data: { organizationId: existing.id, userId: person.id, role: 'OWNER' } });
      const converted = await convert(state, { key: 'reuse-membership', dto: { expectedRevision: 1, organization: { create: setup } } });
      expect(converted.enquiry.organizationId).toBe(existing.id);
      expect(await prisma.organization.count()).toBe(1);
      expect(await prisma.organizationInvite.count()).toBe(0);
      expect(await prisma.message.count()).toBe(0);
      expect(await prisma.enquiryConversion.findFirstOrThrow()).toMatchObject({ organizationId: existing.id, ownerInviteId: null });
    });

    it('reuses a valid pending owner invitation instead of creating another organization or invitation', async () => {
      const state = await createCase();
      const pending = await organization('Pending family');
      const invite = await pendingInvite(pending.id, new Date(Date.now() + 86_400_000));
      const converted = await convert(state, { key: 'reuse-pending-invite', dto: { expectedRevision: 1, organization: { create: setup } } });
      expect(converted.enquiry.organizationId).toBe(pending.id);
      expect(await prisma.organization.count()).toBe(1);
      expect(await prisma.organizationInvite.findMany({ select: { id: true, tokenHash: true } })).toEqual([{ id: invite.id, tokenHash: invite.tokenHash }]);
      expect(await prisma.enquiryConversion.findFirstOrThrow()).toMatchObject({ organizationId: pending.id, ownerInviteId: invite.id });
    });
  });
});
