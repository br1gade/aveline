import { ConfigService } from '@nestjs/config';
import { PlatformRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ConsultationsService } from '../../../src/modules/sales/consultations.service';
import { EnquiriesService } from '../../../src/modules/sales/enquiries.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * docs/API.md, "Staff enquiries and consultation appointments": the command
 * rules that refuse a write must leave the case exactly as it was — no revision
 * bump, no activity, no receipt.
 */
const INTAKE_CONFIG = { SALES_INTAKE_ENABLED: 'true', SALES_INTAKE_SUPPORT_ENABLED: 'true', SALES_INTENT_HMAC_KEY_ID: 'test', SALES_INTENT_HMAC_KEYS: JSON.stringify({ test: 'x'.repeat(32) }) };
const SLOT = { startsAt: '2026-11-02T10:00:00Z', endsAt: '2026-11-02T11:00:00Z', timezone: 'Asia/Yerevan' };

describe('staff enquiry command refusals (integration coverage)', () => {
  const prisma = testPrisma();
  let enquiries: EnquiriesService;
  let consultations: ConsultationsService;
  beforeEach(async () => {
    await resetTestDatabase();
    enquiries = new EnquiriesService(prisma as PrismaService, new ConfigService(INTAKE_CONFIG));
    consultations = new ConsultationsService(prisma as PrismaService, enquiries);
  });
  afterAll(disconnectTestDatabase);

  const staff = (platformRole: PlatformRole) => prisma.user.create({ data: { name: 'Operator', email: `${randomUUID()}@example.am`, platformRole } });
  const createCase = async (actorId: string, contact: { name: string; email?: string; phone?: string } = { name: 'Anna', phone: '+37499123456' }) =>
    (await enquiries.create(actorId, `create-${randomUUID()}`, { contact })).enquiry;
  const unchanged = async (enquiryId: string, counts: { activities: number; commands: number }) => {
    expect((await prisma.salesEnquiry.findUniqueOrThrow({ where: { id: enquiryId } })).revision).toBe(1);
    expect(await prisma.enquiryActivity.count()).toBe(counts.activities);
    expect(await prisma.enquiryCommand.count()).toBe(counts.commands);
  };

  describe('idempotency', () => {
    it('refuses the same note key with a changed body on the same case and writes nothing', async () => {
      const support = await staff('SUPPORT');
      const enquiry = await createCase(support.id);
      await enquiries.addNote(support.id, enquiry.id, { key: 'same-note-key', dto: { expectedRevision: 1, body: 'A' } });
      const changed = enquiries.addNote(support.id, enquiry.id, { key: 'same-note-key', dto: { expectedRevision: 1, body: 'B' } });
      await expect(changed).rejects.toMatchObject({ status: 409, message: 'IDEMPOTENCY_CONFLICT' });
      expect(await prisma.enquiryNote.findMany({ select: { body: true } })).toEqual([{ body: 'A' }]);
      expect((await prisma.salesEnquiry.findUniqueOrThrow({ where: { id: enquiry.id } })).revision).toBe(2);
      expect(await prisma.enquiryCommand.count()).toBe(2);
    });

    it('replays the same note key with the same body without a second note', async () => {
      const support = await staff('SUPPORT');
      const enquiry = await createCase(support.id);
      const first = await enquiries.addNote(support.id, enquiry.id, { key: 'same-note-key', dto: { expectedRevision: 1, body: 'A' } });
      const replay = await enquiries.addNote(support.id, enquiry.id, { key: 'same-note-key', dto: { expectedRevision: 1, body: 'A' } });
      expect(replay.commandId).toBe(first.commandId);
      expect(await prisma.enquiryNote.count()).toBe(1);
    });
  });

  describe('assignment', () => {
    it('answers NO_CHANGE when ADMIN assigns the current assignee and records nothing', async () => {
      const [admin, support] = await Promise.all([staff('ADMIN'), staff('SUPPORT')]);
      const enquiry = await createCase(support.id);
      const same = enquiries.assign(admin.id, enquiry.id, { key: 'same-assignee-key', dto: { expectedRevision: 1, assignedUserId: support.id } });
      await expect(same).rejects.toMatchObject({ status: 409, message: 'NO_CHANGE' });
      await unchanged(enquiry.id, { activities: 1, commands: 1 });
    });

    it('refuses a SUPPORT assignment at the service as well as the route', async () => {
      const [support, other] = await Promise.all([staff('SUPPORT'), staff('SUPPORT')]);
      const enquiry = await createCase(support.id);
      await expect(enquiries.assign(support.id, enquiry.id, { key: 'support-assign-key', dto: { expectedRevision: 1, assignedUserId: other.id } })).rejects.toMatchObject({ status: 403 });
      expect((await prisma.salesEnquiry.findUniqueOrThrow({ where: { id: enquiry.id } })).assignedUserId).toBe(support.id);
      await unchanged(enquiry.id, { activities: 1, commands: 1 });
    });
  });

  describe('stage', () => {
    it.each([
      { label: 'CLOSED without a closureReason', dto: { stage: 'CLOSED' as const }, message: 'closureReason is required for CLOSED' },
      { label: 'a closureReason on CONTACTED', dto: { stage: 'CONTACTED' as const, closureReason: 'OTHER' as const }, message: 'closureReason and closureNote are only accepted for CLOSED' },
      { label: 'a closureNote on READY_FOR_QUOTE', dto: { stage: 'READY_FOR_QUOTE' as const, closureNote: 'Lost' }, message: 'closureReason and closureNote are only accepted for CLOSED' },
    ])('refuses $label with 400 and changes nothing', async ({ dto, message }) => {
      const support = await staff('SUPPORT');
      const enquiry = await createCase(support.id);
      await expect(enquiries.stage(support.id, enquiry.id, { key: 'refused-stage-key', dto: { expectedRevision: 1, ...dto } })).rejects.toMatchObject({ status: 400, message });
      expect((await prisma.salesEnquiry.findUniqueOrThrow({ where: { id: enquiry.id } })).stage).toBe('NEW');
      await unchanged(enquiry.id, { activities: 1, commands: 1 });
    });

    it('answers NO_CHANGE for the stage the case already has', async () => {
      const support = await staff('SUPPORT');
      const enquiry = await createCase(support.id);
      await expect(enquiries.stage(support.id, enquiry.id, { key: 'same-stage-key', dto: { expectedRevision: 1, stage: 'NEW' } })).rejects.toMatchObject({ status: 409, message: 'NO_CHANGE' });
      await unchanged(enquiry.id, { activities: 1, commands: 1 });
    });

    it('closes with a reason and note, starting the six-calendar-month cleanup clock', async () => {
      const support = await staff('SUPPORT');
      const enquiry = await createCase(support.id);
      await enquiries.stage(support.id, enquiry.id, { key: 'close-stage-key', dto: { expectedRevision: 1, stage: 'CLOSED', closureReason: 'DUPLICATE', closureNote: 'Booked twice' } });
      const closed = await prisma.salesEnquiry.findUniqueOrThrow({ where: { id: enquiry.id } });
      expect(closed).toMatchObject({ stage: 'CLOSED', closureReason: 'DUPLICATE', closureNote: 'Booked twice', revision: 2 });
      const [closedAt, dueAt] = [closed.closedAt!, closed.cleanupDueAt!];
      const monthIndex = (date: Date) => date.getUTCFullYear() * 12 + date.getUTCMonth();
      expect(monthIndex(dueAt) - monthIndex(closedAt)).toBe(6);
      expect(dueAt.getTime() % 86_400_000).toBe(closedAt.getTime() % 86_400_000);
    });
  });

  describe('queue', () => {
    const seedQueue = async () => {
      const admin = await staff('ADMIN');
      const anna = await createCase(admin.id, { name: 'Anna', email: 'anna@example.am' });
      const annabel = await createCase(admin.id, { name: 'Annabel', phone: '+37499111222' });
      const bob = await createCase(admin.id, { name: 'Bob', email: 'bob@example.am' });
      return { admin, anna, annabel, bob };
    };
    const ids = (page: { items: { id: string }[] }) => page.items.map((item) => item.id);

    it('finds a case by exact email regardless of case and by exact phone', async () => {
      const { admin, anna, annabel } = await seedQueue();
      expect(ids(await enquiries.list(admin.id, { search: 'ANNA@example.am' }))).toEqual([anna.id]);
      expect(ids(await enquiries.list(admin.id, { search: '+37499111222' }))).toEqual([annabel.id]);
      expect(ids(await enquiries.list(admin.id, { search: 'anna@example' }))).toEqual([]);
    });

    it('matches names by case-insensitive prefix only', async () => {
      const { admin, anna, annabel } = await seedQueue();
      expect(ids(await enquiries.list(admin.id, { search: 'ANN' })).sort()).toEqual([anna.id, annabel.id].sort());
      expect(ids(await enquiries.list(admin.id, { search: 'nna' }))).toEqual([]);
    });

    it('filters by stage', async () => {
      const { admin, anna, annabel, bob } = await seedQueue();
      expect(ids(await enquiries.list(admin.id, { stage: 'CLOSED' }))).toEqual([]);
      await enquiries.stage(admin.id, bob.id, { key: 'close-bob-key', dto: { expectedRevision: 1, stage: 'CLOSED', closureReason: 'OTHER' } });
      expect(ids(await enquiries.list(admin.id, { stage: 'CLOSED' }))).toEqual([bob.id]);
      expect(await enquiries.list(admin.id, { stage: 'NEW' })).toMatchObject({ nextCursor: null });
      expect(ids(await enquiries.list(admin.id, { stage: 'NEW' }))).toEqual([annabel.id, anna.id]);
    });

    it('pages newest first to the end with an opaque cursor and no duplicates', async () => {
      const { admin, anna, annabel, bob } = await seedQueue();
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let pageNumber = 0; pageNumber < 4; pageNumber += 1) {
        const page = await enquiries.list(admin.id, { limit: 1, cursor });
        seen.push(...ids(page));
        cursor = page.nextCursor ?? undefined;
        if (!cursor) break;
      }
      expect(seen).toEqual([bob.id, annabel.id, anna.id]);
    });

    it('refuses a cursor reused with different filters or by a different actor', async () => {
      const { admin } = await seedQueue();
      const other = await staff('ADMIN');
      const first = await enquiries.list(admin.id, { limit: 1, search: 'ann' });
      expect(first.nextCursor).not.toBeNull();
      const cursor = first.nextCursor!;
      await expect(enquiries.list(admin.id, { limit: 1, search: 'bob', cursor })).rejects.toMatchObject({ status: 400, message: 'cursor is invalid for these filters' });
      await expect(enquiries.list(other.id, { limit: 1, search: 'ann', cursor })).rejects.toMatchObject({ status: 400, message: 'cursor is invalid for these filters' });
      await expect(enquiries.list(admin.id, { cursor: 'not-a-cursor' })).rejects.toMatchObject({ status: 400, message: 'cursor is invalid for these filters' });
      expect(ids(await enquiries.list(admin.id, { limit: 1, search: 'ann', cursor }))).toHaveLength(1);
    });

    it('shows SUPPORT only the cases assigned to them', async () => {
      const [support, other] = await Promise.all([staff('SUPPORT'), staff('SUPPORT')]);
      const mine = await createCase(support.id);
      await createCase(other.id);
      expect(ids(await enquiries.list(support.id, {}))).toEqual([mine.id]);
    });
  });

  describe('consultation scheduling authority', () => {
    it('refuses SUPPORT naming another operator and writes no appointment', async () => {
      const [support, other] = await Promise.all([staff('SUPPORT'), staff('SUPPORT')]);
      const enquiry = await createCase(support.id);
      const create = consultations.create(support.id, enquiry.id, { key: 'other-operator-key', dto: { expectedRevision: 1, operatorUserId: other.id, ...SLOT } });
      await expect(create).rejects.toMatchObject({ status: 403, message: 'operatorUserId must be the acting SUPPORT operator' });
      expect(await prisma.consultation.count()).toBe(0);
      await unchanged(enquiry.id, { activities: 1, commands: 1 });
    });

    it('lets ADMIN schedule an active SUPPORT operator', async () => {
      const [admin, support] = await Promise.all([staff('ADMIN'), staff('SUPPORT')]);
      const enquiry = await createCase(admin.id);
      await consultations.create(admin.id, enquiry.id, { key: 'admin-schedules-key', dto: { expectedRevision: 1, operatorUserId: support.id, ...SLOT } });
      expect(await prisma.consultation.findFirstOrThrow()).toMatchObject({ operatorUserId: support.id, createdByUserId: admin.id, status: 'SCHEDULED' });
    });

    it.each([
      { label: 'a customer (NONE) account', arrange: () => staff('NONE') },
      { label: 'an inactive staff account', arrange: async () => prisma.user.update({ where: { id: (await staff('SUPPORT')).id }, data: { isActive: false } }) },
    ])('refuses ADMIN scheduling $label as operator', async ({ arrange }) => {
      const admin = await staff('ADMIN');
      const operator = await arrange();
      const enquiry = await createCase(admin.id);
      const create = consultations.create(admin.id, enquiry.id, { key: 'bad-operator-key', dto: { expectedRevision: 1, operatorUserId: operator.id, ...SLOT } });
      await expect(create).rejects.toMatchObject({ status: 403, message: 'Operator must be active platform staff' });
      expect(await prisma.consultation.count()).toBe(0);
    });
  });

  describe('consultation updates', () => {
    const scheduled = async () => {
      const support = await staff('SUPPORT');
      const enquiry = await createCase(support.id);
      const created = await consultations.create(support.id, enquiry.id, { key: 'schedule-key', dto: { expectedRevision: 1, operatorUserId: support.id, ...SLOT } });
      return { support, enquiry, consultationId: created.resultId! };
    };

    it('answers 404 for a consultation that belongs to another case and leaves it scheduled', async () => {
      const { support, consultationId } = await scheduled();
      const otherCase = await createCase(support.id, { name: 'Bob', email: 'bob@example.am' });
      const update = consultations.update(support.id, otherCase.id, { key: 'foreign-update-key', consultationId, dto: { expectedRevision: 1, expectedConsultationRevision: 1, status: 'CANCELLED' } });
      await expect(update).rejects.toMatchObject({ status: 404, message: 'No such consultation' });
      expect(await prisma.consultation.findUniqueOrThrow({ where: { id: consultationId } })).toMatchObject({ status: 'SCHEDULED', revision: 1 });
      expect((await prisma.salesEnquiry.findUniqueOrThrow({ where: { id: otherCase.id } })).revision).toBe(1);
    });

    it('answers 404 for an unknown consultation', async () => {
      const { support, enquiry } = await scheduled();
      const update = consultations.update(support.id, enquiry.id, { key: 'unknown-update-key', consultationId: 'no-such-consultation', dto: { expectedRevision: 2, expectedConsultationRevision: 1, status: 'CANCELLED' } });
      await expect(update).rejects.toMatchObject({ status: 404, message: 'No such consultation' });
      expect((await prisma.salesEnquiry.findUniqueOrThrow({ where: { id: enquiry.id } })).revision).toBe(2);
    });

    it('refuses a stale consultation revision with ENQUIRY_CHANGED', async () => {
      const { support, enquiry, consultationId } = await scheduled();
      const update = consultations.update(support.id, enquiry.id, { key: 'stale-update-key', consultationId, dto: { expectedRevision: 2, expectedConsultationRevision: 99, status: 'CANCELLED' } });
      await expect(update).rejects.toMatchObject({ status: 409, message: 'ENQUIRY_CHANGED' });
      expect(await prisma.consultation.findUniqueOrThrow({ where: { id: consultationId } })).toMatchObject({ status: 'SCHEDULED', revision: 1 });
    });

    it('keeps omitted scheduling fields when only the end moves', async () => {
      const { support, enquiry, consultationId } = await scheduled();
      await consultations.update(support.id, enquiry.id, { key: 'move-end-key', consultationId, dto: { expectedRevision: 2, expectedConsultationRevision: 1, endsAt: '2026-11-02T11:30:00Z' } });
      const moved = await prisma.consultation.findUniqueOrThrow({ where: { id: consultationId } });
      expect(moved).toMatchObject({ startsAt: new Date(SLOT.startsAt), endsAt: new Date('2026-11-02T11:30:00Z'), timezone: SLOT.timezone, status: 'SCHEDULED', revision: 2 });
    });

    it.each([
      { status: 'COMPLETED' as const, stamp: 'completedAt' as const, other: 'cancelledAt' as const },
      { status: 'CANCELLED' as const, stamp: 'cancelledAt' as const, other: 'completedAt' as const },
    ])('moves to $status, stamps $stamp, and refuses any further change as terminal', async ({ status, stamp, other }) => {
      const { support, enquiry, consultationId } = await scheduled();
      await consultations.update(support.id, enquiry.id, { key: 'terminal-key', consultationId, dto: { expectedRevision: 2, expectedConsultationRevision: 1, status } });
      const ended = await prisma.consultation.findUniqueOrThrow({ where: { id: consultationId } });
      expect(ended.status).toBe(status);
      expect(ended[stamp]).toBeInstanceOf(Date);
      expect(ended[other]).toBeNull();
      const again = consultations.update(support.id, enquiry.id, { key: 'after-terminal-key', consultationId, dto: { expectedRevision: 3, expectedConsultationRevision: 2, endsAt: '2026-11-02T12:00:00Z' } });
      await expect(again).rejects.toMatchObject({ status: 400, message: 'status is terminal; create a new consultation' });
      expect((await prisma.consultation.findUniqueOrThrow({ where: { id: consultationId } })).revision).toBe(2);
    });
  });

  describe('consultation availability', () => {
    const window = (from: string, to: string) => ({ from, to });
    it.each([
      { label: 'a reversed range', range: window('2026-11-02T00:00:00Z', '2026-11-01T00:00:00Z') },
      { label: 'an empty range', range: window('2026-11-02T00:00:00Z', '2026-11-02T00:00:00Z') },
      { label: 'a range one millisecond over 31 days', range: window('2026-11-01T00:00:00Z', '2026-12-02T00:00:00.001Z') },
    ])('refuses $label with 400', async ({ range }) => {
      const support = await staff('SUPPORT');
      await expect(Promise.resolve().then(() => consultations.availability(support.id, { operatorUserId: support.id, ...range }))).rejects.toMatchObject({ status: 400, message: 'to must be after from and within 31 days' });
    });

    it('accepts exactly 31 days', async () => {
      const support = await staff('SUPPORT');
      expect(await consultations.availability(support.id, { operatorUserId: support.id, from: '2026-11-01T00:00:00Z', to: '2026-12-02T00:00:00Z' })).toEqual({ operatorUserId: support.id, busy: [] });
    });

    it('keeps showing a former operator their busy interval after reassignment, without enquiry identity', async () => {
      const [admin, support, next] = await Promise.all([staff('ADMIN'), staff('SUPPORT'), staff('SUPPORT')]);
      const enquiry = await createCase(support.id);
      await consultations.create(support.id, enquiry.id, { key: 'before-transfer-key', dto: { expectedRevision: 1, operatorUserId: support.id, ...SLOT } });
      await enquiries.assign(admin.id, enquiry.id, { key: 'transfer-key', dto: { expectedRevision: 2, assignedUserId: next.id } });
      await expect(enquiries.detail(support.id, enquiry.id)).rejects.toMatchObject({ status: 404 });
      const availability = await consultations.availability(support.id, { operatorUserId: support.id, from: '2026-11-02T00:00:00Z', to: '2026-11-03T00:00:00Z' });
      expect(availability).toEqual({ operatorUserId: support.id, busy: [{ startsAt: new Date(SLOT.startsAt), endsAt: new Date(SLOT.endsAt) }] });
    });

    it('refuses SUPPORT reading another operator calendar', async () => {
      const [support, other] = await Promise.all([staff('SUPPORT'), staff('SUPPORT')]);
      const read = Promise.resolve().then(() => consultations.availability(support.id, { operatorUserId: other.id, from: '2026-11-02T00:00:00Z', to: '2026-11-03T00:00:00Z' }));
      await expect(read).rejects.toMatchObject({ status: 403, message: 'operatorUserId must be the acting SUPPORT operator' });
    });
  });
});
